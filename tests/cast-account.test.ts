import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearSession, deviceLogin, readSession, writeSession } from "../scripts/cast-account.mjs";

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
