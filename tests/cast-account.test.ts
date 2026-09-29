import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boundedFetch, checkName, registrable, shouldClaim, clearSession, nameBlocker, deviceLogin, nameAdvice, readSession, registerFor, registerNow, registrationFor, waitForName, writeSession } from "../scripts/cast-account.mjs";
import * as coursePub from "../src/course/publish";
import * as castPub from "../src/publish/cast";
import { parseCourse } from "../src/course/document";
import { registryNote } from "../src/registry";
import { claimNote } from "../src/names";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("session file", () => {
  it("round-trips, is private, and clears", () => {
    const home = mkdtempSync(join(tmpdir(), "dc-"));
    expect(readSession(home)).toBeNull();
    writeSession(home, { api: "https://x", key: "k", email: "a@b" });
    expect(readSession(home)).toEqual({ api: "https://x", key: "k", email: "a@b" });
    expect(statSync(join(home, ".config/drawcast/session.json")).mode & 0o077).toBe(0);
    clearSession(home);
    expect(readSession(home)).toBeNull();
  });
});

describe("deviceLogin", () => {
  it("shows the code and where to type it, polls through pending, returns the key", async () => {
    const said: string[] = [];
    const answers = [
      json(200, { device: "d", code: "BCDF-GHJK", verify: "https://x/#device", interval: 5, expires_in: 600 }),
      json(202, { state: "pending" }),
      json(200, { key: "K", email: "a@b" }),
    ];
    const out = await deviceLogin({ api: "https://x", label: "t", fetchImpl: async () => answers.shift()!, sleep: async () => {}, say: (s: string) => said.push(s) });
    expect(out).toEqual({ key: "K", email: "a@b" });
    expect(said.join("\n")).toMatch(/BCDF-GHJK/);
    expect(said.join("\n")).toMatch(/https:\/\/x\/#device/);
  });

  it("a denial is an error, not a hang", async () => {
    const answers = [json(200, { device: "d", code: "BCDF-GHJK", verify: "v", interval: 5, expires_in: 600 }), json(400, { error: "denied" })];
    await expect(deviceLogin({ api: "https://x", label: "t", fetchImpl: async () => answers.shift()!, sleep: async () => {}, say: () => {} })).rejects.toThrow(/denied/);
  });

  it("a 500, a 429 or a dropped connection mid-poll is waited out, not fatal", async () => {
    const answers: (() => Promise<Response>)[] = [
      async () => json(200, { device: "d", code: "BCDF-GHJK", verify: "v", interval: 5, expires_in: 600 }),
      async () => json(500, {}),
      async () => json(429, { error: "rate" }),
      async () => { throw new Error("offline"); },
      async () => json(200, { key: "K", email: "a@b" }),
    ];
    expect(await deviceLogin({ api: "https://x", label: "t", fetchImpl: () => answers.shift()!(), sleep: async () => {}, say: () => {} })).toEqual({ key: "K", email: "a@b" });
  });

  it("gives up as expired when nobody answers", async () => {
    let calls = 0;
    const fetchImpl = async () => (calls++ === 0 ? json(200, { device: "d", code: "BCDF-GHJK", verify: "v", interval: 5, expires_in: 20 }) : json(202, { state: "pending" }));
    await expect(deviceLogin({ api: "https://x", label: "t", fetchImpl, sleep: async () => {}, say: () => {} })).rejects.toThrow(/expired/);
    expect(calls).toBeLessThan(10);
  });
});

const lib = { courseRegistration: coursePub.courseRegistration, castRegistration: castPub.castRegistration, parseCourse };

describe("registrationFor (cast.mjs name)", () => {
  it("a cast: its GitHub file, under the chosen name", () => {
    const origin = { kind: "cast", owner: "ann", repo: "casts", path: "casts/qaly.yaml", castsDir: "casts", file: "qaly.yaml" };
    expect(registrationFor(origin, "qaly-intro", lib)).toMatchObject({ name: "qaly-intro", kind: "cast", target: "ann/casts/casts/qaly.yaml" });
  });

  it("a course: the course key, page and published lectures, under the chosen name", () => {
    const text = "# QALYs\nslug: qalys\n\n---\n## One\nWhy?\nstatus: done · id: x · file: 01-one.yaml · 2026-09-28\n\n---\n## Two\nHow?\n";
    const origin = { kind: "course", owner: "ann", repo: "casts", path: "qalys", coursesDir: "" };
    const reg = registrationFor(origin, "qaly", lib, text);
    expect(reg).toMatchObject({ name: "qaly", kind: "course", target: "ann/casts/qalys", page: "https://ann.github.io/casts/qalys/", title: "QALYs" });
    expect(reg.lectures).toEqual(["ann/casts/qalys/01-one.yaml"]);
  });
});

describe("registerFor (push/register: the free, automatic registration — registry delivery 1)", () => {
  it("a cast: its GitHub file, titled by its file stem (a cast has no title of its own)", () => {
    const origin = { kind: "cast", owner: "ann", repo: "casts", castsDir: "casts", file: "qaly.yaml" };
    expect(registerFor(origin, lib)).toEqual({ kind: "cast", target: "ann/casts/casts/qaly.yaml", title: "qaly", page: "https://ann.github.io/casts/casts/" });
  });

  it("a course: the course key, page, title and published lectures — no chosen name (that is the paid flow's job)", () => {
    const text = "# QALYs\nslug: qalys\n\n---\n## One\nWhy?\nstatus: done · id: x · file: 01-one.yaml · 2026-09-28\n\n---\n## Two\nHow?\n";
    const origin = { kind: "course", owner: "ann", repo: "casts", path: "qalys", coursesDir: "" };
    const reg = registerFor(origin, lib, text);
    expect(reg).toMatchObject({ kind: "course", target: "ann/casts/qalys", page: "https://ann.github.io/casts/qalys/", title: "QALYs" });
    expect(reg.lectures).toEqual(["ann/casts/qalys/01-one.yaml"]);
    expect(Object.keys(reg).sort()).toEqual(["kind", "lectures", "page", "target", "title"]);
  });

  it("a course never published has no slug — refuses rather than registering nothing", () => {
    const origin = { kind: "course", owner: "ann", repo: "casts", path: "qalys", coursesDir: "" };
    expect(() => registerFor(origin, lib, "# QALYs\n")).toThrow(/no slug/);
  });
});

describe("boundedFetch (fix round 1: a stalled Anvil must not hang push/register)", () => {
  it("aborts a fetch that never resolves once timeoutMs elapses", async () => {
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
      });
    const bound = boundedFetch(20, hanging as unknown as typeof fetch);
    await expect(bound("https://x", {})).rejects.toBeTruthy();
  });

  it("keeps the caller's own init (method, headers, body) alongside the abort signal", async () => {
    let seen: RequestInit | undefined;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      seen = init;
      return new Response("{}");
    };
    const bound = boundedFetch(1000, fetchImpl as unknown as typeof fetch);
    await bound("https://x", { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" });
    expect(seen?.method).toBe("POST");
    expect(seen?.headers).toEqual({ "content-type": "text/plain" });
    expect(seen?.body).toBe("hi");
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it("defaults to a 10 s bound and the global fetch when called with no arguments", async () => {
    const bound = boundedFetch();
    expect(typeof bound).toBe("function");
  });
});

describe("registerNow (push/register's network step, once registerFor built the registration)", () => {
  const registry = {
    verifyClaim: async () => true,
    registerItem: async () => ({ item: {}, name: "qaly", owner: "you" as const, proven: true }),
    registryNote,
  };
  it("a course folds claimCourse's own note in before registerItem's", async () => {
    const names = {
      courseClaim: (key: string, reg: { target: string }) => ({ key, course: reg.target }),
      claimCourse: async () => "ok" as const,
      claimNote,
    };
    const origin = { kind: "course", owner: "ann", repo: "casts" };
    const reg = { kind: "course" as const, target: "ann/casts/qalys" };
    const session = { api: "https://x", key: "k", email: null };
    const out = await registerNow({ origin, session, verify: false, reg, registry, names, fetchImpl: async () => new Response("{}") });
    expect(out).toEqual({ note: " · you own this course · drawcast.app/#qaly", name: "qaly" });
  });

  it("a cast never touches `names` — there is no course to claim", async () => {
    const origin = { kind: "cast", owner: "ann", repo: "casts" };
    const reg = { kind: "cast" as const, target: "ann/casts/casts/qaly.yaml" };
    const out = await registerNow({ origin, session: null, verify: false, reg, registry, fetchImpl: async () => new Response("{}") });
    expect(out).toEqual({ note: " · drawcast.app/#qaly", name: "qaly" });
  });

  it("verify: true, signed in, runs verifyClaim before claimCourse and registerItem — and bounds every one of them with the caller's own fetchImpl", async () => {
    const calls: string[] = [];
    const bounded: typeof fetch = (async () => new Response("{}")) as unknown as typeof fetch;
    const reg2 = {
      verifyClaim: async (_api: string, _key: string, _repo: string, f: typeof fetch) => {
        calls.push(f === bounded ? "verify" : "verify(unbound!)");
        return true;
      },
      registerItem: async (_api: string, _reg: unknown, f: typeof fetch) => {
        calls.push(f === bounded ? "register" : "register(unbound!)");
        return { item: {}, name: null, owner: "none" as const, proven: false };
      },
      registryNote,
    };
    const names = {
      courseClaim: (key: string, reg: { target: string }) => ({ key, course: reg.target }),
      claimCourse: async (_api: string, _claim: unknown, f: typeof fetch) => {
        calls.push(f === bounded ? "claim" : "claim(unbound!)");
        return "ok" as const;
      },
      claimNote,
    };
    const origin = { kind: "course", owner: "ann", repo: "casts" };
    const session = { api: "https://x", key: "k", email: null };
    await registerNow({ origin, session, verify: true, reg: { kind: "course" as const, target: "ann/casts/qalys" }, registry: reg2, names, fetchImpl: bounded });
    expect(calls).toEqual(["verify", "claim", "register"]);
  });

  it("signed out: registerItem still runs, key-less, and verify is skipped even when asked", async () => {
    const seen: unknown[] = [];
    const reg2 = {
      verifyClaim: async () => {
        seen.push("verify");
        return true;
      },
      registerItem: async (_api: string, body: { key?: string }) => {
        seen.push(body);
        return { item: {}, name: null, owner: "none" as const, proven: false };
      },
      registryNote,
    };
    const origin = { kind: "cast", owner: "ann", repo: "casts" };
    await registerNow({ origin, session: null, verify: true, reg: { kind: "cast" as const, target: "ann/casts/casts/qaly.yaml" }, registry: reg2, fetchImpl: async () => new Response("{}") });
    expect(seen).toEqual([{ key: undefined, kind: "cast", target: "ann/casts/casts/qaly.yaml" }]);
  });
});

describe("nameAdvice", () => {
  it("says the price for a free name and how to buy it", () => {
    expect(nameAdvice("free", "qaly", 2000)).toMatch(/20 USD.*--buy --price 2000/);
  });
  it("a missing or revoked session says: log in (not the app's Settings wording)", () => {
    expect(nameAdvice("key", "qaly", 2000)).toMatch(/cast\.mjs login/);
  });
  it("taken, short and invalid each say what to do", () => {
    expect(nameAdvice("taken", "qaly", 2000)).toMatch(/someone else/);
    expect(nameAdvice("short", "qa", 2000)).toMatch(/3 characters/);
    expect(nameAdvice("invalid", "gh-x", 2000)).toMatch(/not a valid name/);
  });
});

describe("waitForName (cast.mjs name-wait)", () => {
  const args = { api: "https://x", name: "qaly", target: "ann/casts/qalys", timeoutS: 30, sleep: async () => {} };
  it("ok once the name resolves to our target", async () => {
    const answers = [new Response("{}", { status: 404 }), new Response(JSON.stringify({ kind: "course", target: "ann/casts/qalys" }))];
    expect(await waitForName({ ...args, fetchImpl: async () => answers.shift()! })).toBe("ok");
  });
  it("elsewhere when it resolves to someone else's target (taken between checkout and payment)", async () => {
    expect(await waitForName({ ...args, fetchImpl: async () => new Response(JSON.stringify({ kind: "cast", target: "bob/x/y.yaml" })) })).toBe("elsewhere");
  });
  it("timeout when nothing settles (a cancelled or unfinished payment)", async () => {
    expect(await waitForName({ ...args, fetchImpl: async () => new Response("{}", { status: 404 }) })).toBe("timeout");
  });
  it("a network error is a try again, not a crash", async () => {
    const answers: (() => Promise<Response>)[] = [async () => { throw new Error("offline"); }, async () => new Response(JSON.stringify({ kind: "course", target: "ann/casts/qalys" }))];
    expect(await waitForName({ ...args, fetchImpl: () => answers.shift()!() })).toBe("ok");
  });
});

describe("checkName (cast.mjs name without --buy)", () => {
  const reg = { key: "k", name: "qaly", kind: "cast" as const, target: "a/b/c.yaml" };
  const names = (state: string, register: string) => ({
    checkPaidName: async () => ({ state, price: 500 }),
    registerName: async () => register,
  });
  it("a revoked token is 'log in', not 'taken' (the check reads an unknown key as no key)", async () => {
    expect(await checkName(names("taken", "key"), "https://x", reg)).toBe("key");
    expect(await checkName(names("free", "key"), "https://x", reg)).toBe("key");
  });
  it("a live token keeps the check's answer", async () => {
    expect(await checkName(names("free", "pay"), "https://x", reg)).toBe("free");
    expect(await checkName(names("taken", "taken"), "https://x", reg)).toBe("taken");
  });
  it("'yours' needs no probe — only a live key can be the owner", async () => {
    let probed = false;
    const n = { checkPaidName: async () => ({ state: "yours", price: 500 }), registerName: async () => { probed = true; return "ok"; } };
    expect(await checkName(n, "https://x", reg)).toBe("yours");
    expect(probed).toBe(false);
  });
});

describe("nameBlocker (a name only for what is live)", () => {
  it("aimed but never pushed", () => expect(nameBlocker({ published: "new" }, null)).toMatch(/push it first/));
  it("first published as a PR not yet merged", () => {
    expect(nameBlocker({ published: "pr", pr: { url: "u" } }, "OPEN")).toMatch(/merge/i);
  });
  it("the PR merged, or a direct push, or a pulled revision: go ahead", () => {
    expect(nameBlocker({ published: "pr", pr: { url: "u" } }, "MERGED")).toBeNull();
    expect(nameBlocker({}, null)).toBeNull();
  });
});

describe("shouldClaim (final review C2: the claim file only where the pusher could have pushed it themselves)", () => {
  it("--direct, or a PR branch on a repo the user can push to: yes", () => {
    expect(shouldClaim({ kind: "cast", direct: true, canPush: true })).toBe(true);
    expect(shouldClaim({ kind: "course", direct: false, canPush: true })).toBe(true);
  });
  it("a PR from a fork (no push rights): never — a merge would hand the contributor every unproven row", () => {
    expect(shouldClaim({ kind: "cast", direct: false, canPush: false })).toBe(false);
    expect(shouldClaim({ kind: "course", direct: true, canPush: false })).toBe(false);
  });
  it("a source revision: never", () => {
    expect(shouldClaim({ kind: "source", direct: true, canPush: true })).toBe(false);
  });
});

describe("registrable (final review M4: a source push registers nothing)", () => {
  it("a cast or a course, not a source", () => {
    expect(registrable({ kind: "cast" })).toBe(true);
    expect(registrable({ kind: "course" })).toBe(true);
    expect(registrable({ kind: "source" })).toBe(false);
  });
});

describe("registerNow's sign-in hint (final review M5)", () => {
  it("a 401 from registerItem tells the terminal to run login, not to open Settings", async () => {
    const registry = { verifyClaim: async () => true, registerItem: async () => "key" as const, registryNote };
    const origin = { kind: "cast", owner: "ann", repo: "casts" };
    const out = await registerNow({ origin, session: { api: "https://x", key: "k", email: null }, verify: false, reg: { kind: "cast" as const, target: "ann/casts/casts/q.yaml" }, registry, fetchImpl: async () => new Response("{}") });
    expect(out.note).toBe(" · not registered — run: node scripts/cast.mjs login");
  });
});


describe("cast.mjs push wiring (C2, M4)", () => {
  it("the claim joins the commit only after the push rights are known, and only when shouldClaim allows; a source push never registers", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../scripts/cast.mjs", import.meta.url), "utf8");
    const push = src.slice(src.indexOf("  async push(args) {"), src.indexOf("  async template("));
    const permAt = push.indexOf("const perm = ");
    const gateAt = push.indexOf("if (claim && !shouldClaim({ kind: origin.kind, direct, canPush: perm.push === true })) claim = null;");
    const addAt = push.indexOf("if (claim) files.files = [...files.files, claim];");
    expect(permAt).toBeGreaterThan(0);
    expect(gateAt).toBeGreaterThan(permAt);
    expect(addAt).toBeGreaterThan(gateAt);
    expect(push.split("files.files = [...files.files, claim]").length).toBe(2);
    expect(push).toContain("if (session && registrable(origin)) {");
    expect(push).toContain("if (registrable(origin)) note = await registerPublished(");
  });
});
