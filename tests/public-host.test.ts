// The public-host guard behind the picture proxy (netlify/lib/public-host.mts):
// which addresses count as public, and which host names may be fetched.
import { describe, expect, test } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { checkPublicHost, isPublicAddress, publicOnlyFetch, publicOnlyLookup, type ResolveAll } from "../netlify/lib/public-host.mts";

const resolving = (...ips: string[]): ResolveAll => async () => ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
const failing: ResolveAll = async () => { throw new Error("should not resolve"); };

describe("isPublicAddress", () => {
  test.each([
    "10.1.2.3", "127.0.0.1", "169.254.169.254", "192.168.0.1", "100.64.0.1", "172.16.0.1", "172.31.255.255",
    "0.0.0.0", "192.0.0.8", "198.18.0.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:127.0.0.1",
    "64:ff9b::a00:1", "2002:a00:1::1", "::ffff:0:808:808", "::ffff:0:a00:1", "64:ff9b:1::808:808", "64:ff9b:1:abcd::1", "ff02::1", "not an ip", "", "1.2.3", "1.2.3.256",
  ])("%s is not public", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  test.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "2a00:1450:4001::200e", "::ffff:8.8.8.8"])("%s is public", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

describe("checkPublicHost", () => {
  test("local names are refused without a lookup", async () => {
    for (const h of ["localhost", "LOCALHOST.", "a.localhost", "printer.local", "metadata.internal", "metadata.google.internal"]) {
      expect(await checkPublicHost(h, failing)).toBe(false);
    }
  });
  test("IP literals are judged as they stand, bracketed or not", async () => {
    expect(await checkPublicHost("127.0.0.1", failing)).toBe(false);
    expect(await checkPublicHost("[::1]", failing)).toBe(false);
    expect(await checkPublicHost("8.8.8.8", failing)).toBe(true);
    expect(await checkPublicHost("[2606:4700::1111]", failing)).toBe(true);
  });
  test("every resolved address must be public", async () => {
    expect(await checkPublicHost("mixed.example", resolving("8.8.8.8", "10.0.0.1"))).toBe(false);
    expect(await checkPublicHost("example.com", resolving("93.184.216.34"))).toBe(true);
  });
  test("no addresses, or a failed lookup, is not public", async () => {
    expect(await checkPublicHost("empty.example", resolving())).toBe(false);
    expect(await checkPublicHost("nx.example", async () => { throw new Error("ENOTFOUND"); })).toBe(false);
  });
  test("the lookup is asked for all addresses", async () => {
    let opts: unknown;
    await checkPublicHost("example.com", async (_h, o) => ((opts = o), [{ address: "93.184.216.34", family: 4 }]));
    expect(opts).toMatchObject({ all: true });
  });
});

describe("publicOnlyLookup (the connect-time check that pins the fetch)", () => {
  const call = (fn: ReturnType<typeof publicOnlyLookup>, host: string, options: { all?: boolean; family?: number }) =>
    new Promise<{ err: Error | null; address: unknown; family?: number }>((resolve) =>
      fn(host, options as never, (err, address, family) => resolve({ err, address, family })));

  test("answers with the checked addresses (all: true and single forms)", async () => {
    const fn = publicOnlyLookup(resolving("93.184.216.34", "2606:4700::1111"));
    expect(await call(fn, "example.com", { all: true })).toMatchObject({ err: null, address: [{ address: "93.184.216.34", family: 4 }, { address: "2606:4700::1111", family: 6 }] });
    expect(await call(fn, "example.com", {})).toMatchObject({ err: null, address: "93.184.216.34", family: 4 });
    expect(await call(fn, "example.com", { family: 6 })).toMatchObject({ err: null, address: "2606:4700::1111", family: 6 });
  });
  test("refuses when any address is not public (a rebinding answer at connect time)", async () => {
    const r = await call(publicOnlyLookup(resolving("93.184.216.34", "127.0.0.1")), "rebind.example", { all: true });
    expect(r.err?.message).toMatch(/not public/);
  });
  test("refuses local names outright", async () => {
    const r = await call(publicOnlyLookup(failing), "localhost", {});
    expect(r.err).toBeTruthy();
  });
});

describe("publicOnlyFetch (no network: node:https is swapped for a fake)", () => {
  type Opts = { lookup: ReturnType<typeof publicOnlyLookup>; signal?: AbortSignal; agent?: unknown };
  /** A fake https.request: records its options and answers with `status`/`body`, or never answers. */
  function fakeRequest(answer?: { status: number; headers?: Record<string, string | string[]>; body?: string }) {
    const seen: Array<{ url: URL; opts: Opts }> = [];
    const request = ((url: URL, opts: Opts, cb: (res: unknown) => void) => {
      seen.push({ url, opts });
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => {
        if (!answer) return;
        const res = Readable.from(answer.body ? [Buffer.from(answer.body)] : []) as Readable & { statusCode: number; headers: Record<string, string | string[]> };
        res.statusCode = answer.status;
        res.headers = answer.headers ?? {};
        queueMicrotask(() => cb(res));
      };
      return req;
    }) as never;
    return { request, seen };
  }

  test("a private IP-literal target is refused before any connection", async () => {
    const f = fakeRequest({ status: 200 });
    const pf = publicOnlyFetch(failing, f.request);
    for (const u of ["https://127.0.0.1/a.png", "https://[::1]/a.png", "https://169.254.169.254/latest", "https://[::ffff:10.0.0.1]/"]) {
      await expect(pf(u)).rejects.toThrow(/not public/);
    }
    await expect(pf("http://93.184.216.34/")).rejects.toThrow(/https only/);
    expect(f.seen).toEqual([]);
  });
  test("the socket gets the public-only lookup (so a rebinding name is refused at connect), no shared agent, and the signal", async () => {
    const f = fakeRequest({ status: 200, body: "x" });
    const signal = new AbortController().signal;
    await publicOnlyFetch(resolving("127.0.0.1"), f.request)("https://rebind.example/a.png", { signal });
    const { opts } = f.seen[0];
    expect(opts.agent).toBe(false);
    expect(opts.signal).toBe(signal);
    const err = await new Promise<Error | null>((r) => opts.lookup("rebind.example", { all: true } as never, (e) => r(e)));
    expect(err?.message).toMatch(/not public/);
  });
  test("a 200 streams its body, with its headers (repeated ones appended)", async () => {
    const f = fakeRequest({ status: 200, headers: { "content-type": "image/png", "x-many": ["a", "b"] }, body: "PNGDATA" });
    const res = await publicOnlyFetch(failing, f.request)("https://93.184.216.34/a.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-many")).toBe("a, b");
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(await res.text()).toBe("PNGDATA");
  });
  test("null-body statuses (204, 304) answer without a body; a redirect keeps its Location", async () => {
    for (const status of [204, 304]) {
      const res = await publicOnlyFetch(failing, fakeRequest({ status }).request)("https://93.184.216.34/");
      expect(res.status).toBe(status);
      expect(res.body).toBeNull();
    }
    const r = await publicOnlyFetch(failing, fakeRequest({ status: 302, headers: { location: "https://x.example/" } }).request)("https://93.184.216.34/");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://x.example/");
  });
  test("a status outside 200..599 becomes a 502 with no body", async () => {
    for (const status of [100, 199, 600, 999]) {
      const res = await publicOnlyFetch(failing, fakeRequest({ status }).request)("https://93.184.216.34/");
      expect(res.status, String(status)).toBe(502);
      expect(res.body).toBeNull();
    }
  });
  test("a request error rejects", async () => {
    const request = ((_u: URL, _o: unknown, _cb: unknown) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => queueMicrotask(() => req.emit("error", new Error("ECONNREFUSED")));
      return req;
    }) as never;
    await expect(publicOnlyFetch(failing, request)("https://93.184.216.34/")).rejects.toThrow(/ECONNREFUSED/);
  });
});
