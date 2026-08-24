// Failure-budget limiter (netlify/lib/rate-limit.mts). Mirrors the suite in
// xplainer — the two repos share this file's design.
import { describe, expect, test } from "vitest";
import { checkFailureBudget, recordFailure, type RateStore } from "../netlify/lib/rate-limit.mts";

function fakeStore() {
  const data: Record<string, unknown> = {};
  const store: RateStore = {
    get: async (key) => (key in data ? data[key] : null),
    setJSON: async (key, value) => { data[key] = value; },
  };
  return { store: () => store, data };
}
const throwing = () => { throw new Error("blobs unavailable"); };

const WINDOW = 60_000;
const OPTS = { windowMs: WINDOW, maxFailures: 3 };

describe("failure budget", () => {
  test("a fresh caller is allowed", async () => {
    const { store } = fakeStore();
    expect((await checkFailureBudget("1.2.3.4", { store, ...OPTS })).allowed).toBe(true);
  });

  test("the budget runs out and reports a retry time", async () => {
    const { store } = fakeStore();
    const now = () => 1000;
    for (let i = 0; i < 3; i++) await recordFailure("1.2.3.4", { store, ...OPTS, now });
    const res = await checkFailureBudget("1.2.3.4", { store, ...OPTS, now });
    expect(res.allowed).toBe(false);
    expect(res.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("failures older than the window stop counting", async () => {
    const { store } = fakeStore();
    let clock = 1000;
    const now = () => clock;
    for (let i = 0; i < 3; i++) await recordFailure("1.2.3.4", { store, ...OPTS, now });
    expect((await checkFailureBudget("1.2.3.4", { store, ...OPTS, now })).allowed).toBe(false);
    clock += WINDOW + 1;
    expect((await checkFailureBudget("1.2.3.4", { store, ...OPTS, now })).allowed).toBe(true);
  });

  test("callers are counted separately", async () => {
    const { store } = fakeStore();
    const now = () => 1000;
    for (let i = 0; i < 3; i++) await recordFailure("1.2.3.4", { store, ...OPTS, now });
    expect((await checkFailureBudget("5.6.7.8", { store, ...OPTS, now })).allowed).toBe(true);
  });

  test("a store outage fails OPEN rather than locking everyone out", async () => {
    expect((await checkFailureBudget("1.2.3.4", { store: throwing, ...OPTS })).allowed).toBe(true);
    await recordFailure("1.2.3.4", { store: throwing, ...OPTS });
  });

  test("an unidentifiable caller is not lumped into one shared bucket", async () => {
    const { store } = fakeStore();
    expect((await checkFailureBudget("", { store, ...OPTS })).allowed).toBe(true);
  });
});
