// tests/card-endpoint.test.ts
// /c/ and /card/ (spec 2026-10-02-share-design §§3–5). The registry, GitHub
// and the server are injected, so this suite is about HTTP: who gets a
// redirect, who gets a card, and that every failure is still a card.
import { describe, expect, test } from "vitest";
import { handleCardRequest, posterUrlFor, type CardDeps } from "../netlify/functions/card.mts";
import { posterPathFor } from "../src/publish/cast";

const FB = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const CAST = 'title: "Why vaccines work"\nsubtitle: Herd immunity.\n';

function deps(over: Partial<CardDeps> = {}): CardDeps & { fetched: string[]; signals: unknown[] } {
  const fetched: string[] = [];
  const signals: unknown[] = [];
  return {
    fetched,
    signals,
    resolve: async (n, signal) => (signals.push(signal), n === "vaccines" ? { kind: "cast", target: "ann/casts/casts/vaccines.yaml" } : n === "srv" ? { kind: "cast", target: "anvil/srv/intro.yaml" } : n === "qaly" ? { kind: "course", target: "ann/casts/courses/qaly" } : n === "drv" ? { kind: "cast", target: "gdrive/abcdefghijkl" } : null),
    fetchText: async (url, signal) => {
      fetched.push(url);
      signals.push(signal);
      if (url.endsWith("casts/vaccines.yaml") || url.endsWith("casts/herd.yaml") || url.includes("_/api/cast?")) return CAST;
      if (url.endsWith("courses/qaly/course.md")) return "# QALY basics\n\nWhat a QALY is.\n";
      return null;
    },
    fetchImage: async (url, signal) => {
      fetched.push(url);
      signals.push(signal);
      return url.endsWith("vaccines.png") || url.endsWith("herd.png") ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }) : null;
    },
    ...over,
  };
}
const get = (path: string, ua: string) => new Request(`https://drawcast.app${path}`, { headers: { "user-agent": ua } });

describe("a person", () => {
  test("is sent to the # link at once, with no lookup", async () => {
    const d = deps();
    const res = await handleCardRequest(get("/c/vaccines", CHROME), d);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://drawcast.app/#vaccines");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(d.fetched).toEqual([]);
  });
  test("the redirect and the card page vary on User-Agent, so the CDN never hands a person a crawler's card", async () => {
    for (const ua of [CHROME, FB]) {
      for (const p of ["/c/vaccines", "/c/nobody", "/c/api"]) {
        const res = await handleCardRequest(get(p, ua), deps());
        expect(res.headers.get("netlify-vary"), `${ua} ${p}`).toBe("header=User-Agent");
        expect(res.headers.get("vary"), `${ua} ${p}`).toBe("User-Agent");
      }
    }
    expect((await handleCardRequest(get("/c/nobody", FB), deps())).headers.get("cache-control")).toBe("public, max-age=600");
  });
  test("a gh path and a sub-name keep their shape; the origin is the request's own", async () => {
    expect((await handleCardRequest(get("/c/gh/ann/casts/casts/herd.yaml", CHROME), deps())).headers.get("location")).toBe("https://drawcast.app/#gh=ann/casts/casts/herd.yaml");
    const preview = new Request("https://deploy-preview-9--drawcast.netlify.app/c/learn-russian/3", { headers: { "user-agent": CHROME } });
    expect((await handleCardRequest(preview, deps())).headers.get("location")).toBe("https://deploy-preview-9--drawcast.netlify.app/#learn-russian/3");
  });
  test("a path that is not a share path goes to the front page, never elsewhere", async () => {
    for (const p of ["/c/", "/c/api", "/c/gh/ann/casts/%2e%2e/x.yaml", "/c/a/b/c"]) {
      const res = await handleCardRequest(get(p, CHROME), deps());
      expect(res.status, p).toBe(302);
      expect(res.headers.get("location"), p).toBe("https://drawcast.app/");
    }
  });
});

describe("a crawler", () => {
  test("a named GitHub cast: its own title, line and picture", async () => {
    const res = await handleCardRequest(get("/c/vaccines", FB), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("public, max-age=600");
    const html = await res.text();
    expect(html).toContain('og:title" content="Why vaccines work"');
    expect(html).toContain('og:description" content="Herd immunity."');
    expect(html).toContain('og:image" content="https://drawcast.app/card/vaccines.png"');
    expect(html).toContain('og:url" content="https://drawcast.app/c/vaccines"');
    expect(html).toContain('og:image:width" content="1000"');
    expect(html).toContain('og:image:height" content="750"');
  });
  test("a cast whose poster is missing points straight at the generic picture, 1200×630, with no /card/ hop", async () => {
    const d = deps({ fetchImage: async () => null });
    const html = await (await handleCardRequest(get("/c/gh/ann/casts/casts/herd.yaml", FB), d)).text();
    expect(html).toContain('og:title" content="Why vaccines work"');
    expect(html).toContain('og:image" content="https://drawcast.app/share-card.png"');
    expect(html).toContain('og:image:width" content="1200"');
    expect(html).toContain('og:image:height" content="630"');
  });
  test("an exists check, when given, is used instead of fetching the picture", async () => {
    const asked: string[] = [];
    const d = deps({ exists: async (url) => (asked.push(url), true), fetchImage: async () => { throw new Error("not this"); } });
    const html = await (await handleCardRequest(get("/c/gh/ann/casts/casts/herd.yaml", FB), d)).text();
    expect(asked).toEqual(["https://raw.githubusercontent.com/ann/casts/HEAD/casts/herd.png"]);
    expect(html).toContain('og:image" content="https://drawcast.app/card/gh/ann/casts/casts/herd.png"');
  });
  test("every fetch in a request shares one deadline signal", async () => {
    const d = deps();
    await handleCardRequest(get("/c/vaccines", FB), d);
    expect(d.signals.length).toBeGreaterThanOrEqual(3);
    expect(d.signals[0]).toBeInstanceOf(AbortSignal);
    for (const s of d.signals) expect(s).toBe(d.signals[0]);
    const c = deps();
    await handleCardRequest(get("/card/vaccines.png", FB), c);
    expect(c.signals.length).toBeGreaterThanOrEqual(3);
    for (const s of c.signals) expect(s).toBe(c.signals[0]);
  });
  test("a gh path: no lookup, own text", async () => {
    const html = await (await handleCardRequest(get("/c/gh/ann/casts/casts/herd.yaml", FB), deps())).text();
    expect(html).toContain('og:title" content="Why vaccines work"');
    expect(html).toContain('og:image" content="https://drawcast.app/card/gh/ann/casts/casts/herd.png"');
  });
  test("a server cast: own text, generic picture", async () => {
    const html = await (await handleCardRequest(get("/c/srv", FB), deps())).text();
    expect(html).toContain('og:title" content="Why vaccines work"');
    expect(html).toContain('og:image" content="https://drawcast.app/share-card.png"');
  });
  test("a course: the course.md heading, generic picture", async () => {
    const html = await (await handleCardRequest(get("/c/qaly", FB), deps())).text();
    expect(html).toContain('og:title" content="QALY basics"');
    expect(html).toContain('og:image" content="https://drawcast.app/share-card.png"');
  });
  test("a private course: the generic card, no trace of its title", async () => {
    const md = "# Secret course\nprivate: true\nslug: secret\n\nA hidden intro.\n";
    const html = await (await handleCardRequest(get("/c/qaly", FB), deps({ fetchText: async () => md }))).text();
    expect(html).toContain('og:title" content="drawcast"');
    expect(html).toContain('og:image" content="https://drawcast.app/share-card.png"');
    expect(html).not.toContain("Secret");
    expect(html).not.toContain("hidden intro");
    expect(html).not.toContain("private");
  });
  test("generic card, status 200: unknown name, Drive, GitHub down, private (locked) cast, a registry that throws", async () => {
    const cases: Array<[string, Partial<CardDeps>]> = [
      ["/c/nobody", {}],
      ["/c/drv", {}],
      ["/c/vaccines", { fetchText: async () => null }],
      ["/c/vaccines", { fetchText: async () => "drawcast-encrypted: 1\ncipher: AAAA\n" }],
      ["/c/vaccines", { resolve: async () => { throw new Error("down"); } }],
      ["/c/api", {}],
    ];
    for (const [p, over] of cases) {
      const res = await handleCardRequest(get(p, FB), deps(over));
      expect(res.status, p).toBe(200);
      const html = await res.text();
      expect(html, p).toContain('og:title" content="drawcast"');
      expect(html, p).toContain('og:image" content="https://drawcast.app/share-card.png"');
      expect(html, p).toContain('og:image:width" content="1200"');
      // The /c/ link itself, when it parsed; the front page only when it did not.
      expect(html, p).toContain(p === "/c/api" ? 'og:url" content="https://drawcast.app/"' : `og:url" content="https://drawcast.app${p}"`);
    }
  });
  test("a course whose first lecture is locked is private, whatever course.md says", async () => {
    const md = "# QALY basics\n\nWhat a QALY is.\n\n---\n## One\nstatus: done · id: abc · file: one.yaml · 2026-09-30\n---\n## Two\nstatus: done · file: two.yaml\n";
    const d = deps({ fetchText: async (url) => (d.fetched.push(url), url.endsWith("course.md") ? md : url.endsWith("/one.yaml") ? "drawcast-encrypted: 1\ncipher: AAAA\n" : "title: x\n") });
    const html = await (await handleCardRequest(get("/c/qaly", FB), d)).text();
    expect(d.fetched).toContain("https://raw.githubusercontent.com/ann/casts/HEAD/courses/qaly/one.yaml");
    expect(html).toContain('og:title" content="drawcast"');
    expect(html).not.toContain("QALY");
  });
  test("a course whose first lecture reads plain, or names no file, keeps its card", async () => {
    const md = "# QALY basics\n\nWhat a QALY is.\n\n---\n## One\nstatus: done · file: one.yaml\n";
    for (const text of [md, "# QALY basics\n\nWhat a QALY is.\n\n---\n## One\nstatus: pending\n", md.replace("one.yaml", "../x.yaml")]) {
      const d = deps({ fetchText: async (url) => (d.fetched.push(url), url.endsWith("course.md") ? text : url.endsWith("/one.yaml") ? "title: One\n" : null) });
      const html = await (await handleCardRequest(get("/c/qaly", FB), d)).text();
      expect(html, text).toContain('og:title" content="QALY basics"');
      expect(d.fetched.some((u) => u.includes("..")), text).toBe(false);
    }
  });
  test("a known cast with no title keeps its own picture and says A drawcast", async () => {
    const html = await (await handleCardRequest(get("/c/vaccines", FB), deps({ fetchText: async () => "items: []\n" }))).text();
    expect(html).toContain('og:title" content="A drawcast"');
    expect(html).toContain('og:image" content="https://drawcast.app/card/vaccines.png"');
  });
});

describe("a course's picture is its first lecture's", () => {
  const MD = "# QALY basics\n\nWhat a QALY is.\n\n---\n## Lecture one\nstatus: done · file: 01-intro.yaml\n";
  const LECTURE = "playlist:\n  title: Lecture one\n";
  const course = (over: Partial<CardDeps> = {}) =>
    deps({
      fetchText: async (url) => (url.endsWith("courses/qaly/course.md") ? MD : url.endsWith("courses/qaly/01-intro.yaml") ? LECTURE : null),
      fetchImage: async (url) => (url.endsWith("courses/qaly/01-intro.png") ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }) : null),
      ...over,
    });

  test("the card names the course and shows the lecture's picture", async () => {
    const html = await (await handleCardRequest(get("/c/qaly", FB), course())).text();
    expect(html).toContain('og:title" content="QALY basics"');
    expect(html).toContain('og:image" content="https://drawcast.app/card/qaly.png"');
    expect(html).toContain('og:image:width" content="1000"');
  });
  test("/card/qaly.png streams the first lecture's picture", async () => {
    const res = await handleCardRequest(get("/card/qaly.png", FB), course());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });
  test("no picture beside the lecture: the generic picture, not a broken one", async () => {
    const html = await (await handleCardRequest(get("/c/qaly", FB), course({ fetchImage: async () => null }))).text();
    expect(html).toContain('og:image" content="https://drawcast.app/share-card.png"');
  });
  test("a lecture with no file yet: the generic picture", async () => {
    const html = await (await handleCardRequest(get("/c/qaly", FB), course({ fetchText: async (url) => (url.endsWith("course.md") ? "# QALY basics\n\nWhat a QALY is.\n\n---\n## Lecture one\nstatus: pending\n" : null) }))).text();
    expect(html).toContain('og:title" content="QALY basics"');
    expect(html).toContain('og:image" content="https://drawcast.app/share-card.png"');
  });
  test("a lecture whose text can't be read: no picture streamed", async () => {
    const d = course({ fetchText: async (url) => (url.endsWith("course.md") ? MD : null) });
    const res = await handleCardRequest(get("/card/qaly.png", FB), d);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://drawcast.app/share-card.png");
    expect(d.fetched.some((u) => u.endsWith(".png"))).toBe(false);
  });
});

describe("/card/ pictures", () => {
  test("no poster is streamed when the cast's text could not be read (it might be private)", async () => {
    const d = deps({ fetchText: async () => null });
    const res = await handleCardRequest(get("/card/vaccines.png", FB), d);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://drawcast.app/share-card.png");
    expect(d.fetched.some((u) => u.endsWith(".png"))).toBe(false);
  });
  test("the poster beside a GitHub cast, streamed with a cache header", async () => {
    const d = deps();
    const res = await handleCardRequest(get("/card/vaccines.png", FB), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    // The CDN keeps it too: a front page of cards is one call per picture per hour.
    expect(res.headers.get("netlify-cdn-cache-control")).toBe("public, durable, max-age=3600, stale-while-revalidate=86400");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(d.fetched).toContain("https://raw.githubusercontent.com/ann/casts/HEAD/casts/vaccines.png");
  });
  test("anything else is the generic picture by redirect", async () => {
    for (const p of ["/card/nobody.png", "/card/srv.png", "/card/drv.png", "/card/qaly.png", "/card/gh/ann/casts/casts/nopic.png", "/card/x"]) {
      const res = await handleCardRequest(get(p, CHROME), deps());
      expect(res.status, p).toBe(302);
      expect(res.headers.get("access-control-allow-origin"), p).toBe("*");
      expect(res.headers.get("location"), p).toBe("https://drawcast.app/share-card.png");
      // A miss may be a timed-out lookup: never kept by the CDN, a minute in the browser.
      expect(res.headers.get("cache-control"), p).toBe("public, max-age=60");
      expect(res.headers.get("netlify-cdn-cache-control"), p).toBe("no-store");
    }
  });
});

test("the poster rule is the publisher's own", () => {
  for (const p of ["casts/a.yaml", "x/y/b.yml", "c.YAML"]) {
    expect(posterUrlFor("o", "r", p)).toBe(`https://raw.githubusercontent.com/o/r/HEAD/${posterPathFor(p)}`);
  }
});

test("anything but GET or HEAD is refused", async () => {
  const res = await handleCardRequest(new Request("https://drawcast.app/c/vaccines", { method: "POST" }), deps());
  expect(res.status).toBe(405);
});

test("the generic picture is served with CORS (the /card/ fallback redirects to it; the share box fetches it)", async () => {
  const { readFileSync } = await import("node:fs");
  const toml = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  expect(toml).toMatch(/\[\[headers\]\]\s*\n\s*for = "\/share-card\.png"\s*\n\s*\[headers\.values\]\s*\n\s*Access-Control-Allow-Origin = "\*"/);
});

test("the app's own page carries the generic Open Graph card", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  expect(html).toContain("<title>drawcast</title>");
  for (const tag of [
    '<meta property="og:title" content="drawcast"',
    '<meta property="og:description" content="Drawn explanations you can watch and play with"',
    '<meta property="og:image" content="https://drawcast.app/share-card.png"',
    '<meta property="og:image:width" content="1200"',
    '<meta property="og:image:height" content="630"',
    '<meta property="og:type" content="website"',
    '<meta name="twitter:card" content="summary_large_image"',
  ]) expect(html).toContain(tag);
});


describe(".cast casts (published since 2026-10-03)", () => {
  const CAST_SCRIPT = '# Why vaccines work\nsubtitle: "Herd immunity, drawn."\n\n## Why vaccines work\nHello.\n    text t "Herd" x 100 y 100\n';
  const dotCast = (over: Partial<CardDeps> = {}) =>
    deps({
      resolve: async (n) => (n === "herd" ? { kind: "cast", target: "ann/casts/casts/herd.cast" } : null),
      fetchText: async (url) => (url.endsWith("casts/herd.cast") ? CAST_SCRIPT : null),
      fetchImage: async (url) => (url.endsWith("casts/herd.png") ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }) : null),
      ...over,
    });
  test("a name pointing at a .cast file: its own title, line and picture", async () => {
    const html = await (await handleCardRequest(get("/c/herd", FB), dotCast())).text();
    expect(html).toContain('og:title" content="Why vaccines work"');
    expect(html).toContain('og:description" content="Herd immunity, drawn."');
    expect(html).toContain('og:image" content="https://drawcast.app/card/herd.png"');
  });
  test("/card/<name>.png streams the .cast's poster", async () => {
    const res = await handleCardRequest(get("/card/herd.png", FB), dotCast());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });
  test("a locked .cast is the generic card", async () => {
    const html = await (await handleCardRequest(get("/c/herd", FB), dotCast({ fetchText: async () => "drawcast-encrypted: 1\ncipher: AAAA\n" }))).text();
    expect(html).toContain('og:title" content="drawcast"');
  });
});

describe("kept pictures (home-cards round, 2026-10-05)", () => {
  function memCache() {
    const m = new Map<string, { bytes: Uint8Array; at: number; thumb: string }>();
    return {
      m,
      get: async (k: string) => m.get(k) ?? null,
      set: async (k: string, bytes: Uint8Array, meta: { at: number; thumb: string }) => void m.set(k, { bytes, ...meta }),
      delete: async (k: string) => void m.delete(k),
    };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("a built picture is kept, and the next request is served from it with no lookup", async () => {
    const cache = memCache();
    const first = await handleCardRequest(get("/card/vaccines.png", CHROME), deps({ cache, now: () => 1000 }));
    expect(first.status).toBe(200);
    expect(first.headers.get("x-card")).toBe("built");
    await settle();
    expect(cache.m.has("vaccines.png")).toBe(true);
    const d = deps({ cache, now: () => 2000 });
    const second = await handleCardRequest(get("/card/vaccines.png", CHROME), d);
    expect(second.headers.get("x-card")).toBe("stored");
    expect(d.fetched).toEqual([]);
  });

  test("an old kept picture is still served at once, and checked again in the background", async () => {
    const cache = memCache();
    cache.m.set("vaccines.png", { bytes: new Uint8Array([1]), at: 0, thumb: "plain" });
    const deferred: Promise<unknown>[] = [];
    const d = deps({ cache, now: () => 60 * 60 * 1000, defer: (w) => void deferred.push(w) });
    const res = await handleCardRequest(get("/card/vaccines.png", CHROME), d);
    expect(res.headers.get("x-card")).toBe("stored");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1]));
    await Promise.all(deferred);
    expect(cache.m.get("vaccines.png")!.bytes).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  test("?refresh builds anew even when a picture is kept", async () => {
    const cache = memCache();
    cache.m.set("vaccines.png", { bytes: new Uint8Array([1]), at: 0, thumb: "plain" });
    const res = await handleCardRequest(get("/card/vaccines.png?refresh=1", CHROME), deps({ cache, now: () => 5 }));
    expect(res.headers.get("x-card")).toBe("built");
  });

  test("a cast with no picture any more is forgotten, and gets the generic card", async () => {
    const cache = memCache();
    cache.m.set("nobody.png", { bytes: new Uint8Array([1]), at: 0, thumb: "plain" });
    const res = await handleCardRequest(get("/card/nobody.png?refresh=1", CHROME), deps({ cache }));
    expect(res.status).toBe(302);
    await settle();
    expect(cache.m.has("nobody.png")).toBe(false);
  });

  test("a build that runs out of time is a 503 to retry for a person, and the generic card for a crawler", async () => {
    const slow = { deadlineMs: 20, fetchText: (_u: string, signal?: AbortSignal) => new Promise<string | null>((r) => signal?.addEventListener("abort", () => r(null))) };
    const res = await handleCardRequest(get("/card/vaccines.png", CHROME), deps(slow));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(res.headers.get("netlify-cdn-cache-control")).toBe("no-store");
    const bot = await handleCardRequest(get("/card/vaccines.png", FB), deps(slow));
    expect(bot.status).toBe(302);
  });

  test("a picture whose drawing failed is not kept, and is cached only briefly", async () => {
    const cache = memCache();
    const castWithThumb = 'title: "Why vaccines work"\nthumb: band "Herd"\n';
    const d = deps({ cache, fetchText: async () => castWithThumb, draw: () => { throw new Error("thumb fonts not found"); } });
    const res = await handleCardRequest(get("/card/vaccines.png", CHROME), d);
    expect(res.headers.get("x-thumb")).toMatch(/^error/);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    await settle();
    expect(cache.m.size).toBe(0);
  });
});
