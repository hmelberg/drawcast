// The view-counting endpoint. Storage is injected, so this suite is about
// HTTP: routing, CORS, validation, and the response shape.
import { describe, expect, test } from "vitest";
import { defaultClientIp, handleViewsRequest, viewBudgetId, type ViewsDeps } from "../netlify/functions/views.mts";

const KEY = "hmelberg/kurs/casts/did.yaml";

function deps(over: Partial<ViewsDeps> = {}): ViewsDeps & { recorded: string[]; charged: string[] } {
  const recorded: string[] = [];
  const charged: string[] = [];
  return {
    recorded,
    charged,
    record: async (key) => { recorded.push(key); return 7; },
    readCast: async () => ({ total: 7, days: { "2026-09-04": 7 } }),
    readRepo: async () => ({ casts: [{ key: KEY, total: 7, days: { "2026-09-04": 7 } }], courses: { casts: 7 } }),
    checkWriteBudget: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    recordWrite: async (ip) => { charged.push(ip); },
    clientIp: () => "1.2.3.4",
    ...over,
  };
}

function post(body: string, origin = "https://drawcast.app") {
  return new Request("https://drawcast.app/.netlify/functions/views", {
    method: "POST",
    headers: { "content-type": "text/plain", origin },
    body,
  });
}

const get = (query: string, origin = "https://drawcast.app") =>
  new Request(`https://drawcast.app/.netlify/functions/views${query}`, { headers: { origin } });

describe("recording a view", () => {
  test("records the key and answers with the new count", async () => {
    const d = deps();
    const res = await handleViewsRequest(post(KEY), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 7 });
    expect(d.recorded).toEqual([KEY]);
  });

  test("a malformed key is refused and never recorded", async () => {
    const d = deps();
    const res = await handleViewsRequest(post("../../etc/passwd"), d);
    expect(res.status).toBe(400);
    expect(d.recorded).toEqual([]);
  });

  test("an unknown origin is refused, so curl cannot pad the numbers for free", async () => {
    const d = deps();
    const res = await handleViewsRequest(post(KEY, "https://evil.example"), d);
    expect(res.status).toBe(403);
    expect(d.recorded).toEqual([]);
  });

  test("the GitHub Pages deploy is allowed and gets its CORS header back", async () => {
    const res = await handleViewsRequest(post(KEY, "https://hmelberg.github.io"), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://hmelberg.github.io");
  });

  test("a preflight is answered without touching storage", async () => {
    const d = deps();
    const res = await handleViewsRequest(
      new Request("https://drawcast.app/.netlify/functions/views", { method: "OPTIONS", headers: { origin: "https://hmelberg.github.io" } }),
      d,
    );
    expect(res.status).toBe(204);
    expect(d.recorded).toEqual([]);
  });

  test("a storage failure never becomes a 500 the player has to handle", async () => {
    const res = await handleViewsRequest(post(KEY), deps({ record: async () => { throw new Error("blobs down"); } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: null });
  });
});

describe("the drawcast server's private store is refused at every door", () => {
  // anvil/<slug>/<file> names a cast on the drawcast server, which may be
  // private to a course. This endpoint is public and ?repo= enumerates an
  // owner, so accepting the key would publish a private course's lecture
  // list, with per-day counts, to anyone holding one link or guessing a
  // slug. The header's invariant — "leaks nothing not already public on
  // GitHub" — only holds because this exception is enforced.
  const PRIVATE = "anvil/spanish1/01-intro.yaml";

  test("POST is a 400: nothing recorded, nothing charged", async () => {
    const d = deps();
    const res = await handleViewsRequest(post(PRIVATE), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "private" });
    expect(d.recorded).toEqual([]);
    expect(d.charged).toEqual([]);
  });

  test("?cast= is a 400 and storage is never asked", async () => {
    const d = deps({ readCast: async () => { throw new Error("must not be called"); } });
    const res = await handleViewsRequest(get(`?cast=${encodeURIComponent(PRIVATE)}`), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "private" });
  });

  test("?repo=anvil/<slug> is a 400 and nothing is listed — the enumeration door", async () => {
    const d = deps({ readRepo: async () => { throw new Error("must not be called"); } });
    const res = await handleViewsRequest(get("?repo=anvil/spanish1"), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "private" });
  });

  test("the owner match is exact: a GitHub user called anvil-courses is public and served", async () => {
    const d = deps();
    expect((await handleViewsRequest(post("anvil-courses/kurs/casts/did.yaml"), d)).status).toBe(200);
    expect((await handleViewsRequest(get("?repo=anvil-courses/kurs"), d)).status).toBe(200);
    expect((await handleViewsRequest(get(`?cast=${encodeURIComponent("hmelberg/anvil/casts/did.yaml")}`), d)).status).toBe(200);
  });
});

describe("the per-IP write budget", () => {
  // Origin is caller-supplied and forgeable (see the comment on
  // ALLOWED_ORIGINS in views.mts), so it stops idle curl at best. This is the
  // actual guard: a per-IP cap, backed by the same limiter keys.mts uses for
  // the password endpoint (netlify/lib/rate-limit.mts), wired the same way
  // (checkBudget-shaped deps, clientIp reading the platform header).

  test("a caller out of budget gets 429 and never reaches storage", async () => {
    const d = deps({ checkWriteBudget: async () => ({ allowed: false, retryAfterSeconds: 900 }) });
    const res = await handleViewsRequest(post(KEY), d);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("900");
    expect(d.recorded).toEqual([]);
    expect(d.charged).toEqual([]);
  });

  test("a successful write charges the caller's IP, exactly once", async () => {
    const d = deps();
    const res = await handleViewsRequest(post(KEY), d);
    expect(res.status).toBe(200);
    expect(d.charged).toEqual(["1.2.3.4"]);
  });

  test("a malformed key is refused before the budget is ever charged — only successful writes count against it", async () => {
    const d = deps();
    const res = await handleViewsRequest(post("../../etc/passwd"), d);
    expect(res.status).toBe(400);
    expect(d.charged).toEqual([]);
  });

  test("an origin rejection never reaches the budget check at all", async () => {
    const d = deps({ checkWriteBudget: async () => { throw new Error("must not be called"); } });
    const res = await handleViewsRequest(post(KEY, "https://evil.example"), d);
    expect(res.status).toBe(403);
  });

  test("reads never touch the write budget — only POST is capped", async () => {
    const d = deps({ checkWriteBudget: async () => { throw new Error("must not be called"); } });
    const res = await handleViewsRequest(get(`?cast=${encodeURIComponent(KEY)}`), d);
    expect(res.status).toBe(200);
  });

  test("the budget's storage key is prefixed distinctly from a bare IP, so it can never share a bucket with the password limiter's identical-looking keys", () => {
    expect(viewBudgetId("1.2.3.4")).toBe("views:1.2.3.4");
    expect(viewBudgetId("1.2.3.4")).not.toBe("1.2.3.4");
  });

  test("the client IP comes from the platform header, never a spoofable one — same rule as keys.mts", () => {
    const real = new Request("https://drawcast.app/x", {
      headers: { "x-nf-client-connection-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" },
    });
    expect(defaultClientIp(real)).toBe("9.9.9.9");
    const spoof = new Request("https://drawcast.app/x", { headers: { "x-forwarded-for": "1.1.1.1" } });
    expect(defaultClientIp(spoof)).toBe("");
  });
});

describe("localhost origins are a dev convenience, not a production hole", () => {
  function withEnv(vars: Record<string, string>, fn: () => Promise<void>) {
    const saved = { ...process.env };
    Object.assign(process.env, vars);
    return fn().finally(() => {
      for (const k of Object.keys(vars)) delete process.env[k];
      Object.assign(process.env, saved);
    });
  }

  test("localhost is rejected once CONTEXT says production", () =>
    withEnv({ CONTEXT: "production" }, async () => {
      const res = await handleViewsRequest(post(KEY, "http://localhost:5173"), deps());
      expect(res.status).toBe(403);
    }));

  test("localhost still works in every other Netlify context", async () => {
    for (const CONTEXT of ["dev", "deploy-preview", "branch-deploy"]) {
      await withEnv({ CONTEXT }, async () => {
        const res = await handleViewsRequest(post(KEY, "http://localhost:8888"), deps());
        expect(res.status).toBe(200);
      });
    }
  });

  test("an unset CONTEXT fails OPEN to today's behaviour (localhost allowed) rather than silently switching counting off", async () => {
    const saved = process.env.CONTEXT;
    delete process.env.CONTEXT;
    try {
      const res = await handleViewsRequest(post(KEY, "http://localhost:5173"), deps());
      expect(res.status).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.CONTEXT;
      else process.env.CONTEXT = saved;
    }
  });

  test("the real, non-localhost origins are unaffected by CONTEXT either way", () =>
    withEnv({ CONTEXT: "production" }, async () => {
      const res = await handleViewsRequest(post(KEY, "https://drawcast.app"), deps());
      expect(res.status).toBe(200);
    }));
});

describe("GET responses are readable cross-origin (Fix 6)", () => {
  test("a public count is served with a wildcard CORS header, regardless of caller origin", async () => {
    const res = await handleViewsRequest(get(`?cast=${encodeURIComponent(KEY)}`, "https://some-other-dashboard.example"), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("?repo= is wildcard-readable too — the spec anticipates a client dashboard on an unlisted origin", async () => {
    const res = await handleViewsRequest(get("?repo=hmelberg/kurs", "https://some-other-dashboard.example"), deps());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("POST keeps the origin allowlist exactly as before — writes never get the wildcard", async () => {
    const res = await handleViewsRequest(post(KEY, "https://evil.example"), deps());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("reading counts", () => {
  test("one cast, without recording anything", async () => {
    const d = deps();
    const res = await handleViewsRequest(get(`?cast=${encodeURIComponent(KEY)}`), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 7 });
    expect(d.recorded).toEqual([]);
  });

  test("a whole repo, cached briefly so repeat reads do not relist", async () => {
    const res = await handleViewsRequest(get("?repo=hmelberg/kurs"), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      casts: [{ key: KEY, total: 7, days: { "2026-09-04": 7 } }],
      courses: { casts: 7 },
    });
    expect(res.headers.get("Cache-Control")).toContain("max-age=60");
  });

  test("reads are public: no origin at all is fine", async () => {
    const res = await handleViewsRequest(
      new Request(`https://drawcast.app/.netlify/functions/views?repo=hmelberg/kurs`),
      deps(),
    );
    expect(res.status).toBe(200);
  });

  test("a malformed repo is a 400", async () => {
    expect((await handleViewsRequest(get("?repo=nope"), deps())).status).toBe(400);
  });

  test("a repo read failure is a 503 (not silent like player paths)", async () => {
    const res = await handleViewsRequest(get("?repo=hmelberg/kurs"), deps({ readRepo: async () => { throw new Error("blobs down"); } }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  test("neither cast nor repo is a 400", async () => {
    expect((await handleViewsRequest(get(""), deps())).status).toBe(400);
  });

  test("other methods are refused", async () => {
    const res = await handleViewsRequest(
      new Request("https://drawcast.app/.netlify/functions/views", { method: "DELETE" }),
      deps(),
    );
    expect(res.status).toBe(405);
  });

  test("when both cast and repo are present, cast takes precedence", async () => {
    const d = deps();
    const res = await handleViewsRequest(
      get(`?cast=${encodeURIComponent(KEY)}&repo=hmelberg/kurs`),
      d,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 7 });
  });

  test("POST ignores any query string in the URL", async () => {
    const d = deps();
    const res = await handleViewsRequest(
      new Request("https://drawcast.app/.netlify/functions/views?ignored=param", {
        method: "POST",
        headers: { "content-type": "text/plain", origin: "https://drawcast.app" },
        body: KEY,
      }),
      d,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 7 });
    expect(d.recorded).toEqual([KEY]);
  });
});
