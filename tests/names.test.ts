import { describe, expect, test, vi } from "vitest";
import { anvilHashFor, checkNote, checkPaidName, driveTarget, ghHashFor, isNameHash, nameInHash, normalizeName, registerName, resolveName, NAME_RE, RESERVED_PREFIXES, type CheckState } from "../src/names";

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
const calls = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];

describe("the rule is the server's rule", () => {
  test("regex source and reserved prefixes are pinned to server_code/names.py", () => {
    expect(NAME_RE.source).toBe("^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?(?:\\/[a-z0-9-]{1,20})?$");
    expect([...RESERVED_PREFIXES]).toEqual(["gh", "gdoc", "gdrive", "url", "anvil", "api", "name", "course", "learner", "me", "www"]);
  });
  test("accepts and normalises", () => {
    expect(normalizeName(" Learn-Russian ")).toBe("learn-russian");
    expect(normalizeName("learn-russian/3")).toBe("learn-russian/3");
  });
  test("rejects reserved prefixes with or without a dash, and malformed names", () => {
    for (const bad of ["gh", "gh-x", "GDRIVE-abc", "url/1", "anvil-x", "api", "name-x", "course", "learner-1", "-x", "x-", "a b", "a=b", "", null]) expect(normalizeName(bad)).toBeNull();
  });
});

describe("hash helpers", () => {
  test("nameInHash takes the first segment and ignores parameters", () => {
    expect(nameInHash("#learn-russian")).toBe("learn-russian");
    expect(nameInHash("#Learn-Russian/3&mode=silent&learner=a-b-c")).toBe("learn-russian/3");
    expect(nameInHash("#gh=o/r/p.yaml")).toBeNull();
    expect(nameInHash("#gh-o/r/p.yaml")).toBeNull();
    expect(nameInHash("#")).toBeNull();
    expect(nameInHash("")).toBeNull();
    expect(nameInHash("#mode=silent")).toBeNull();
  });
  test("a malformed percent-escape is not a name, not a crash", () => {
    expect(() => nameInHash("#100%")).not.toThrow();
    expect(nameInHash("#100%")).toBeNull();
    expect(() => isNameHash("#fjell%zz")).not.toThrow();
    expect(isNameHash("#fjell%zz")).toBe(false);
    expect(nameInHash("#Learn-Russian%2F3")).toBe("learn-russian/3");
  });
  test("isNameHash", () => {
    expect(isNameHash("#learn-russian")).toBe(true);
    expect(isNameHash("#gh=o/r/p.yaml")).toBe(false);
    expect(isNameHash("")).toBe(false);
  });
  test("ghHashFor swaps the name for the target and keeps the rest", () => {
    expect(ghHashFor("#learn-russian/3&mode=silent", "o/r/03.yaml")).toBe("#gh=o/r/03.yaml&mode=silent");
    expect(ghHashFor("#learn-russian", "o/r/03.yaml")).toBe("#gh=o/r/03.yaml");
  });
});

describe("resolveName", () => {
  test("GETs /_/api/name?n= and returns the body", async () => {
    const f = fetchReturning(200, { kind: "cast", target: "o/r/p.yaml", page: null });
    expect(await resolveName("https://drawcast.anvil.app/", "learn-russian/3", f)).toEqual({ kind: "cast", target: "o/r/p.yaml", page: null });
    expect(calls(f)[0][0]).toBe("https://drawcast.anvil.app/_/api/name?n=learn-russian%2F3");
  });
  test("404 or a throw is null", async () => {
    expect(await resolveName("https://x", "nope", fetchReturning(404, { error: "unknown" }))).toBeNull();
    expect(await resolveName("https://x", "nope", vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("registerName", () => {
  const reg = { key: "k", name: "learn-russian", kind: "course" as const, target: "o/r/learn-russian", page: "https://h/x/", title: "T", lectures: ["o/r/learn-russian/01.yaml"] };
  test("POSTs text/plain JSON and maps statuses", async () => {
    const f = fetchReturning(200, { ok: true });
    expect(await registerName("https://drawcast.anvil.app", reg, f)).toBe("ok");
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/name");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(init.body as string)).toEqual(reg);
    expect(await registerName("https://x", reg, fetchReturning(409, { error: "taken" }))).toBe("taken");
    expect(await registerName("https://x", reg, fetchReturning(401, { error: "key" }))).toBe("key");
    expect(await registerName("https://x", reg, fetchReturning(400, { error: "name" }))).toBe("invalid");
    expect(await registerName("https://x", reg, fetchReturning(500, {}))).toBe("error");
  });
  test("an invalid name never becomes a request", async () => {
    const f = fetchReturning(200, { ok: true });
    expect(await registerName("https://x", { ...reg, name: "gh-x" }, f)).toBe("invalid");
    expect(calls(f).length).toBe(0);
  });
});

describe("the registration floor", () => {
  test("reserved prefixes still match the server, now including me", () => {
    expect([...RESERVED_PREFIXES]).toEqual(["gh", "gdoc", "gdrive", "url", "anvil", "api", "name", "course", "learner", "me", "www"]);
    expect(normalizeName("me")).toBeNull();
    expect(normalizeName("me-too")).toBeNull();
  });
});

// The Check button: advice, not a reservation. Every name is bought since the
// pretty-link round (2026-09-18), so the ONE check is the paid one: the rule
// and the paid floor are refused locally (never spending the 600/h budget),
// `kind` rides the body, and the price comes back beside the state.
describe("checkPaidName", () => {
  test("passes the state and the price through and never throws", async () => {
    const ok = fetchReturning(200, { state: "taken", price: 500, currency: "usd" });
    expect(await checkPaidName("https://a", "spanish1", "t", "cast", ok)).toEqual({ state: "taken", price: 500 });
    const dead = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await checkPaidName("https://a", "spanish1", "t", "cast", dead)).toEqual({ state: "error" });
  });
  test("the paid floor is three, and a derived name is never registered — both refused locally", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await checkPaidName("https://a", "ab", "t", "cast", f)).toEqual({ state: "short" });
    expect(await checkPaidName("https://a", "learn-russian/3", "t", "course", f)).toEqual({ state: "short" });
    expect(calls(f).length).toBe(0);
  });
  test("a malformed or reserved name is refused without asking either", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await checkPaidName("https://a", "gh-spanish", "t", "cast", f)).toEqual({ state: "invalid" });
    expect(await checkPaidName("https://a", "learn russian", "t", "cast", f)).toEqual({ state: "invalid" });
    expect(await checkPaidName("https://a", "", "t", "cast", f)).toEqual({ state: "invalid" });
    expect(calls(f).length).toBe(0);
  });
  test("POSTs text/plain JSON to /_/api/name/check with the NORMALIZED name, the token and the kind", async () => {
    const f = fetchReturning(200, { state: "free", price: 500, currency: "usd" });
    expect(await checkPaidName("https://drawcast.anvil.app/", " Learn-Russian ", "t", "course", f)).toEqual({ state: "free", price: 500 });
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/name/check");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(init.body as string)).toEqual({ name: "learn-russian", key: "t", kind: "course" });
  });
  test("signed out, no key rides the body — the server then never answers yours", async () => {
    const f = fetchReturning(200, { state: "taken", price: 500 });
    expect(await checkPaidName("https://a", "spanish1", "", "cast", f)).toEqual({ state: "taken", price: 500 });
    expect(JSON.parse(calls(f)[0][1].body as string)).toEqual({ name: "spanish1", kind: "cast" });
  });
  test("a refusal, or an answer it does not recognise, is error — not a guess", async () => {
    expect(await checkPaidName("https://a", "spanish1", "t", "cast", fetchReturning(429, { error: "rate" }))).toEqual({ state: "error" });
    expect(await checkPaidName("https://a", "spanish1", "t", "cast", fetchReturning(200, { state: "reserved" }))).toEqual({ state: "error" });
    expect(await checkPaidName("https://a", "spanish1", "t", "cast", fetchReturning(200, {}))).toEqual({ state: "error" });
  });
  test("the note says what to do, not what happened", () => {
    expect(checkNote("free", "spanish1")).toMatch(/free/i);
    expect(checkNote("short", "ab")).toMatch(/3/);
    expect(checkNote("yours", "spanish1")).toMatch(/publishing moves it/);
    expect(checkNote("taken", "spanish1")).toMatch(/pick another/i);
    expect(checkNote("error", "spanish1")).toMatch(/publishing will tell/i);
  });
  test("every state has its own non-empty note", () => {
    const states: CheckState[] = ["free", "yours", "taken", "short", "invalid", "error"];
    const notes = states.map((s) => checkNote(s, "spanish1"));
    expect(new Set(notes).size).toBe(states.length);
    for (const n of notes) expect(n.length).toBeGreaterThan(0);
  });
});

// ---- Paid course names (paid-names round, 2026-09-17) ----------------------
import { readFileSync } from "node:fs";
import { formatPrice, isPayable, paidInHash, PAID_MIN_LENGTH, PRICE_CURRENCY, PRICE_LONG, PRICE_TIERS, priceFor, startNamePayment } from "../src/names";

describe("price tiers mirror server_code/names.py", () => {
  test("the constants are pinned to the server's", () => {
    const py = readFileSync(new URL("../../drawcast-anvil/server_code/names.py", import.meta.url), "utf8");
    expect(py).toContain(`PAID_MIN_LENGTH = ${PAID_MIN_LENGTH}`);
    expect(py).toContain(`PRICE_TIERS = (${PRICE_TIERS.map(([u, c]) => `(${u}, ${c})`).join(", ")})`);
    expect(py).toContain(`PRICE_LONG = ${PRICE_LONG}`);
    expect(py).toContain(`PRICE_CURRENCY = "${PRICE_CURRENCY}"`);
  });
  test("20 / 10 / 5 USD by the base's length, in cents", () => {
    expect(priceFor("abc")).toBe(2000);
    expect(priceFor("abcde")).toBe(2000);
    expect(priceFor("abcdef")).toBe(1000);
    expect(priceFor("abcdefg")).toBe(1000);
    expect(priceFor("abcdefgh")).toBe(500);
    expect(priceFor("abcde/3")).toBe(2000);
  });
  test("formatPrice says whole units and the currency in capitals", () => {
    expect(formatPrice(500)).toBe("5 USD");
    expect(formatPrice(2000, "usd")).toBe("20 USD");
    expect(formatPrice(1050)).toBe("10.50 USD");
  });
  test("isPayable: the read rule, a base name, at least three characters", () => {
    expect(isPayable("abc")).toBe(true);
    expect(isPayable("micro-i")).toBe(true);
    expect(isPayable("ab")).toBe(false);
    expect(isPayable("gh-x")).toBe(false);
    expect(isPayable("micro-i/1")).toBe(false);
  });
});

describe("registerName answers pay on a 402", () => {
  test("a course name not yet yours is a sale, not a registration", async () => {
    const course = { key: "k", name: "micro-i", kind: "course" as const, target: "o/r/courses/micro-i" };
    expect(await registerName("https://x", course, fetchReturning(402, { error: "pay", price: 500, currency: "usd" }))).toBe("pay");
  });
});

describe("checkNote with a price and a kind", () => {
  test("prices a free name for its subject, says nothing about money for a name already yours, and states the paid floor", () => {
    expect(checkNote("free", "micro-i", { price: 500, kind: "course" })).toBe('"micro-i" is free — 5 USD to register it as this course\u2019s address.');
    expect(checkNote("free", "micro-i", { price: 2000 })).toBe('"micro-i" is free — 20 USD to register it as this drawcast\u2019s address.');
    expect(checkNote("yours", "micro-i", { price: 500 })).toMatch(/already yours/);
    expect(checkNote("yours", "micro-i", { price: 500 })).not.toMatch(/USD/);
    expect(checkNote("short", "ab", { kind: "course" })).toMatch(/3/);
    expect(checkNote("short", "ab")).toMatch(/3/);
  });
});

describe("where a resolved target plays", () => {
  test("anvilHashFor: the server for anvil/, Drive for gdrive/, GitHub for the rest — the tail kept", () => {
    expect(anvilHashFor("#spanish1&mode=silent", "anvil/spanish1/01.yaml")).toBe("#anvil=spanish1/01.yaml&mode=silent");
    expect(anvilHashFor("#spanish1", "gdrive/1AbC_defGH-ijkLMN")).toBe("#gdrive=1AbC_defGH-ijkLMN");
    expect(anvilHashFor("#spanish1", "hm/casts/casts/spanish1.yaml")).toBe("#gh=hm/casts/casts/spanish1.yaml");
  });
  test("driveTarget is the registry's form of a Drive copy", () => {
    expect(driveTarget("1AbC_defGH-ijkLMN")).toBe("gdrive/1AbC_defGH-ijkLMN");
  });
});

describe("startNamePayment", () => {
  const pay = { key: "tok", name: "micro-i", kind: "course" as const, target: "o/r/courses/micro-i", title: "Micro I", return: "https://drawcast.app/" };
  test("POSTs the registration plus the return address and hands back Stripe's url", async () => {
    const f = fetchReturning(200, { url: "https://checkout.stripe.com/c/pay/cs_1" });
    expect(await startNamePayment("https://drawcast.anvil.app", pay, f)).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_1" });
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/name/pay");
    expect(JSON.parse(init.body as string)).toEqual(pay);
  });
  test("maps the refusals", async () => {
    expect(await startNamePayment("https://x", pay, fetchReturning(409, { error: "taken" }))).toBe("taken");
    expect(await startNamePayment("https://x", pay, fetchReturning(409, { error: "yours" }))).toBe("yours");
    expect(await startNamePayment("https://x", pay, fetchReturning(403, { error: "owner" }))).toBe("owner");
    expect(await startNamePayment("https://x", pay, fetchReturning(401, { error: "key" }))).toBe("key");
    expect(await startNamePayment("https://x", pay, fetchReturning(400, { error: "short" }))).toBe("invalid");
    expect(await startNamePayment("https://x", pay, fetchReturning(503, { error: "stripe" }))).toBe("error");
    expect(await startNamePayment("https://x", pay, fetchReturning(200, { nope: 1 }))).toBe("error");
  });
});

describe("paidInHash — Stripe's return lands here", () => {
  test("reads the outcome and the name, nothing else", () => {
    expect(paidInHash("#paid=micro-i")).toEqual({ outcome: "paid", name: "micro-i" });
    expect(paidInHash("#unpaid=micro-i")).toEqual({ outcome: "unpaid", name: "micro-i" });
    expect(paidInHash("#taken=abc")).toEqual({ outcome: "taken", name: "abc" });
    expect(paidInHash("#micro-i")).toBeNull();
    expect(paidInHash("#paid=Not A Name")).toBeNull();
    expect(paidInHash("")).toBeNull();
  });
  test("a paid marker is not a name hash, so entry.ts routes it to the editor", async () => {
    const { isNameHash } = await import("../src/names");
    expect(isNameHash("#paid=micro-i")).toBe(false);
  });
});
