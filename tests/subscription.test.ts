// Subscriptions client (credit plan delivery 4).
import { describe, expect, test } from "vitest";
import { openPortal, startSubscription, planStatus, subscribedInHash, subStatus } from "../src/subscription";

const replying = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const PLANS = { basic: { cents: 500, quota_mb: 10, label: "Basic" }, pro: { cents: 900, quota_mb: 50, label: "Pro" } };

describe("subscription client", () => {
  test("status maps the server's shape", async () => {
    const st = await subStatus("https://a", "k", replying(200, { plan: "pro", active: true, grace: false, admin: false, until: "2026-11-06T00:00:00+00:00", quota_bytes: 52428800, used_bytes: 1048576, manageable: true, plans: PLANS, on_sale: true }));
    expect(st).toMatchObject({ plan: "pro", active: true, quotaBytes: 52428800, usedBytes: 1048576, manageable: true, onSale: true });
    expect(typeof st === "object" && st.plans.pro).toEqual({ cents: 900, quotaMb: 50, label: "Pro" });
    expect(await subStatus("https://a", "k", replying(401, {}))).toBe("key");
  });

  test("start: a checkout url, or a word for each refusal", async () => {
    const body = { key: "k", plan: "pro", return: "https://www.drawcast.app/" };
    expect(await startSubscription("https://a", body, replying(200, { url: "https://stripe" }))).toEqual({ url: "https://stripe" });
    expect(await startSubscription("https://a", body, replying(409, {}))).toBe("subscribed");
    expect(await startSubscription("https://a", body, replying(403, {}))).toBe("closed");
    expect(await openPortal("https://a", { key: "k", return: "r" }, replying(404, {}))).toBe("none");
  });

  test("the return fragment", () => {
    expect(subscribedInHash("#subscribed=pro")).toEqual({ plan: "pro" });
    expect(subscribedInHash("#subscribed=0")).toEqual({ plan: null });
    expect(subscribedInHash("#creditpaid=500")).toBeNull();
  });

  test("the plan line says what the account has", () => {
    const base = { plan: null, active: false, grace: false, admin: false, until: null, quotaBytes: 0, usedBytes: 0, manageable: false, plans: { pro: { cents: 900, quotaMb: 50, label: "Pro" } }, onSale: true };
    expect(planStatus(base)).toBe("");
    // Hans 2026-10-06: no "Admin — counts as Business…" line; the card says it.
    expect(planStatus({ ...base, admin: true })).toBe("");
    expect(planStatus({ ...base, plan: "pro", active: true, until: "2026-11-06T00:00:00Z", quotaBytes: 50 * 1048576, usedBytes: 1048576 })).toMatch(/^Paid until .* · 1\.0 of 50 MB used\.$/);
    expect(planStatus({ ...base, plan: "pro", grace: true, until: "2026-10-01T00:00:00Z" })).toMatch(/ended/);
  });
});
