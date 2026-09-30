// The picture proxy. DNS, the upstream fetch and the rate store are injected,
// so this suite is about HTTP and the SSRF rules, not the network or Blobs.
import { describe, expect, test } from "vitest";
import { defaultPictureDeps, handlePictureRequest, PROXY_USER_AGENT, type PictureDeps } from "../netlify/functions/picture.mts";
import type { RateStore } from "../netlify/lib/rate-limit.mts";
import type { ResolveAll } from "../netlify/lib/public-host.mts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function memoryStore(): RateStore {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => m.get(k) ?? null,
    setJSON: async (k, v) => void m.set(k, v),
  };
}

/** Hosts ending in .example resolve to a public address unless listed as private. */
const lookup: ResolveAll = async (host) => {
  if (host === "private.example") return [{ address: "10.0.0.5", family: 4 }];
  return [{ address: "93.184.216.34", family: 4 }];
};

function deps(over: Partial<PictureDeps> = {}): PictureDeps & { fetched: string[] } {
  const fetched: string[] = [];
  const store = memoryStore();
  return {
    fetched,
    fetch: (async (url: string) => {
      fetched.push(String(url));
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch,
    lookup,
    rateStore: () => store,
    now: () => Date.parse("2026-09-30T12:00:00Z"),
    clientIp: () => "203.0.113.9",
    ...over,
  };
}

const get = (target: string | null, headers: Record<string, string> = {}) =>
  new Request(`https://drawcast.app/.netlify/functions/picture${target === null ? "" : `?url=${encodeURIComponent(target)}`}`, { headers });

describe("refusals before any fetch", () => {
  test("an http url, a missing url, credentials, a port: 400", async () => {
    for (const t of [null, "http://example.com/a.png", "not a url", "https://user:pw@example.com/a.png", "https://example.com:8443/a.png", "file:///etc/passwd"]) {
      const d = deps();
      const res = await handlePictureRequest(get(t), d);
      expect(res.status, String(t)).toBe(400);
      expect(await res.json()).toHaveProperty("error");
      expect(d.fetched).toEqual([]);
    }
  });
  test("a private host (by name or literal): 403", async () => {
    for (const t of ["https://private.example/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png", "https://169.254.169.254/latest", "https://localhost/a.png", "https://0x7f.1/a.png"]) {
      const d = deps();
      const res = await handlePictureRequest(get(t), d);
      expect(res.status, t).toBe(403);
      expect(d.fetched).toEqual([]);
    }
  });
  test("the proxy itself (a nested ?url= chain): 403", async () => {
    for (const t of ["https://drawcast.app/.netlify/functions/picture?url=https%3A%2F%2Fa.example%2Fb.png", "https://name.drawcast.app/x.png"]) {
      const d = deps();
      const res = await handlePictureRequest(get(t), d);
      expect(res.status, t).toBe(403);
      expect(d.fetched).toEqual([]);
    }
  });
  test("any *.netlify.app host (the site's deploys, previews, branches) is self: 403", async () => {
    for (const t of ["https://drawcast.netlify.app/.netlify/functions/picture?url=x", "https://deploy-preview-12--drawcast.netlify.app/a.png", "https://picture-mapping--drawcast.netlify.app/a.png", "https://someone-else.netlify.app/a.png"]) {
      const d = deps();
      const res = await handlePictureRequest(get(t), d);
      expect(res.status, t).toBe(403);
      expect(d.fetched).toEqual([]);
    }
  });
  test("a request carrying the proxy's own User-Agent is a loop: 403, nothing fetched", async () => {
    for (const ua of [PROXY_USER_AGENT, "Mozilla/5.0 DRAWCAST-PICTURE-PROXY"]) {
      const d = deps();
      const res = await handlePictureRequest(get("https://img.example/a.png", { "user-agent": ua }), d);
      expect(res.status).toBe(403);
      expect(d.fetched).toEqual([]);
    }
  });
  test("the proxy sends that User-Agent upstream", async () => {
    let init: RequestInit | undefined;
    await handlePictureRequest(get("https://img.example/a.png"), deps({
      fetch: (async (_u: string, i: RequestInit) => ((init = i), new Response(PNG, { headers: { "content-type": "image/png" } }))) as unknown as typeof fetch,
    }));
    expect(new Headers(init?.headers).get("user-agent")).toBe(PROXY_USER_AGENT);
  });
  test("not GET: 405", async () => {
    const res = await handlePictureRequest(new Request("https://drawcast.app/.netlify/functions/picture?url=https%3A%2F%2Fa.example%2Fb.png", { method: "POST" }), deps());
    expect(res.status).toBe(405);
  });
});

describe("the upstream answer", () => {
  test("a good png: 200 with the bytes, content-type, cache and CORS headers for an allowed origin", async () => {
    const d = deps();
    const res = await handlePictureRequest(get("https://img.example/a.png", { origin: "https://hmelberg.github.io" }), d);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://hmelberg.github.io");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("netlify-vary")).toBe("header=Origin");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(d.fetched).toEqual(["https://img.example/a.png"]);
  });
  test("the success body is streamed (Netlify's buffered cap), with the right bytes and no content-length", async () => {
    const big = new Uint8Array(7 * 1024 * 1024); // over the ~4.5 MB a buffered answer could carry
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    const res = await handlePictureRequest(get("https://img.example/big.png"), deps({
      fetch: (async () => new Response(big, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch,
    }));
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(res.headers.get("content-length")).toBeNull();
    const reader = res.body!.getReader();
    const parts: Buffer[] = [];
    for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(Buffer.from(r.value));
    const got = Buffer.concat(parts);
    expect(got.length).toBe(big.length);
    expect(Buffer.compare(got, Buffer.from(big.buffer))).toBe(0);
  });
  test("a redirect to a *.netlify.app host: 403", async () => {
    const fetched: string[] = [];
    const res = await handlePictureRequest(get("https://img.example/a.png"), deps({
      fetch: (async (u: string) => (fetched.push(u), new Response(null, { status: 302, headers: { location: "https://drawcast.netlify.app/.netlify/functions/picture?url=https%3A%2F%2Fimg.example%2Fa.png" } }))) as unknown as typeof fetch,
    }));
    expect(res.status).toBe(403);
    expect(fetched).toEqual(["https://img.example/a.png"]);
  });
  test("a foreign origin gets the picture but no CORS header", async () => {
    const res = await handlePictureRequest(get("https://img.example/a.png", { origin: "https://evil.example" }), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });
  test("the fetch is manual-redirect and bounded by a timeout signal", async () => {
    let init: RequestInit | undefined;
    await handlePictureRequest(get("https://img.example/a.png"), deps({
      fetch: (async (_u: string, i: RequestInit) => ((init = i), new Response(PNG, { headers: { "content-type": "image/png" } }))) as unknown as typeof fetch,
    }));
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  test("not an image: 415 (and SVG is refused too — it is script on this origin)", async () => {
    for (const type of ["text/html", "application/json", "", "image/svg+xml"]) {
      const res = await handlePictureRequest(get("https://img.example/a"), deps({
        fetch: (async () => new Response("<html>", { headers: type ? { "content-type": type } : {} })) as unknown as typeof fetch,
      }));
      expect(res.status, type).toBe(415);
    }
  });
  test("a 9 MB stream: 413, and the stream is not read to the end", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled > 9) c.close();
        else c.enqueue(chunk);
      },
    });
    const res = await handlePictureRequest(get("https://img.example/big.png"), deps({
      fetch: (async () => new Response(body, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch,
    }));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(10);
  });
  test("a declared content-length over 8 MB: 413 without reading", async () => {
    const res = await handlePictureRequest(get("https://img.example/big.png"), deps({
      fetch: (async () => new Response(PNG, { headers: { "content-type": "image/png", "content-length": String(9 * 1024 * 1024) } })) as unknown as typeof fetch,
    }));
    expect(res.status).toBe(413);
  });
  test("an upstream error or a thrown fetch: 502", async () => {
    const r1 = await handlePictureRequest(get("https://img.example/a.png"), deps({
      fetch: (async () => new Response("nope", { status: 404, headers: { "content-type": "image/png" } })) as unknown as typeof fetch,
    }));
    expect(r1.status).toBe(502);
    const r2 = await handlePictureRequest(get("https://img.example/a.png"), deps({
      fetch: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch,
    }));
    expect(r2.status).toBe(502);
  });
});

describe("redirects", () => {
  const redirecting = (chain: Record<string, string>) => {
    const fetched: string[] = [];
    const fetch = (async (url: string) => {
      fetched.push(url);
      const to = chain[url];
      if (to) return new Response(null, { status: 302, headers: { location: to } });
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    }) as unknown as typeof globalThis.fetch;
    return { fetch, fetched };
  };
  test("a redirect to 127.0.0.1: 403, never fetched", async () => {
    const r = redirecting({ "https://img.example/a.png": "https://127.0.0.1/admin" });
    const res = await handlePictureRequest(get("https://img.example/a.png"), deps({ fetch: r.fetch }));
    expect(res.status).toBe(403);
    expect(r.fetched).toEqual(["https://img.example/a.png"]);
  });
  test("a redirect to a name resolving privately, or to http: 403", async () => {
    for (const to of ["https://private.example/x.png", "http://img.example/x.png", "/../x"]) {
      const target = to.startsWith("/") ? "https://img.example/x" : to;
      const r = redirecting({ "https://img.example/a.png": to });
      const res = await handlePictureRequest(get("https://img.example/a.png"), deps({ fetch: r.fetch }));
      if (to.startsWith("/")) {
        // a relative Location resolves against the current URL and is fine
        expect(res.status).toBe(200);
        expect(r.fetched).toEqual(["https://img.example/a.png", target]);
      } else {
        expect(res.status, to).toBe(403);
        expect(r.fetched.length).toBe(1);
      }
    }
  });
  test("up to 3 redirects are followed; a 4th is 502", async () => {
    const ok = redirecting({ "https://a.example/1": "https://a.example/2", "https://a.example/2": "https://a.example/3", "https://a.example/3": "https://a.example/4" });
    expect((await handlePictureRequest(get("https://a.example/1"), deps({ fetch: ok.fetch }))).status).toBe(200);
    const tooMany = redirecting({ "https://a.example/1": "https://a.example/2", "https://a.example/2": "https://a.example/3", "https://a.example/3": "https://a.example/4", "https://a.example/4": "https://a.example/5" });
    expect((await handlePictureRequest(get("https://a.example/1"), deps({ fetch: tooMany.fetch }))).status).toBe(502);
    expect(tooMany.fetched.length).toBe(4);
  });
  test("a redirect without a Location: 502", async () => {
    const res = await handlePictureRequest(get("https://img.example/a.png"), deps({
      fetch: (async () => new Response(null, { status: 301 })) as unknown as typeof fetch,
    }));
    expect(res.status).toBe(502);
  });
});

describe("the per-IP budget", () => {
  test("every request counts: the 301st in an hour is 429 with Retry-After", async () => {
    const d = deps();
    for (let i = 0; i < 300; i++) {
      // bad requests count too
      const res = await handlePictureRequest(get(i % 2 ? "https://img.example/a.png" : "http://x"), d);
      expect(res.status).not.toBe(429);
    }
    const res = await handlePictureRequest(get("https://img.example/a.png"), d);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
  test("another IP has its own budget", async () => {
    const store = memoryStore();
    const a = deps({ rateStore: () => store, clientIp: () => "198.51.100.1" });
    for (let i = 0; i < 300; i++) await handlePictureRequest(get("http://x"), a);
    expect((await handlePictureRequest(get("https://img.example/a.png"), a)).status).toBe(429);
    const b = deps({ rateStore: () => store, clientIp: () => "198.51.100.2" });
    expect((await handlePictureRequest(get("https://img.example/a.png"), b)).status).toBe(200);
  });
});

describe("the default export's deps", () => {
  test("its fetch is the pinned publicOnlyFetch, not globalThis.fetch: a private literal is refused with no network", async () => {
    const d = defaultPictureDeps();
    expect(d.fetch).not.toBe(globalThis.fetch);
    await expect(d.fetch("https://127.0.0.1/a.png")).rejects.toThrow(/not public/);
    await expect(d.fetch("https://[::1]/a.png")).rejects.toThrow(/not public/);
  });
});
