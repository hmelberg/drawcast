import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  boundedFetch,
  checkName,
  registrable,
  shouldClaim,
  clearSession,
  nameBlocker,
  deviceLogin,
  nameAdvice,
  readSession,
  registerFor,
  registerNow,
  registrationFor,
  waitForName,
  writeSession,
  privateItemFor,
  privateDueMessage,
  privateQuoteAdvice,
  privatePayAdvice,
  waitForPrivate,
  privateCourseText,
  listingAdvice,
  waitForListing,
  creditBalanceAdvice,
  creditPayAdvice,
  waitForCredit,
} from "../scripts/cast-account.mjs";
import * as coursePub from "../src/course/publish";
import * as castPub from "../src/publish/cast";
import { parseCourse } from "../src/course/document";
import * as courseDoc from "../src/course/document";
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


describe("privateItemFor (the item lockText/fetchItemKey bind an envelope to, matching the app's own prediction)", () => {
  it("a cast: the target without .yaml (publish/cast.ts's privateCastTarget)", () => {
    expect(privateItemFor({ kind: "cast" }, { target: "ann/casts/casts/qaly.yaml" })).toBe("ann/casts/casts/qaly");
  });
  it("a course: the target as is — one item for the whole course, applied to every lecture", () => {
    expect(privateItemFor({ kind: "course" }, { target: "ann/casts/qalys" })).toBe("ann/casts/qalys");
  });
});

describe("privateDueMessage / privateQuoteAdvice (cast.mjs private, and push's own refusal)", () => {
  const owed = { due: 2000, currency: "usd", paidLectures: 0, private: false, owner: "you" as const, name: null };
  const paid = { due: 0, currency: "usd", paidLectures: 2, private: true, owner: "you" as const, name: null };
  it("says what is due, in USD, and the exact next command", () => {
    expect(privateDueMessage(owed, "dev-casts/courses/qalys")).toBe(
      "Private needs 20 USD for the new lectures — run: node scripts/cast.mjs private dev-casts/courses/qalys --price 2000",
    );
    expect(privateQuoteAdvice(owed, "dev-casts/courses/qalys")).toBe(privateDueMessage(owed, "dev-casts/courses/qalys"));
  });
  it("nothing due: already paid", () => {
    expect(privateDueMessage(paid, "w")).toBeNull();
    expect(privateQuoteAdvice(paid, "w")).toBe("Private is paid — push to publish locked.");
  });
  it("a missing or revoked session says: log in", () => {
    expect(privateQuoteAdvice("key", "w")).toMatch(/cast\.mjs login/);
  });
  it("the server did not answer", () => {
    expect(privateQuoteAdvice("error", "w")).toMatch(/did not answer/);
  });
  it("registered to another account", () => {
    expect(privateQuoteAdvice({ ...owed, owner: "other" }, "w")).toMatch(/another drawcast account/);
  });
});

describe("privatePayAdvice (cast.mjs private --price, when Checkout never opens)", () => {
  it("each refusal says what to do next, and the key is never in any of them", () => {
    for (const pay of ["nothing-due", "pending", "owner", "key", "error"] as const) {
      const advice = privatePayAdvice(pay);
      expect(advice.length).toBeGreaterThan(0);
      expect(advice).not.toMatch(/[A-Za-z0-9_-]{20,}/); // no token-shaped key ever leaks into the wording
    }
    expect(privatePayAdvice("key")).toMatch(/cast\.mjs login/);
  });
});

describe("waitForPrivate (cast.mjs private: waits for the quote to say paid)", () => {
  const body = { key: "k", kind: "cast" as const, target: "a/b/c.yaml", lectures: 1, private: true };
  it("paid once due is 0 and private is true", async () => {
    const answers = [
      { due: 500, currency: "usd", paidLectures: 0, private: false, owner: "you" as const, name: null },
      { due: 0, currency: "usd", paidLectures: 1, private: true, owner: "you" as const, name: null },
    ];
    const quotePrivate = async () => answers.shift()!;
    expect(await waitForPrivate({ api: "https://x", body, quotePrivate, timeoutS: 30, sleep: async () => {} })).toBe("paid");
  });
  it("due 0 but not yet flagged private keeps polling, not a false paid", async () => {
    const answers = [
      { due: 0, currency: "usd", paidLectures: 1, private: false, owner: "you" as const, name: null },
      { due: 0, currency: "usd", paidLectures: 1, private: true, owner: "you" as const, name: null },
    ];
    const quotePrivate = async () => answers.shift()!;
    expect(await waitForPrivate({ api: "https://x", body, quotePrivate, timeoutS: 30, sleep: async () => {} })).toBe("paid");
  });
  it("times out cleanly when it never settles (a cancelled or unfinished checkout)", async () => {
    const quotePrivate = async () => ({ due: 500, currency: "usd", paidLectures: 0, private: false, owner: "you" as const, name: null });
    expect(await waitForPrivate({ api: "https://x", body, quotePrivate, timeoutS: 10, sleep: async () => {} })).toBe("timeout");
  });
  it("a 'key'/'error' outcome from quotePrivate is not mistaken for paid — kept polling", async () => {
    const answers: ("key" | { due: number; currency: string; paidLectures: number; private: boolean; owner: "you"; name: null })[] = [
      "key",
      { due: 0, currency: "usd", paidLectures: 1, private: true, owner: "you", name: null },
    ];
    const quotePrivate = async () => answers.shift()!;
    expect(await waitForPrivate({ api: "https://x", body, quotePrivate, timeoutS: 30, sleep: async () => {} })).toBe("paid");
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

describe("cast.mjs push wiring (fix round 1, #2/#7): the lock runs before any git write, the claim joins after", () => {
  it("lockLectureFiles is called inside the plan-building withVite, before the first git write (checkout) — and the claim only joins files.files after that", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../scripts/cast.mjs", import.meta.url), "utf8");
    const push = src.slice(src.indexOf("  async push(args) {"), src.indexOf("  async template("));
    const withViteAt = push.indexOf("const files = await withVite(async (load) => {");
    const lockAt = push.indexOf("await lockLectureFiles(planFiles, lecturePaths");
    const claimJoinAt = push.indexOf("if (claim) files.files = [...files.files, claim];");
    const checkoutAt = push.indexOf('git("checkout", "--quiet", "--force", "-B", branch, upstream);');
    expect(withViteAt).toBeGreaterThan(0);
    expect(lockAt).toBeGreaterThan(withViteAt);
    expect(checkoutAt).toBeGreaterThan(lockAt);
    expect(claimJoinAt).toBeGreaterThan(lockAt);
    // The real app lock (publish/lock.ts), never a second copy of its checks.
    expect(push).toContain('await load("/src/publish/lock.ts")');
    expect(push).not.toMatch(/\blockPlanFiles\b/);
  });

  it("a private source refuses before any git write at all (not merely before the lock)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../scripts/cast.mjs", import.meta.url), "utf8");
    const push = src.slice(src.indexOf("  async push(args) {"), src.indexOf("  async template("));
    const refuseAt = push.indexOf('if (origin.kind === "source" && origin.private) throw new Error("a private source can\'t be pushed");');
    const firstFetchAt = push.indexOf('git("fetch", "--quiet", "--depth", "1", "origin", origin.branch);');
    expect(refuseAt).toBeGreaterThan(0);
    expect(refuseAt).toBeLessThan(firstFetchAt);
  });
});

describe("privateCourseText (final review I1a): a private course push writes private: true and the Join door into course.md", () => {
  const lib = { ...coursePub, ...courseDoc };
  const text = "# QALYs\n\n## 1. What a QALY is\n";
  it("marks the course private and gives its page a Join door", () => {
    const out = privateCourseText(text, lib);
    const course = parseCourse(out);
    expect(course.private).toBe(true);
    expect(course.enroll).toBeDefined();
  });
  it("is idempotent: a second push changes nothing", () => {
    const once = privateCourseText(text, lib);
    expect(privateCourseText(once, lib)).toBe(once);
  });
  it("cast.mjs push rewrites the workdir's course.md with it before the plan is built", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../scripts/cast.mjs", import.meta.url), "utf8");
    const push = src.slice(src.indexOf("  async push(args) {"), src.indexOf("  async template("));
    const markAt = push.indexOf("privateCourseText(");
    const writeAt = push.indexOf('writeFileSync(resolve(wd, "course.md"), text)');
    const planAt = push.indexOf("const plan = buildPublishPlan({");
    expect(markAt).toBeGreaterThan(0);
    expect(writeAt).toBeGreaterThan(markAt);
    expect(planAt).toBeGreaterThan(writeAt);
    expect(push.slice(markAt - 300, markAt)).toContain("if (origin.private) {");
  });
});

describe("cast.mjs private --unlisted (registry deliveries 3–4, task 10): the pay body now carries private and listed explicitly", () => {
  const src: string = readFileSync(new URL("../scripts/cast.mjs", import.meta.url), "utf8");
  const priv = src.slice(src.indexOf("  async private(args) {"), src.indexOf("  /**\n   * Registry deliveries 3–4, task 10: whether"));

  it("parses --unlisted and carries it into the quote's own `listed` field", () => {
    expect(priv).toContain('const unlisted = args.includes("--unlisted");');
    expect(priv).toContain("const body = { key: session.key, kind: origin.kind, target, lectures, private: true, listed: !unlisted };");
  });

  it("the pay body spreads payListedFields(true, !unlisted) — never a literal private/listed of its own", () => {
    const payCall = priv.slice(priv.indexOf("const pay = await startPrivatePayment("), priv.indexOf("if (typeof pay !== \"object\") throw new Error(privatePayAdvice(pay));"));
    expect(payCall).toContain("...payListedFields(true, !unlisted),");
    expect(payCall).not.toMatch(/\bprivate:\s*(true|false|!unlisted),/); // no hand-assembled {private, listed} at the pay call site
  });

  it("loads payListedFields from the app's own src/ui/share.ts (never a second copy of it)", () => {
    expect(priv).toContain('await load("/src/ui/share.ts")');
  });
});

describe("cast.mjs listing (registry deliveries 3–4, task 10): the unlist-only pay body carries private:false, listed:false", () => {
  const src: string = readFileSync(new URL("../scripts/cast.mjs", import.meta.url), "utf8");
  const listing = src.slice(src.indexOf("  async listing(args) {"), src.indexOf("  /**\n   * Registry delivery 3, task 5"));

  it("requires exactly one of --listed / --unlisted", () => {
    expect(listing).toContain("if (wantListed === wantUnlisted) throw new Error(");
  });

  it("quotes with listed matching the request, and private:false — listing never touches the lock", () => {
    expect(listing).toContain("const body = { key: session.key, kind: origin.kind, target: reg.target, lectures, private: false, listed: wantListed };");
  });

  it("--listed calls setListing(…, true) directly — always free, no payment path", () => {
    const listedBranch = listing.slice(listing.indexOf("if (wantListed) {"), listing.indexOf("// --unlisted:"));
    expect(listedBranch).toContain("await setListing(session.api, session.key, item, true, boundedFetch());");
    expect(listedBranch).not.toContain("startPrivatePayment");
  });

  it("the unlist-only pay body spreads payListedFields(false, false) — the item stays public", () => {
    expect(listing).toContain("...payListedFields(false, false),");
  });

  it("loads payListedFields from the app's own src/ui/share.ts (never a second copy of it)", () => {
    expect(listing).toContain('await load("/src/ui/share.ts")');
  });

  it("polls with waitForListing(wantListed: false) after paying, the same idiom as private's waitForPrivate", () => {
    expect(listing).toContain("await waitForListing({ api: session.api, body, quotePrivate, wantListed: false, fetchImpl: boundedFetch() });");
  });
});

describe("listingAdvice (cast.mjs listing)", () => {
  it("ok says listed or unlisted, by direction", () => {
    expect(listingAdvice("ok", true, "w")).toBe("w: listed.");
    expect(listingAdvice("ok", false, "w")).toBe("w: unlisted.");
  });
  it("a missing or revoked session says: log in", () => {
    expect(listingAdvice("key", false, "w")).toMatch(/cast\.mjs login/);
  });
  it("registered to another account", () => {
    expect(listingAdvice("owner", false, "w")).toMatch(/another drawcast account/);
  });
  it("the server did not answer", () => {
    expect(listingAdvice("error", false, "w")).toMatch(/did not answer/);
  });
  it("a {due} answer says the exact next command, and never the key", () => {
    const advice = listingAdvice({ due: 500 }, false, "dev-casts/pulled/x");
    expect(advice).toMatch(/5 USD|500/);
    expect(advice).toContain("cast.mjs listing dev-casts/pulled/x --unlisted --price 500");
    expect(advice).not.toMatch(/[A-Za-z0-9_-]{20,}/);
  });
});

describe("waitForListing (cast.mjs listing --unlisted: waits for the quote's listed to settle)", () => {
  const body = { key: "k", kind: "cast" as const, target: "a/b/c.yaml", lectures: 1, private: false, listed: false };
  it('"done" once the quote reports listed matching wantListed', async () => {
    const answers = [
      { due: 500, currency: "usd", paidLectures: 0, private: false, listed: true, owner: "you" as const, name: null },
      { due: 0, currency: "usd", paidLectures: 1, private: false, listed: false, owner: "you" as const, name: null },
    ];
    const quotePrivate = async () => answers.shift()!;
    expect(await waitForListing({ api: "https://x", body, quotePrivate, wantListed: false, timeoutS: 30, sleep: async () => {} })).toBe("done");
  });
  it("times out cleanly when it never settles (a cancelled or unfinished checkout)", async () => {
    const quotePrivate = async () => ({ due: 500, currency: "usd", paidLectures: 0, private: false, listed: true, owner: "you" as const, name: null });
    expect(await waitForListing({ api: "https://x", body, quotePrivate, wantListed: false, timeoutS: 10, sleep: async () => {} })).toBe("timeout");
  });
  it("a 'key'/'error' outcome from quotePrivate is not mistaken for done — kept polling", async () => {
    const answers: ("key" | { due: number; currency: string; paidLectures: number; private: boolean; listed: boolean; owner: "you"; name: null })[] = [
      "key",
      { due: 0, currency: "usd", paidLectures: 1, private: false, listed: false, owner: "you", name: null },
    ];
    const quotePrivate = async () => answers.shift()!;
    expect(await waitForListing({ api: "https://x", body, quotePrivate, wantListed: false, timeoutS: 30, sleep: async () => {} })).toBe("done");
  });
});

describe("creditBalanceAdvice / creditPayAdvice (cast.mjs credit)", () => {
  it("shows the balance", () => {
    expect(creditBalanceAdvice({ balanceMicro: 1_500_000, balanceUsd: "1.50" })).toBe("Narration credit: 1.50 USD.");
  });
  it("a missing or revoked session says: log in", () => {
    expect(creditBalanceAdvice("key")).toMatch(/cast\.mjs login/);
    expect(creditPayAdvice("key")).toMatch(/cast\.mjs login/);
  });
  it("the server did not answer", () => {
    expect(creditBalanceAdvice("error")).toMatch(/did not answer/);
    expect(creditPayAdvice("error")).toMatch(/did not answer/);
  });
  it("a pending checkout says so", () => {
    expect(creditPayAdvice("pending")).toMatch(/already open/);
  });
});

describe("waitForCredit (cast.mjs credit --buy: waits for the balance to rise)", () => {
  it("returns the new balance once it has risen above the starting one", async () => {
    const answers = [
      { balanceMicro: 0, balanceUsd: "0.00" },
      { balanceMicro: 5_000_000, balanceUsd: "5.00" },
    ];
    const creditBalance = async () => answers.shift()!;
    const out = await waitForCredit({ api: "https://x", key: "k", startMicro: 0, creditBalance, timeoutS: 30, sleep: async () => {} });
    expect(out).toEqual({ balanceMicro: 5_000_000, balanceUsd: "5.00" });
  });
  it("times out cleanly when the balance never rises (a cancelled or unfinished checkout)", async () => {
    const creditBalance = async () => ({ balanceMicro: 0, balanceUsd: "0.00" });
    expect(await waitForCredit({ api: "https://x", key: "k", startMicro: 0, creditBalance, timeoutS: 10, sleep: async () => {} })).toBe("timeout");
  });
  it("a 'key'/'error' outcome from creditBalance is not mistaken for risen — kept polling", async () => {
    const answers: ("key" | { balanceMicro: number; balanceUsd: string })[] = ["key", { balanceMicro: 2_000_000, balanceUsd: "2.00" }];
    const creditBalance = async () => answers.shift()!;
    const out = await waitForCredit({ api: "https://x", key: "k", startMicro: 1_000_000, creditBalance, timeoutS: 30, sleep: async () => {} });
    expect(out).toEqual({ balanceMicro: 2_000_000, balanceUsd: "2.00" });
  });
});
