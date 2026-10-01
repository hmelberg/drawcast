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

function deps(over: Partial<CardDeps> = {}): CardDeps & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    resolve: async (n) => (n === "vaccines" ? { kind: "cast", target: "ann/casts/casts/vaccines.yaml" } : n === "srv" ? { kind: "cast", target: "anvil/srv/intro.yaml" } : n === "qaly" ? { kind: "course", target: "ann/casts/courses/qaly" } : n === "drv" ? { kind: "cast", target: "gdrive/abcdefghijkl" } : null),
    fetchText: async (url) => {
      fetched.push(url);
      if (url.endsWith("casts/vaccines.yaml") || url.endsWith("casts/herd.yaml") || url.includes("_/api/cast?")) return CAST;
      if (url.endsWith("courses/qaly/course.md")) return "# QALY basics\n\nWhat a QALY is.\n";
      return null;
    },
    fetchImage: async (url) => {
      fetched.push(url);
      return url.endsWith("vaccines.png") ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }) : null;
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
    }
  });
  test("a known cast with no title keeps its own picture and says A drawcast", async () => {
    const html = await (await handleCardRequest(get("/c/vaccines", FB), deps({ fetchText: async () => "items: []\n" }))).text();
    expect(html).toContain('og:title" content="A drawcast"');
    expect(html).toContain('og:image" content="https://drawcast.app/card/vaccines.png"');
  });
});

describe("/card/ pictures", () => {
  test("the poster beside a GitHub cast, streamed with a cache header", async () => {
    const d = deps();
    const res = await handleCardRequest(get("/card/vaccines.png", FB), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(d.fetched).toContain("https://raw.githubusercontent.com/ann/casts/HEAD/casts/vaccines.png");
  });
  test("anything else is the generic picture by redirect", async () => {
    for (const p of ["/card/nobody.png", "/card/srv.png", "/card/drv.png", "/card/qaly.png", "/card/gh/ann/casts/casts/herd.png", "/card/x"]) {
      const res = await handleCardRequest(get(p, CHROME), deps());
      expect(res.status, p).toBe(302);
      expect(res.headers.get("access-control-allow-origin"), p).toBe("*");
      expect(res.headers.get("location"), p).toBe("https://drawcast.app/share-card.png");
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
