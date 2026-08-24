// Password redemption (key vending): client-side logic only — the Netlify
// function itself runs outside this suite.

import { describe, expect, test, vi } from "vitest";
import { looksLikeAnthropicKey, redeemPassword } from "../src/keys";

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("looksLikeAnthropicKey", () => {
  test("real keys pass, passwords and junk do not", () => {
    expect(looksLikeAnthropicKey("sk-ant-api03-abc")).toBe(true);
    expect(looksLikeAnthropicKey("Let me in 2000!")).toBe(false);
    expect(looksLikeAnthropicKey("")).toBe(false);
    expect(looksLikeAnthropicKey("AIzaSyExample")).toBe(false);
  });
});

describe("redeemPassword", () => {
  test("success returns both keys and posts the password as JSON", async () => {
    const f = fetchReturning(200, { anthropicKey: "sk-ant-vended", googleKey: "AIza-vended" });
    const r = await redeemPassword("pw", ["/x"], f);
    expect(r).toEqual({ anthropicKey: "sk-ant-vended", googleKey: "AIza-vended" });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/x");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ password: "pw" });
  });

  test("missing googleKey degrades to empty string", async () => {
    const r = await redeemPassword("pw", ["/x"], fetchReturning(200, { anthropicKey: "sk-ant-vended" }));
    expect(r).toEqual({ anthropicKey: "sk-ant-vended", googleKey: "" });
  });

  test("401 yields null", async () => {
    expect(await redeemPassword("wrong", ["/x"], fetchReturning(401, { error: "unauthorized" }))).toBeNull();
  });

  test("network error yields null", async () => {
    const f = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await redeemPassword("pw", ["/x"], f)).toBeNull();
  });

  test("falls through failing endpoints in order and stops at the first success", async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === "/a") return new Response("nope", { status: 404 });
      return new Response(JSON.stringify({ anthropicKey: "sk-ant-vended", googleKey: "" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await redeemPassword("pw", ["/a", "/b", "/c"], f);
    expect(r?.anthropicKey).toBe("sk-ant-vended");
    expect(calls).toEqual(["/a", "/b"]);
  });

  test("malformed success body yields null", async () => {
    expect(await redeemPassword("pw", ["/x"], fetchReturning(200, { nope: true }))).toBeNull();
  });
});

describe("vending endpoint hardening", () => {
  const CONFIGURED = { DRAWCAST_PASSWORD: "open-sesame", ANTHROPIC_API_KEY: "sk-ant-real", GOOGLE_API_KEY: "g-real" };

  function withEnv(vars: Record<string, string>, fn: () => Promise<void>) {
    const saved = { ...process.env };
    Object.assign(process.env, vars);
    return fn().finally(() => {
      for (const k of Object.keys(vars)) delete process.env[k];
      Object.assign(process.env, saved);
    });
  }

  const allowAll = () => ({
    checkBudget: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    recordFailure: async () => {},
    clientIp: () => "1.2.3.4",
  });

  function post(body: unknown) {
    return new Request("https://drawcast.app/.netlify/functions/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("a caller out of budget gets 429 and never reaches the comparison", async () => {
    const { handleKeysRequest } = await import("../netlify/functions/keys.mts");
    await withEnv(CONFIGURED, async () => {
      const res = await handleKeysRequest(post({ password: "open-sesame" }), {
        ...allowAll(),
        checkBudget: async () => ({ allowed: false, retryAfterSeconds: 900 }),
      });
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("900");
    });
  });

  test("wrong passwords are charged, correct ones are not", async () => {
    const { handleKeysRequest } = await import("../netlify/functions/keys.mts");
    await withEnv(CONFIGURED, async () => {
      const charged: string[] = [];
      const deps = { ...allowAll(), recordFailure: async (ip: string) => { charged.push(ip); } };
      await handleKeysRequest(post({ password: "wrong" }), deps);
      expect(charged).toEqual(["1.2.3.4"]);
      const ok = await handleKeysRequest(post({ password: "open-sesame" }), deps);
      expect(ok.status).toBe(200);
      expect(charged).toEqual(["1.2.3.4"]); // unchanged: success costs nothing
    });
  });

  test("the client IP comes from the platform header, never a spoofable one", async () => {
    const { defaultClientIp } = await import("../netlify/functions/keys.mts");
    const real = new Request("https://drawcast.app/x", {
      headers: { "x-nf-client-connection-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" },
    });
    expect(defaultClientIp(real)).toBe("9.9.9.9");
    const spoof = new Request("https://drawcast.app/x", { headers: { "x-forwarded-for": "1.1.1.1" } });
    expect(defaultClientIp(spoof)).toBe("");
  });
});
