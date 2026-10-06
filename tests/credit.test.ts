// Narration credit (registry delivery 3, task 4): the client half of the
// contract Anvil's credit-catalogue branch fixes — POST text/plain JSON to
// `${api}/_/api/...`. Same test idiom as tests/registry-client.test.ts
// (fetchReturning/throwing/calls helpers), since credit.ts is registry.ts's
// sibling for the same server.

import { describe, expect, test, vi } from "vitest";
import { CreditError, creditBalance, creditInHash, serverSynthesize, startCreditPayment } from "../src/credit";

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
const throwing = (): typeof fetch => vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
const calls = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];

const API = "https://drawcast.anvil.app";

describe("creditBalance", () => {
  test("POSTs text/plain JSON, bounded, and maps the 200 shape", async () => {
    const f = fetchReturning(200, { balance_micro: 4_500_000, balance_usd: "4.50" });
    const out = await creditBalance(API, "k", f);
    expect(out).toEqual({ balanceMicro: 4_500_000, credits: 450, balanceUsd: "4.50" });
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/credit/balance");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(init.body as string)).toEqual({ key: "k" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("a missing balance_usd is derived from the micro amount", async () => {
    const out = await creditBalance(API, "k", fetchReturning(200, { balance_micro: 1_000_000 }));
    expect(out).toEqual({ balanceMicro: 1_000_000, credits: 100, balanceUsd: "1.00" });
  });

  test("401 -> key, a malformed 200 (no balance_micro) -> error, anything else non-2xx -> error", async () => {
    expect(await creditBalance(API, "k", fetchReturning(401, { error: "key" }))).toBe("key");
    expect(await creditBalance(API, "k", fetchReturning(200, {}))).toBe("error");
    expect(await creditBalance(API, "k", fetchReturning(429, {}))).toBe("error");
    expect(await creditBalance(API, "k", fetchReturning(500, {}))).toBe("error");
  });

  test("a network error never throws — error", async () => {
    await expect(creditBalance(API, "k", throwing())).resolves.toBe("error");
  });
});

describe("startCreditPayment", () => {
  const body = { key: "k", cents: 500 as const, return: "https://www.drawcast.app/" };

  test("POSTs text/plain JSON and returns the Checkout url", async () => {
    const f = fetchReturning(200, { url: "https://checkout.stripe.com/pay/cs_test_credit" });
    const out = await startCreditPayment(API, body, f);
    expect(out).toEqual({ url: "https://checkout.stripe.com/pay/cs_test_credit" });
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/credit/pay");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  test("is bounded like creditBalance — an AbortSignal timeout, never a hang (final review M13)", async () => {
    const f = fetchReturning(200, { url: "https://checkout.stripe.com/pay/x" });
    await startCreditPayment(API, body, f);
    expect(calls(f)[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  test("409 -> pending, 401 -> key, a malformed 200 (no url) -> error, anything else -> error", async () => {
    expect(await startCreditPayment(API, body, fetchReturning(409, { error: "pending" }))).toBe("pending");
    expect(await startCreditPayment(API, body, fetchReturning(401, { error: "key" }))).toBe("key");
    expect(await startCreditPayment(API, body, fetchReturning(200, {}))).toBe("error");
    expect(await startCreditPayment(API, body, fetchReturning(400, {}))).toBe("error");
  });

  test("a network error never throws — error", async () => {
    await expect(startCreditPayment(API, body, throwing())).resolves.toBe("error");
  });
});

describe("creditInHash — Stripe's return for a credit purchase", () => {
  test("reads creditpaid/creditunpaid and the cents, and nothing else", () => {
    expect(creditInHash("#creditpaid=500")).toEqual({ outcome: "creditpaid", cents: 500 });
    expect(creditInHash("#creditunpaid=0")).toEqual({ outcome: "creditunpaid", cents: 0 });
    expect(creditInHash("#privpaid=x")).toBeNull();
    expect(creditInHash("#creditpaid=abc")).toBeNull();
    expect(creditInHash("")).toBeNull();
  });
});

describe("CreditError", () => {
  test("formats both dollar amounts to 2 decimals in its own message", () => {
    const e = new CreditError(3_450_000, 1_000_000);
    expect(e.message).toBe("Not enough credit for narration — about 345 credits needed, 100 credits left. Buy credit under Settings → Credits.");
    expect(e.neededMicro).toBe(3_450_000);
    expect(e.balanceMicro).toBe(1_000_000);
    expect(e.name).toBe("CreditError");
  });

  test("a zero balance still says 0 credits left", () => {
    expect(new CreditError(120_000, 0).message).toContain("0 credits left");
  });

  test("fix round 1: a malformed 402 (no numbers at all) is a plain sentence, never a fabricated $0.00 needed/left", () => {
    const e = new CreditError(null, null);
    expect(e.message).toBe("Not enough credit for narration. Buy credit under Settings → Credits.");
    expect(e.neededMicro).toBeNull();
    expect(e.balanceMicro).toBeNull();
  });

  test("one real number and one missing still uses the precise sentence (only BOTH missing falls back)", () => {
    expect(new CreditError(3_450_000, null).message).toBe("Not enough credit for narration — about 345 credits needed, 0 credits left. Buy credit under Settings → Credits.");
  });
});

describe("serverSynthesize", () => {
  const cfg = { rate: 1 };

  test("POSTs text/plain JSON with {key, body} — body is the exact Google request shape — and returns the base64 audio on 200", async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const parsed = JSON.parse(init.body as string) as { key: string; body: unknown };
      expect(parsed.key).toBe("tok");
      expect(parsed.body).toMatchObject({ input: { text: "Hello there." }, audioConfig: { audioEncoding: "MP3" } });
      return new Response(JSON.stringify({ audio: "QUJD", charged_micro: 42 }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await serverSynthesize(API, "tok", cfg, "Hello there.", undefined, f);
    expect(out).toBe("QUJD");
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/tts");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("402 throws CreditError carrying needed/balance", async () => {
    const f = fetchReturning(402, { error: "credit", needed_micro: 300, balance_micro: 100 });
    await expect(serverSynthesize(API, "tok", cfg, "Hello.", undefined, f)).rejects.toThrow(CreditError);
    try {
      await serverSynthesize(API, "tok", cfg, "Hello.", undefined, fetchReturning(402, { needed_micro: 300, balance_micro: 100 }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CreditError);
      expect((err as CreditError).neededMicro).toBe(300);
      expect((err as CreditError).balanceMicro).toBe(100);
      expect((err as CreditError).message).toContain("about 1 credit needed");
    }
  });

  test("fix round 1: a malformed 402 body (no numbers — an unparseable JSON body, say) is the plain fallback sentence, not a fabricated $0.00 needed/left", async () => {
    for (const body of [{}, { error: "credit" }, "not json"]) {
      const f =
        typeof body === "string"
          ? (vi.fn(async () => new Response(body, { status: 402 })) as unknown as typeof fetch)
          : fetchReturning(402, body);
      try {
        await serverSynthesize(API, "tok", cfg, "Hello.", undefined, f);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(CreditError);
        expect((err as CreditError).neededMicro).toBeNull();
        expect((err as CreditError).balanceMicro).toBeNull();
        expect((err as CreditError).message).toBe("Not enough credit for narration. Buy credit under Settings → Credits.");
      }
    }
  });

  test("401 throws a plain sign-in error", async () => {
    await expect(serverSynthesize(API, "tok", cfg, "Hello.", undefined, fetchReturning(401, { error: "key" }))).rejects.toThrow(/Sign in again/);
  });

  test("5xx (502 tts, 503 unconfigured, 429 rate) all throw a plain, safe-to-show error — never CreditError", async () => {
    for (const status of [502, 503, 429, 500]) {
      await expect(serverSynthesize(API, "tok", cfg, "Hello.", undefined, fetchReturning(status, {}))).rejects.not.toBeInstanceOf(CreditError);
    }
  });

  test("a 200 with no audio field is a thrown error, not a silent empty string", async () => {
    await expect(serverSynthesize(API, "tok", cfg, "Hello.", undefined, fetchReturning(200, {}))).rejects.toThrow(/no audio/);
  });

  test("bounded to 30 s", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ audio: "QQ==" }), { status: 200 })) as unknown as typeof fetch;
    await serverSynthesize(API, "tok", cfg, "Hello.", undefined, f);
    const [, init] = calls(f)[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
