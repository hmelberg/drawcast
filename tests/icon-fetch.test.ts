// The scripts' Iconify lookups (scripts/icon-fetch.mjs): a disk cache shared
// by parallel frames/check runs, and a retry that waits out a 429 instead of
// drawing the icon blank.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ICONIFY, iconFetcher, nodeFetch, routePage } from "../scripts/icon-fetch.mjs";

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "icon-fetch-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const URL1 = `${ICONIFY}search?query=glass&limit=64&prefixes=tabler`;
const reply = (status: number, body = "", headers: Record<string, string> = {}): Response => new Response(status === 204 ? null : body, { status, headers });

describe("iconFetcher", () => {
  test("a 429 is retried (after its Retry-After), the 200 cached on disk; a second fetcher asks nothing", async () => {
    const dir = tmp();
    const calls: string[] = [];
    const waits: number[] = [];
    const answers = [reply(429, "", { "retry-after": "2" }), reply(503), reply(200, '{"icons":["tabler:glass"]}', { "content-type": "application/json" })];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${(init?.headers as Record<string, string>)["user-agent"]}`);
      return answers.shift()!;
    }) as unknown as typeof fetch;
    const get = iconFetcher({ dir, fetchImpl, sleep: async (ms: number) => void waits.push(ms) });
    const rec = await get(URL1);
    expect(rec.status).toBe(200);
    expect(JSON.parse(rec.body)).toEqual({ icons: ["tabler:glass"] });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatch(/drawcast-scripts/); // a named User-Agent
    expect(waits[0]).toBe(2000);
    expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toHaveLength(1);

    const again = iconFetcher({ dir, fetchImpl: (async () => { throw new Error("no network"); }) as unknown as typeof fetch });
    expect((await again(URL1)).body).toBe(rec.body);
  });

  test("a 404 is an answer (cached); a 429 that never clears is returned, not cached", async () => {
    const dir = tmp();
    const get404 = iconFetcher({ dir, fetchImpl: (async () => reply(404, "Not found")) as unknown as typeof fetch, sleep: async () => {} });
    expect((await get404(`${ICONIFY}tabler/nope.svg`)).status).toBe(404);
    expect(readdirSync(dir)).toHaveLength(1);
    let n = 0;
    const get429 = iconFetcher({ dir, tries: 3, fetchImpl: (async () => (n++, reply(429))) as unknown as typeof fetch, sleep: async () => {} });
    expect((await get429(URL1)).status).toBe(429);
    expect(n).toBe(3);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  test("at most `parallel` requests in flight", async () => {
    let inFlight = 0, peak = 0;
    const fetchImpl = (async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((ok) => setTimeout(ok, 5));
      inFlight--;
      return reply(200, "x");
    }) as unknown as typeof fetch;
    const get = iconFetcher({ dir: tmp(), fetchImpl, parallel: 2 });
    await Promise.all([1, 2, 3, 4, 5].map((i) => get(`${ICONIFY}tabler/a${i}.svg`)));
    expect(peak).toBe(2);
  });
});

describe("nodeFetch / routePage", () => {
  test("nodeFetch answers Iconify from the fetcher and passes anything else through", async () => {
    const f = nodeFetch(async (url: string) => ({ url, at: 0, status: 200, contentType: "image/svg+xml", body: "<svg/>" }), (async () => reply(200, "other")) as unknown as typeof fetch);
    expect(await (await f(`${ICONIFY}tabler/glass.svg`)).text()).toBe("<svg/>");
    expect(await (await f("https://example.org/x")).text()).toBe("other");
  });

  test("routePage fulfils the page's Iconify requests, with CORS", async () => {
    let pattern = "", handler: ((route: unknown) => Promise<void>) | null = null;
    const page = { route: async (p: string, h: (route: unknown) => Promise<void>) => void ((pattern = p), (handler = h)) };
    await routePage(page, async (url: string) => ({ url, at: 0, status: 200, contentType: "image/svg+xml", body: "<svg/>" }));
    expect(pattern).toBe(`${ICONIFY}**`);
    let fulfilled: Record<string, unknown> | null = null;
    await handler!({ request: () => ({ url: () => `${ICONIFY}tabler/glass.svg` }), fulfill: async (o: Record<string, unknown>) => void (fulfilled = o), abort: async () => {} });
    expect(fulfilled).toMatchObject({ status: 200, body: "<svg/>", headers: { "access-control-allow-origin": "*" } });
  });
});
