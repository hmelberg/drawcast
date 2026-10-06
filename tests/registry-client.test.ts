import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import {
  claimFile,
  ensurePrivateApplied,
  privateInHash,
  quotePrivate,
  registerItem,
  registryItemKey,
  registryNote,
  setListing,
  startPrivatePayment,
  verifyClaim,
  type PrivateQuote,
  type RegisterResult,
  type RegistryOutcome,
} from "../src/registry";

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
const throwing = (): typeof fetch => vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
const calls = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];

const API = "https://drawcast.anvil.app";
const REPO = "hmelberg/dcast";

describe("claimFile", () => {
  test("no token, no request — null", async () => {
    const f = fetchReturning(200, { nonce: "abc", path: ".drawcast/claim" });
    expect(await claimFile(API, "", REPO, f)).toBeNull();
    expect(calls(f).length).toBe(0);
  });

  test("POSTs text/plain JSON and returns the claim file, nonce plus newline", async () => {
    const f = fetchReturning(200, { nonce: "n0nce123", path: ".drawcast/claim" });
    const out = await claimFile(API, "k", REPO, f);
    expect(out).toEqual({ path: ".drawcast/claim", content: "n0nce123\n" });
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/claim");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(init.body as string)).toEqual({ key: "k", repo: REPO });
  });

  test("a malformed 200 (no nonce) is null", async () => {
    expect(await claimFile(API, "k", REPO, fetchReturning(200, {}))).toBeNull();
  });

  test("401/400/429/500 are all null", async () => {
    expect(await claimFile(API, "k", REPO, fetchReturning(401, { error: "key" }))).toBeNull();
    expect(await claimFile(API, "k", REPO, fetchReturning(400, { error: "repo" }))).toBeNull();
    expect(await claimFile(API, "k", REPO, fetchReturning(429, {}))).toBeNull();
    expect(await claimFile(API, "k", REPO, fetchReturning(500, {}))).toBeNull();
  });

  test("a network error never throws — null", async () => {
    await expect(claimFile(API, "k", REPO, throwing())).resolves.toBeNull();
  });
});

describe("verifyClaim", () => {
  test("POSTs text/plain JSON and reports the server's verified flag", async () => {
    const f = fetchReturning(200, { verified: true });
    expect(await verifyClaim(API, "k", REPO, f)).toBe(true);
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/claim/verify");
    expect(JSON.parse(init.body as string)).toEqual({ key: "k", repo: REPO });
    expect(await verifyClaim(API, "k", REPO, fetchReturning(200, { verified: false }), { sleep: async () => {} })).toBe(false);
  });

  test("M3: {verified:false} is retried — 3 attempts, 3 s apart — since raw.githubusercontent lags a fresh commit", async () => {
    const waits: number[] = [];
    let n = 0;
    const f = vi.fn(async () => {
      n++;
      return new Response(JSON.stringify({ verified: n === 3 }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await verifyClaim(API, "k", REPO, f, { sleep: async (ms) => void waits.push(ms) })).toBe(true);
    expect(calls(f).length).toBe(3);
    expect(waits).toEqual([3000, 3000]);
  });

  test("M3: never more than 3 attempts; each one bounded by its own timeout signal", async () => {
    const f = fetchReturning(200, { verified: false });
    expect(await verifyClaim(API, "k", REPO, f, { sleep: async () => {} })).toBe(false);
    expect(calls(f).length).toBe(3);
    for (const [, init] of calls(f)) expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("M3: a refusal or a network error is not retried", async () => {
    const f = fetchReturning(401, { error: "key" });
    expect(await verifyClaim(API, "k", REPO, f, { sleep: async () => {} })).toBe(false);
    expect(calls(f).length).toBe(1);
  });

  test("a non-2xx or a network error is false, never a throw", async () => {
    expect(await verifyClaim(API, "k", REPO, fetchReturning(500, {}))).toBe(false);
    await expect(verifyClaim(API, "k", REPO, throwing())).resolves.toBe(false);
  });
});

describe("registerItem", () => {
  const reg = { key: "k", kind: "cast" as const, target: "o/r/casts/x.yaml", title: "T", page: "https://h/x" };

  test("POSTs text/plain JSON and maps a 200 to the item/name/owner/proven shape", async () => {
    const f = fetchReturning(200, { item: { slug: "x" }, name: "x", owner: "you", proven: true });
    const out = await registerItem(API, reg, f);
    expect(out).toEqual({ item: { slug: "x" }, name: "x", owner: "you", proven: true });
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/register");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(init.body as string)).toEqual(reg);
  });

  test("a name that comes back null (a read-only answer) is carried through as null", async () => {
    const out = await registerItem(API, { kind: "cast", target: "o/r/casts/x.yaml" }, fetchReturning(200, { item: {}, name: null, owner: "none", proven: false }));
    expect(out).toEqual({ item: {}, name: null, owner: "none", proven: false });
  });

  test("an owner outside you/other/none normalises to none", async () => {
    const out = await registerItem(API, reg, fetchReturning(200, { item: {}, owner: "??" }));
    expect((out as RegisterResult).owner).toBe("none");
  });

  test("401 -> key, 429 -> rate, anything else non-2xx -> error", async () => {
    expect(await registerItem(API, reg, fetchReturning(401, { error: "key" }))).toBe("key");
    expect(await registerItem(API, reg, fetchReturning(429, {}))).toBe("rate");
    expect(await registerItem(API, reg, fetchReturning(400, {}))).toBe("error");
    expect(await registerItem(API, reg, fetchReturning(500, {}))).toBe("error");
  });

  test("a network error never throws — error", async () => {
    await expect(registerItem(API, reg, throwing())).resolves.toBe("error");
  });
});

describe("registryNote", () => {
  test("a name that came back is the pretty link", () => {
    expect(registryNote({ item: {}, name: "learn-russian", owner: "you", proven: true })).toBe(" · drawcast.app/#learn-russian");
  });
  test("owned by another account warns, even with a name", () => {
    expect(registryNote({ item: {}, name: "x", owner: "other", proven: false })).toBe(" · registered to another account — republish while signed in to prove the repo is yours");
  });
  test("a successful registration with no name to show is silent", () => {
    expect(registryNote({ item: {}, name: null, owner: "none", proven: false })).toBe("");
    expect(registryNote({ item: {}, name: null, owner: "you", proven: true })).toBe("");
  });
  test("a network failure or a 5xx reads as unreachable", () => {
    const out: RegistryOutcome = "error";
    expect(registryNote(out)).toBe(" · not registered (server unreachable)");
  });
  test("a 429 reads as rate limited, not unreachable — with the caller's own retry line", () => {
    expect(registryNote("rate")).toBe(" · not registered (rate limited — try again within the hour)");
    expect(registryNote("rate", "x", "try `cast.mjs register w` in up to an hour")).toBe(" · not registered (rate limited — try `cast.mjs register w` in up to an hour)");
  });
  test("M5: key (a 401) says to sign in again — the app's wording by default, the caller's own when given", () => {
    expect(registryNote("key")).toBe(" · not registered — sign in again (Sign in, top right)");
    expect(registryNote("key", "run: node scripts/cast.mjs login")).toBe(" · not registered — run: node scripts/cast.mjs login");
  });
});

describe("both publish flows claim the repo before the commit and register after it", () => {
  test("publishDrawcast (main.ts): claimFile before publishCast, registerItem and registryNote after it, ahead of the final status line", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const fn = main.slice(main.indexOf("async function publishDrawcast("), main.indexOf("async function publishServerCast("));
    const iClaim = fn.indexOf("claimFile(");
    const iPublishCast = fn.indexOf("await publishCast(");
    const iRegisterItem = fn.indexOf("registerItem(");
    const iRegistryNote = fn.indexOf("registryNote(");
    const iStatus = fn.lastIndexOf("setStatus(`Published");
    expect(iClaim).toBeGreaterThan(0);
    expect(iClaim).toBeLessThan(iPublishCast);
    expect(iPublishCast).toBeLessThan(iRegisterItem);
    expect(iRegisterItem).toBeLessThan(iRegistryNote);
    expect(iRegistryNote).toBeLessThan(iStatus);
  });

  test("ui/course.ts publish: claimFile before commitPublish, registerItem and registryNote after it, ahead of the final status line", () => {
    const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    const fn = course.slice(course.indexOf("async function publish("), course.indexOf("function showLinks("));
    const iClaim = fn.indexOf("claimFile(");
    const iCommit = fn.indexOf("await commitPublish(");
    const iRegisterItem = fn.indexOf("registerItem(");
    const iRegistryNote = fn.indexOf("registryNote(");
    const iSay = fn.lastIndexOf("say(`Published");
    expect(iClaim).toBeGreaterThan(0);
    expect(iClaim).toBeLessThan(iCommit);
    expect(iCommit).toBeLessThan(iRegisterItem);
    expect(iRegisterItem).toBeLessThan(iRegistryNote);
    expect(iRegistryNote).toBeLessThan(iSay);
  });

  test("publishDrawcast: local bookkeeping (autosave) runs BEFORE the registry calls — it must never wait behind a network call to the registry", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const fn = main.slice(main.indexOf("async function publishDrawcast("), main.indexOf("async function publishServerCast("));
    const iPublishCast = fn.indexOf("await publishCast(");
    const iAutosave = fn.indexOf("autosave(");
    const iVerifyClaim = fn.indexOf("verifyClaim(");
    expect(iPublishCast).toBeGreaterThan(0);
    expect(iPublishCast).toBeLessThan(iAutosave);
    expect(iAutosave).toBeLessThan(iVerifyClaim);
  });

  test("ui/course.ts publish: local bookkeeping (checkpoint/persist) runs BEFORE the registry calls — it must never wait behind a network call to the registry", () => {
    const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    const fn = course.slice(course.indexOf("async function publish("), course.indexOf("function showLinks("));
    const iCommit = fn.indexOf("await commitPublish(");
    const iCheckpoint = fn.indexOf("checkpoint(");
    const iPersist = fn.indexOf("persist(");
    const iVerifyClaim = fn.indexOf("verifyClaim(");
    expect(iCommit).toBeGreaterThan(0);
    expect(iCommit).toBeLessThan(iCheckpoint);
    expect(iCheckpoint).toBeLessThan(iVerifyClaim);
    expect(iPersist).toBeLessThan(iVerifyClaim);
  });
});

describe("quotePrivate", () => {
  const body = { key: "k", kind: "cast" as const, target: "o/r/casts/x.yaml", lectures: 1, private: true };

  test("POSTs text/plain JSON, bounded, and maps the 200 shape (snake_case paid_lectures)", async () => {
    const f = fetchReturning(200, { due: 300, currency: "usd", paid_lectures: 0, private: true, owner: "you", name: "x" });
    const out = await quotePrivate("https://drawcast.anvil.app", body, f);
    expect(out).toEqual({ due: 300, currency: "usd", paidLectures: 0, private: true, owner: "you", name: "x", subscribed: false, subscriptionRequired: false });
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/register/quote");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("due 0, owner other/none, missing name — every field is normalised", async () => {
    const out = (await quotePrivate("https://a", body, fetchReturning(200, { due: 0, paid_lectures: 3, owner: "??" }))) as PrivateQuote;
    expect(out).toEqual({ due: 0, currency: "usd", paidLectures: 3, private: false, owner: "none", name: null, subscribed: false, subscriptionRequired: false });
    const other = (await quotePrivate("https://a", body, fetchReturning(200, { due: 100, owner: "other" }))) as PrivateQuote;
    expect(other.owner).toBe("other");
  });

  test("401 -> key, a malformed 200 (no due) -> error, anything else non-2xx -> error", async () => {
    expect(await quotePrivate("https://a", body, fetchReturning(401, { error: "key" }))).toBe("key");
    expect(await quotePrivate("https://a", body, fetchReturning(200, {}))).toBe("error");
    expect(await quotePrivate("https://a", body, fetchReturning(400, {}))).toBe("error");
    expect(await quotePrivate("https://a", body, fetchReturning(500, {}))).toBe("error");
  });

  test("a network error never throws — error", async () => {
    await expect(quotePrivate("https://a", body, throwing())).resolves.toBe("error");
  });

  // fix round 1: the server is being changed (in parallel) to also answer
  // the item's actual current `listed` state on this SAME quote — Share
  // seeds its Listed checkbox from it, the same way it already seeds
  // Private from `q.private` (probeServerPrivate).
  test("listed rides through when the server sends it, boolean as-is", async () => {
    const yes = (await quotePrivate("https://a", body, fetchReturning(200, { due: 0, listed: true }))) as PrivateQuote;
    expect(yes.listed).toBe(true);
    const no = (await quotePrivate("https://a", body, fetchReturning(200, { due: 500, listed: false }))) as PrivateQuote;
    expect(no.listed).toBe(false);
  });

  test("an older server that omits listed leaves it undefined — quotePrivate never invents a default; the caller decides one", async () => {
    const out = (await quotePrivate("https://a", body, fetchReturning(200, { due: 0 }))) as PrivateQuote;
    expect(out.listed).toBeUndefined();
  });
});

describe("startPrivatePayment", () => {
  const body = { key: "k", kind: "cast" as const, target: "o/r/casts/x.yaml", title: "T", lectures: 1, return: "https://www.drawcast.app/" };

  test("POSTs text/plain JSON and returns the Checkout url", async () => {
    const f = fetchReturning(200, { url: "https://checkout.stripe.com/pay/cs_test_1" });
    const out = await startPrivatePayment("https://drawcast.anvil.app", body, f);
    expect(out).toEqual({ url: "https://checkout.stripe.com/pay/cs_test_1" });
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/register/pay");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  test("409 nothing-due vs. 409 pending are told apart by the body", async () => {
    expect(await startPrivatePayment("https://a", body, fetchReturning(409, { error: "nothing-due" }))).toBe("nothing-due");
    expect(await startPrivatePayment("https://a", body, fetchReturning(409, { error: "pending" }))).toBe("pending");
    expect(await startPrivatePayment("https://a", body, fetchReturning(409, {}))).toBe("nothing-due");
  });

  test("403 -> owner, 401 -> key, a malformed 200 (no url) -> error, anything else -> error", async () => {
    expect(await startPrivatePayment("https://a", body, fetchReturning(403, { error: "owner" }))).toBe("owner");
    expect(await startPrivatePayment("https://a", body, fetchReturning(401, { error: "key" }))).toBe("key");
    expect(await startPrivatePayment("https://a", body, fetchReturning(200, {}))).toBe("error");
    expect(await startPrivatePayment("https://a", body, fetchReturning(400, {}))).toBe("error");
  });

  test("a network error never throws — error", async () => {
    await expect(startPrivatePayment("https://a", body, throwing())).resolves.toBe("error");
  });
});

// A lock path's last stop before /key (fix round 2): a due-0 quote whose row
// is still `private: false` (an earlier unlist-only purchase covered it but
// never flipped the lock) is settled through the SAME /register/pay a Pay
// click hits — 409 nothing-due IS success here, never an error.
describe("ensurePrivateApplied", () => {
  const body = { kind: "cast" as const, target: "o/r/casts/x.yaml", title: "T", lectures: 1, private: true, listed: true, return: "https://www.drawcast.app/" };

  test("POSTs the SAME body startPrivatePayment would, key assembled in", async () => {
    const f = fetchReturning(409, { error: "nothing-due" });
    expect(await ensurePrivateApplied("https://a", "k", body, f)).toBe("ok");
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://a/_/api/register/pay");
    expect(JSON.parse(init.body as string)).toEqual({ key: "k", ...body });
  });

  test("409 nothing-due -> ok (the row is now private, free)", async () => {
    expect(await ensurePrivateApplied("https://a", "k", body, fetchReturning(409, { error: "nothing-due" }))).toBe("ok");
    expect(await ensurePrivateApplied("https://a", "k", body, fetchReturning(409, {}))).toBe("ok"); // an unlabeled 409 defaults to nothing-due too
  });

  test("409 pending, 402/other non-2xx, 403 owner, 401 key — every other outcome passes through unchanged, never folded into ok", async () => {
    expect(await ensurePrivateApplied("https://a", "k", body, fetchReturning(409, { error: "pending" }))).toBe("pending");
    expect(await ensurePrivateApplied("https://a", "k", body, fetchReturning(402, {}))).toBe("error");
    expect(await ensurePrivateApplied("https://a", "k", body, fetchReturning(500, {}))).toBe("error");
    expect(await ensurePrivateApplied("https://a", "k", body, fetchReturning(403, { error: "owner" }))).toBe("owner");
    expect(await ensurePrivateApplied("https://a", "k", body, fetchReturning(401, { error: "key" }))).toBe("key");
  });

  test("a due>0 answer ({url}) is never silently treated as ok — a race the caller should refuse to walk through, not a checkout to open on its own", async () => {
    expect(await ensurePrivateApplied("https://a", "k", body, fetchReturning(200, { url: "https://checkout.stripe.com/pay/cs_1" }))).toEqual({
      url: "https://checkout.stripe.com/pay/cs_1",
    });
  });

  test("a network error never throws — error", async () => {
    await expect(ensurePrivateApplied("https://a", "k", body, throwing())).resolves.toBe("error");
  });
});

// registry deliveries 3–4, task 9: `listed` rides in the SAME quote/pay
// bodies as `private` — price_due depends on both (plan ruling 8), so
// there is no separate quote for the Listed switch.
describe("quotePrivate/startPrivatePayment carry the optional listed/private fields verbatim", () => {
  test("quotePrivate sends listed exactly as given, including omitted (server defaults true)", async () => {
    const withListed = { key: "k", kind: "cast" as const, target: "o/r/casts/x.yaml", lectures: 1, private: false, listed: false };
    const f = fetchReturning(200, { due: 300, currency: "usd", paid_lectures: 0, private: false, owner: "you", name: "x" });
    await quotePrivate("https://a", withListed, f);
    expect(JSON.parse(calls(f)[0][1].body as string)).toEqual(withListed);

    const noListed = { key: "k", kind: "cast" as const, target: "o/r/casts/x.yaml", lectures: 1, private: true };
    const f2 = fetchReturning(200, { due: 0 });
    await quotePrivate("https://a", noListed, f2);
    expect(JSON.parse(calls(f2)[0][1].body as string)).toEqual(noListed);
    expect(JSON.parse(calls(f2)[0][1].body as string)).not.toHaveProperty("listed");
  });

  test("startPrivatePayment sends private/listed exactly as given", async () => {
    const body = {
      key: "k",
      kind: "course" as const,
      target: "o/r/courses/micro-i",
      title: "T",
      lectures: 3,
      private: false,
      listed: false,
      return: "https://www.drawcast.app/",
    };
    const f = fetchReturning(200, { url: "https://checkout.stripe.com/pay/cs_1" });
    await startPrivatePayment("https://a", body, f);
    expect(JSON.parse(calls(f)[0][1].body as string)).toEqual(body);
  });
});

describe("registryItemKey — the registry's own row identifier (Anvil's registry.item_key)", () => {
  test("a cast: the target without its .yaml/.yml extension", () => {
    expect(registryItemKey("cast", "o/r/casts/x.yaml")).toBe("o/r/casts/x");
    expect(registryItemKey("cast", "o/r/casts/x.yml")).toBe("o/r/casts/x");
    expect(registryItemKey("cast", "o/r/casts/x.YAML")).toBe("o/r/casts/x");
  });

  test("a course: the target verbatim — no extension to strip", () => {
    expect(registryItemKey("course", "o/r/courses/micro-i")).toBe("o/r/courses/micro-i");
  });
});

describe("setListing", () => {
  const item = "o/r/casts/x";

  test("POSTs text/plain JSON to /register/listing, bounded, item as the registry key STRING", async () => {
    const f = fetchReturning(200, { listed: true });
    const out = await setListing("https://drawcast.anvil.app", "k", item, true, f);
    expect(out).toBe("ok");
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/register/listing");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(init.body as string)).toEqual({ key: "k", item: "o/r/casts/x", listed: true });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("listed:false with listed:true in the body — sent exactly as asked", async () => {
    const f = fetchReturning(200, { listed: false });
    await setListing("https://a", "k", item, false, f);
    expect(JSON.parse(calls(f)[0][1].body as string).listed).toBe(false);
  });

  test("402 -> {due}, defaulting to 0 on a malformed body", async () => {
    expect(await setListing("https://a", "k", item, false, fetchReturning(402, { error: "pay", due: 500 }))).toEqual({ due: 500 });
    expect(await setListing("https://a", "k", item, false, fetchReturning(402, {}))).toEqual({ due: 0 });
  });

  test("403 -> owner, 401 -> key, anything else non-2xx -> error", async () => {
    expect(await setListing("https://a", "k", item, true, fetchReturning(403, { error: "owner" }))).toBe("owner");
    expect(await setListing("https://a", "k", item, true, fetchReturning(401, { error: "key" }))).toBe("key");
    expect(await setListing("https://a", "k", item, true, fetchReturning(400, {}))).toBe("error");
    expect(await setListing("https://a", "k", item, true, fetchReturning(500, {}))).toBe("error");
  });

  test("a network error never throws — error", async () => {
    await expect(setListing("https://a", "k", item, true, throwing())).resolves.toBe("error");
  });
});

describe("privateInHash — Stripe's return for a private purchase", () => {
  test("reads privpaid/privunpaid/privorphan and the name, and nothing else", () => {
    expect(privateInHash("#privpaid=learn-russian")).toEqual({ outcome: "privpaid", name: "learn-russian" });
    expect(privateInHash("#privunpaid=learn-russian")).toEqual({ outcome: "privunpaid", name: "learn-russian" });
    expect(privateInHash("#privorphan=learn-russian")).toEqual({ outcome: "privorphan", name: "learn-russian" });
    expect(privateInHash("#learn-russian")).toBeNull();
    expect(privateInHash("#paid=learn-russian")).toBeNull();
    expect(privateInHash("#privpaid=Not A Name")).toBeNull();
    expect(privateInHash("")).toBeNull();
  });
});

describe("M6: publishDrawcast keeps a free name only when the item is the author's (or nobody's)", () => {
  test("doc.freeName is set only for owner you/none", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const fn = main.slice(main.indexOf("async function publishDrawcast("), main.indexOf("async function publishServerCast("));
    expect(fn).toMatch(/if \(typeof reg === "object" && reg\.name && \(reg\.owner === "you" \|\| reg\.owner === "none"\)\) \{\s*doc\.freeName = reg\.name;/);
  });
});
