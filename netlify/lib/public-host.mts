// Which hosts the picture proxy (netlify/functions/picture.mts) may fetch
// from: the public internet only. Lives in netlify/lib because every module in
// netlify/functions is its own public endpoint.
//
// Three layers, strictest last:
//   - isPublicAddress: one IP address, v4 or v6, judged against the reserved
//     ranges (private, loopback, link-local incl. the cloud metadata address,
//     CGNAT, unique-local, multicast, documentation, and v6 forms that embed a
//     v4 address).
//   - checkPublicHost: a URL hostname — refuses local-looking names, judges IP
//     literals as they stand, and otherwise requires EVERY resolved address
//     to be public. The handler uses it to answer 403 before any fetch, and
//     again for every redirect hop.
//   - publicOnlyLookup / publicOnlyFetch: the DNS-rebinding fix. A check
//     followed by a fetch resolves the name twice, and a hostile resolver can
//     answer "public" the first time and "127.0.0.1" the second. So the real
//     fetch goes through node:https with `lookup` replaced by one that
//     resolves, checks every address, and hands the socket ONLY the checked
//     addresses — the address that is judged is the address that is dialled.
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

export type ResolveAll = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

const defaultResolve: ResolveAll = (hostname, options) => dnsLookup(hostname, options);

// ---- addresses ----------------------------------------------------------

function parseV4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function isPublicV4(b: number[]): boolean {
  const [a, c] = [b[0], b[1]];
  if (a === 0) return false; // 0/8 "this network"
  if (a === 10) return false; // 10/8 private
  if (a === 100 && c >= 64 && c <= 127) return false; // 100.64/10 CGNAT
  if (a === 127) return false; // 127/8 loopback
  if (a === 169 && c === 254) return false; // 169.254/16 link-local (cloud metadata)
  if (a === 172 && c >= 16 && c <= 31) return false; // 172.16/12 private
  if (a === 192 && c === 168) return false; // 192.168/16 private
  if (a === 192 && c === 0 && b[2] === 0) return false; // 192.0.0/24 IETF protocol
  if (a === 192 && c === 0 && b[2] === 2) return false; // 192.0.2/24 documentation
  if (a === 198 && (c === 18 || c === 19)) return false; // 198.18/15 benchmarking
  if (a === 198 && c === 51 && b[2] === 100) return false; // documentation
  if (a === 203 && c === 0 && b[2] === 113) return false; // documentation
  if (a >= 224) return false; // 224/4 multicast, 240/4 reserved, broadcast
  return true;
}

/** Eight 16-bit groups, or null. Accepts `::` and a trailing dotted v4. */
function parseV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  if (s.includes("%")) return null; // zone ids are link-local by definition
  const lastColon = s.lastIndexOf(":");
  if (lastColon < 0) return null;
  const last = s.slice(lastColon + 1);
  if (last.includes(".")) {
    const v4 = parseV4(last);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if (![...head, ...rest].every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const given = head.length + rest.length;
  if (halves.length === 1 ? given !== 8 : given > 7) return null;
  const zeros = new Array<number>(8 - given).fill(0);
  return [...head.map((g) => parseInt(g, 16)), ...zeros, ...rest.map((g) => parseInt(g, 16))];
}

function v4From(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function isPublicV6(g: number[]): boolean {
  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(8)) return false; // ::
  if (zeroUpTo(7) && g[7] === 1) return false; // ::1
  if (zeroUpTo(5) && g[5] === 0xffff) return isPublicV4(v4From(g[6], g[7])); // ::ffff:a.b.c.d mapped
  if (zeroUpTo(6)) return false; // ::a.b.c.d, deprecated v4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicV4(v4From(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPublicV4(v4From(g[1], g[2])); // 6to4 embeds a v4
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo (embeds an obfuscated v4)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return false; // 100::/64 discard
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 old site-local
  if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}

/** Whether one IP address is on the public internet. Anything unparseable is not. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const b = parseV4(ip);
    return !!b && isPublicV4(b);
  }
  if (kind === 6) {
    const g = parseV6(ip);
    return !!g && isPublicV6(g);
  }
  return false;
}

// ---- host names ---------------------------------------------------------

/** Lower-cased, trailing dot and IPv6 brackets removed. */
function normalHost(hostname: string): string {
  let h = hostname.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  while (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

function isLocalName(h: string): boolean {
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  // A single label ("intranet", "metadata") only resolves through a search domain — never public.
  if (!h.includes(".")) return true;
  return false;
}

/** Every address the name resolves to, if the name may be fetched at all and all of them are public; else null. */
async function publicAddresses(hostname: string, resolve: ResolveAll): Promise<Array<{ address: string; family: number }> | null> {
  const h = normalHost(hostname);
  const literal = isIP(h);
  if (literal) return isPublicAddress(h) ? [{ address: h, family: literal }] : null;
  if (isLocalName(h)) return null;
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await resolve(h, { all: true, verbatim: true });
  } catch {
    return null;
  }
  if (!Array.isArray(addrs) || addrs.length === 0) return null;
  return addrs.every((a) => isPublicAddress(a.address)) ? addrs : null;
}

/**
 * Whether `hostname` (as in `new URL(u).hostname`) may be fetched: not a
 * local name, and an IP literal that is public or a name whose every
 * resolved address is public. A failed lookup is "no".
 */
export async function checkPublicHost(hostname: string, lookup: ResolveAll = defaultResolve): Promise<boolean> {
  return (await publicAddresses(hostname, lookup)) !== null;
}

// ---- the pinned fetch ---------------------------------------------------

/**
 * A `lookup` for net/tls sockets that resolves, requires every address to be
 * public, and answers only with those addresses — so the connection goes to
 * exactly what was checked. Refuses with an error otherwise.
 */
export function publicOnlyLookup(resolve: ResolveAll = defaultResolve): LookupFunction {
  return (hostname, options, callback) => {
    publicAddresses(hostname, resolve).then(
      (addrs) => {
        const family = options.family === 4 || options.family === "IPv4" ? 4 : options.family === 6 || options.family === "IPv6" ? 6 : 0;
        const list = (addrs ?? []).filter((a) => !family || a.family === family);
        if (!addrs || list.length === 0) {
          const err = Object.assign(new Error(`host is not public: ${hostname}`), { code: "ENOTPUBLIC" }) as NodeJS.ErrnoException;
          callback(err, options.all ? [] : "", 0);
          return;
        }
        if (options.all) callback(null, list);
        else callback(null, list[0].address, list[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(err, options.all ? [] : "", 0),
    );
  };
}

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/**
 * A fetch-shaped GET over node:https whose socket can only reach public
 * addresses (publicOnlyLookup; an IP-literal host, which skips lookup, is
 * checked here). Never follows redirects — the caller does that, re-checking
 * each hop. `init.signal` aborts the request and the body stream.
 */
export function publicOnlyFetch(resolve: ResolveAll = defaultResolve): typeof fetch {
  const lookup = publicOnlyLookup(resolve);
  return ((input: string | URL, init: RequestInit = {}) =>
    new Promise<Response>((resolvePromise, reject) => {
      const url = new URL(String(input));
      if (url.protocol !== "https:") return reject(new Error("https only"));
      const host = normalHost(url.hostname);
      if (isIP(host) && !isPublicAddress(host)) return reject(new Error(`host is not public: ${host}`));
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => (headers[k] = v));
      const req = httpsRequest(
        url,
        { method: "GET", headers, lookup, agent: false, signal: init.signal ?? undefined },
        (res) => {
          const out = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined) continue;
            if (Array.isArray(v)) v.forEach((x) => out.append(k, x));
            else out.set(k, v);
          }
          const status = res.statusCode ?? 502;
          try {
            if (NULL_BODY.has(status) || status < 200 || status > 599) {
              res.resume();
              resolvePromise(new Response(null, { status: status < 200 || status > 599 ? 502 : status, headers: out }));
            } else {
              resolvePromise(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers: out }));
            }
          } catch (e) {
            res.destroy();
            reject(e);
          }
        },
      );
      req.on("error", reject);
      req.end();
    })) as typeof fetch;
}
