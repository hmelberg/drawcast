// The public-host guard behind the picture proxy (netlify/lib/public-host.mts):
// which addresses count as public, and which host names may be fetched.
import { describe, expect, test } from "vitest";
import { checkPublicHost, isPublicAddress, publicOnlyLookup, type ResolveAll } from "../netlify/lib/public-host.mts";

const resolving = (...ips: string[]): ResolveAll => async () => ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
const failing: ResolveAll = async () => { throw new Error("should not resolve"); };

describe("isPublicAddress", () => {
  test.each([
    "10.1.2.3", "127.0.0.1", "169.254.169.254", "192.168.0.1", "100.64.0.1", "172.16.0.1", "172.31.255.255",
    "0.0.0.0", "192.0.0.8", "198.18.0.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:127.0.0.1",
    "64:ff9b::a00:1", "2002:a00:1::1", "ff02::1", "not an ip", "", "1.2.3", "1.2.3.256",
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
