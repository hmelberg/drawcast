import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { redeemFromAddress, redeemToken, signInUrl, signOut, stripToken, tokenInHash } from "../src/account";

const calls = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];

describe("the token in the address", () => {
  test("is found after a name or a cast, and only as its own parameter", () => {
    expect(tokenInHash("#spanish1&t=abc123")).toBe("abc123");
    expect(tokenInHash("#gh=o/r/p.yaml&t=abc123")).toBe("abc123");
    expect(tokenInHash("#spanish1")).toBeNull();
    expect(tokenInHash("#tomorrow=1")).toBeNull();
  });
  test("a malformed percent-escape is not a token, not a crash", () => {
    expect(() => tokenInHash("#spanish1&t=%zz")).not.toThrow();
    expect(tokenInHash("#spanish1&t=%zz")).toBeNull();
  });
  test("is stripped without disturbing the rest", () => {
    expect(stripToken("https://drawcast.app/#spanish1&t=abc&mode=silent")).toBe("https://drawcast.app/#spanish1&mode=silent");
    expect(stripToken("https://drawcast.app/#spanish1&t=abc")).toBe("https://drawcast.app/#spanish1");
    expect(stripToken("https://drawcast.app/#spanish1")).toBe("https://drawcast.app/#spanish1");
  });
});

describe("signInUrl", () => {
  test("sends the return address, encoded", () => {
    expect(signInUrl("https://drawcast.app/#spanish1", "https://drawcast.anvil.app")).toBe(
      "https://drawcast.anvil.app/#signin?return=https%3A%2F%2Fdrawcast.app%2F%23spanish1",
    );
  });
  test("goes to the drawcast server by default, whatever slash the base carries", () => {
    expect(signInUrl("https://drawcast.app/")).toBe("https://drawcast.anvil.app/#signin?return=https%3A%2F%2Fdrawcast.app%2F");
    expect(signInUrl("https://drawcast.app/", "https://drawcast.anvil.app/")).toBe("https://drawcast.anvil.app/#signin?return=https%3A%2F%2Fdrawcast.app%2F");
  });
});

describe("redeemToken", () => {
  test("returns the session token", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ key: "sess" }), { status: 200 })) as unknown as typeof fetch;
    expect(await redeemToken("https://a", "once", f)).toBe("sess");
    // POSTed as text/plain (a simple request, no preflight) to /_/api/redeem,
    // with the one-time token and a label for the tokens table.
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://a/_/api/redeem");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as { token: string; label: string };
    expect(body.token).toBe("once");
    expect(typeof body.label).toBe("string");
  });
  test("a refusal and an outage are both null, never a throw", async () => {
    const bad = vi.fn(async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    expect(await redeemToken("https://a", "once", bad)).toBeNull();
    const dead = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await redeemToken("https://a", "once", dead)).toBeNull();
  });
  test("a 200 without a key is null too", async () => {
    const odd = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    expect(await redeemToken("https://a", "once", odd)).toBeNull();
  });
});

describe("signOut", () => {
  test("posts the key to /_/api/signout and never throws", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await signOut("https://a/", "sess", f);
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://a/_/api/signout");
    expect(JSON.parse(init.body as string)).toEqual({ key: "sess" });
    const dead = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(signOut("https://a", "sess", dead)).resolves.toBeUndefined();
  });
});

describe("redeemFromAddress", () => {
  // jsdom is not enabled for this suite (vite.config.ts sets environment:
  // "node"), so `history` does not exist and the real replaceState call is
  // swallowed by its own catch. Faking it is what lets the token-stripping —
  // the guarantee this function exists for — be asserted at all.
  let replaceState: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    replaceState = vi.fn();
    vi.stubGlobal("history", { replaceState });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("exchanges a token, stores it, strips it from the address and reports true", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ key: "sess" }), { status: 200 })) as unknown as typeof fetch;
    expect(await redeemFromAddress("#spanish1&t=once", "https://drawcast.app/#spanish1&t=once", "https://a", f)).toBe(true);
    expect(calls(f).length).toBe(1);
    expect((JSON.parse(calls(f)[0][1].body as string) as { token: string }).token).toBe("once");
    // The address loses the token and keeps the page the visitor asked for.
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://drawcast.app/#spanish1");
    const written = replaceState.mock.calls[0][2] as string;
    expect(written).not.toMatch(/[#&]t=/);
    expect(written).toContain("#spanish1");
  });
  test("does nothing at all when the address carries no token", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await redeemFromAddress("#spanish1", "https://drawcast.app/#spanish1", "https://a", f)).toBe(false);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(replaceState).not.toHaveBeenCalled();
  });
  test("a refused exchange still strips the token — a dead token must not survive in a copied address — and reports that one was found", async () => {
    const bad = vi.fn(async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    expect(await redeemFromAddress("#spanish1&t=once", "https://drawcast.app/#spanish1&t=once", "https://a", bad)).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://drawcast.app/#spanish1");
  });
  test("an outage strips too, and keeps the parameters after the token", async () => {
    const dead = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await redeemFromAddress("#gh=o/r/p.yaml&t=once&mode=silent", "https://drawcast.app/#gh=o/r/p.yaml&t=once&mode=silent", "https://a", dead)).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://drawcast.app/#gh=o/r/p.yaml&mode=silent");
  });
});
