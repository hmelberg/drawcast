import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { claimFile, registerItem, registryNote, verifyClaim, type RegistryOutcome, type RegisterResult } from "../src/registry";

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
    expect(await verifyClaim(API, "k", REPO, fetchReturning(200, { verified: false }))).toBe(false);
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
  test("key, rate and error all read as unreachable", () => {
    const outcomes: RegistryOutcome[] = ["key", "rate", "error"];
    for (const out of outcomes) expect(registryNote(out)).toBe(" · not registered (server unreachable)");
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
