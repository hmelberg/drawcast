import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearSession, deviceLogin, nameAdvice, readSession, registrationFor, waitForName, writeSession } from "../scripts/cast-account.mjs";
import * as coursePub from "../src/course/publish";
import * as castPub from "../src/publish/cast";
import { parseCourse } from "../src/course/document";

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
