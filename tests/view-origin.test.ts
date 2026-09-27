// The separate origin for other people's casts (security review 2026-09-28,
// step 2; docs/security/2026-09-28-viewer-origin.md): where each kind of link
// boots, the hand-backs that need the account, "Edit a copy", the secret
// getters answering empty on the view origin, and the edge function's part.
import { afterEach, describe, expect, test, vi } from "vitest";
import { bootRoute, enrollRoute, namedRoute, ORIGINS, onViewOrigin, remixSource, remixUrl, withStayMarker, type OriginConfig } from "../src/security/view-origin";
import { hostToHash, viewFramePolicy, viewHostOf } from "../netlify/lib/name-host.mts";

const MAIN = "https://drawcast.app";
const VIEW = "https://drawcast-view.example";
const cfg: OriginConfig = { view: VIEW, main: MAIN };
const on = (origin: string, hash: string) => bootRoute({ origin, hash }, cfg).go;

describe("bootRoute", () => {
  test("off when no view origin is configured", () => {
    expect(bootRoute({ origin: MAIN, hash: "#gh=o/r/c.yaml" }, { view: "", main: MAIN }).go).toBeNull();
  });

  test("the main origin sends public share links to the view origin", () => {
    expect(on(MAIN, "#gh=o/r/c.yaml")).toBe(`${VIEW}/#gh=o/r/c.yaml`);
    expect(on(MAIN, "#gdoc=abc&mode=silent")).toBe(`${VIEW}/#gdoc=abc&mode=silent`);
    expect(on(MAIN, "#gdrive=xyz")).toBe(`${VIEW}/#gdrive=xyz`);
  });

  test("…and keeps what needs the account, a hand-back, a remix and the editor", () => {
    expect(on(MAIN, "#anvil=slug/c.yaml")).toBeNull();
    expect(on(MAIN, "#gh=o/r/c.yaml&join")).toBeNull();
    expect(on(MAIN, "#gh=o/r/c.yaml&main")).toBeNull();
    expect(on(MAIN, "#gh=o/r/c.yaml&t=once")).toBeNull();
    expect(on(MAIN, "#remix&gh=o/r/c.yaml")).toBeNull();
    expect(on(MAIN, "")).toBeNull();
    expect(on(MAIN, "#micro-i")).toBeNull(); // a name resolves first (namedRoute)
  });

  test("the view origin plays public casts and names", () => {
    expect(on(VIEW, "#gh=o/r/c.yaml")).toBeNull();
    expect(on(VIEW, "#micro-i")).toBeNull();
  });

  test("the view origin hands everything else to the main origin", () => {
    expect(on(VIEW, "")).toBe(`${MAIN}/`);
    expect(on(VIEW, "#remix&gh=o/r/c.yaml")).toBe(`${MAIN}/#remix&gh=o/r/c.yaml`);
    expect(on(VIEW, "#anvil=slug/c.yaml")).toBe(`${MAIN}/#anvil=slug/c.yaml&main`);
    expect(on(VIEW, "#gh=o/r/c.yaml&join=run1")).toBe(`${MAIN}/#gh=o/r/c.yaml&join=run1&main`);
    // a sign-in coming back is redeemed on the main origin, token intact
    expect(on(VIEW, "#gh=o/r/c.yaml&t=once")).toBe(`${MAIN}/#gh=o/r/c.yaml&t=once`);
  });

  test("other hosts (localhost, deploy previews) are left alone", () => {
    expect(on("http://localhost:5173", "#gh=o/r/c.yaml")).toBeNull();
    expect(on("https://deploy-preview-3--drawcast.netlify.app", "#gh=o/r/c.yaml")).toBeNull();
  });

  test("no bounce: every hand-back is one the other side keeps", () => {
    for (const hash of ["#anvil=s/c.yaml", "#gh=o/r/c.yaml&join", "#x-course"]) {
      const there = on(VIEW, hash);
      if (there) expect(on(MAIN, new URL(there).hash)).toBeNull();
    }
    const there = on(MAIN, "#gh=o/r/c.yaml")!;
    expect(on(VIEW, new URL(there).hash)).toBeNull();
  });
});

describe("after a name resolves", () => {
  test("a public cast goes to the view origin; a course or a server cast stays on main", () => {
    expect(namedRoute({ kind: "cast", target: "o/r/c.yaml" }, "#micro-i", MAIN, cfg)).toBe(`${VIEW}/#micro-i`);
    expect(namedRoute({ kind: "course", target: "o/r/courses/x" }, "#micro-i", MAIN, cfg)).toBeNull();
    expect(namedRoute({ kind: "cast", target: "anvil/s/c.yaml" }, "#micro-i", MAIN, cfg)).toBeNull();
    expect(namedRoute({ kind: "cast", target: "o/r/c.yaml" }, "#micro-i&main", MAIN, cfg)).toBeNull();
  });

  test("on the view origin a course door or a server cast goes back to main, marked", () => {
    expect(namedRoute({ kind: "course", target: "x" }, "#micro-i", VIEW, cfg)).toBe(`${MAIN}/#micro-i&main`);
    expect(namedRoute({ kind: "cast", target: "anvil/s/c.yaml" }, "#micro-i", VIEW, cfg)).toBe(`${MAIN}/#micro-i&main`);
    expect(namedRoute({ kind: "cast", target: "o/r/c.yaml" }, "#micro-i", VIEW, cfg)).toBeNull();
  });

  test("a cast that reports learner progress to our server needs the account", () => {
    expect(enrollRoute("https://drawcast.anvil.app/", "https://drawcast.anvil.app", "#gh=o/r/c.yaml", VIEW, cfg)).toBe(`${MAIN}/#gh=o/r/c.yaml&main`);
    expect(enrollRoute("https://elsewhere.example", "https://drawcast.anvil.app", "#gh=o/r/c.yaml", VIEW, cfg)).toBeNull();
    expect(enrollRoute(undefined, "https://drawcast.anvil.app", "#gh=o/r/c.yaml", VIEW, cfg)).toBeNull();
    expect(enrollRoute("https://drawcast.anvil.app", "https://drawcast.anvil.app", "#gh=o/r/c.yaml", MAIN, cfg)).toBeNull();
  });
});

describe("Edit a copy", () => {
  test("hands the public source to the editor, without markers or credentials", () => {
    expect(remixUrl("#gh=o/r/c.yaml&main&join=r1&t=zz&mode=silent", cfg)).toBe(`${MAIN}/#remix&gh=o/r/c.yaml&mode=silent`);
    expect(remixSource("#remix&gh=o/r/c.yaml&mode=silent")).toBe("#gh=o/r/c.yaml&mode=silent");
  });
  test("only public sources can be remixed", () => {
    expect(remixSource("#remix&anvil=s/c.yaml")).toBeNull();
    expect(remixSource("#gh=o/r/c.yaml")).toBeNull();
  });
  test("the stay marker is added once", () => {
    expect(withStayMarker("#a&main")).toBe("#a&main");
    expect(withStayMarker("")).toBe("#main");
  });
});

describe("no secrets on the view origin", () => {
  const saved = { ...ORIGINS };
  afterEach(() => {
    Object.assign(ORIGINS, saved);
    vi.unstubAllGlobals();
  });

  test("the key, token and Google getters answer empty and the setters do nothing", async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    const { getApiKey, setApiKey, getTtsKey, setTtsKey, getGithubToken, setGithubToken } = await import("../src/store");
    const { getToken, setToken } = await import("../src/account");
    const { requireScope, DRIVE_SCOPE } = await import("../src/google/auth");

    // On the main origin they work as ever.
    vi.stubGlobal("location", { origin: MAIN });
    Object.assign(ORIGINS, cfg);
    setToken("tok");
    setApiKey("sk-main");
    expect(getToken()).toBe("tok");
    expect(getApiKey()).toBe("sk-main");

    // On the view origin: nothing in, nothing out — even with values present.
    vi.stubGlobal("location", { origin: VIEW });
    expect(onViewOrigin()).toBe(true);
    expect(getToken()).toBe("");
    expect(getApiKey()).toBe("");
    expect(getTtsKey()).toBe("");
    expect(getGithubToken()).toBe("");
    const before = new Map(mem);
    setToken("stolen");
    setApiKey("x");
    setTtsKey("x");
    setGithubToken("x");
    expect(mem).toEqual(before);
    expect(await requireScope(DRIVE_SCOPE)).toBeNull();
  });
});

describe("edge function", () => {
  test("the view host is never taken for a name", () => {
    expect(viewHostOf("https://view.drawcast.app")).toBe("view.drawcast.app");
    expect(hostToHash("view.drawcast.app", "drawcast.app", "view.drawcast.app")).toBeNull();
    expect(hostToHash("view.drawcast.app")).toBe("https://drawcast.app/#view");
    expect(viewHostOf("")).toBe("");
    expect(viewHostOf("not a url")).toBe("");
  });

  test("the view origin may be framed; nothing else in the policy changes", () => {
    const csp = "default-src 'self'; frame-ancestors 'self'; object-src 'none'";
    expect(viewFramePolicy(csp)).toBe("default-src 'self'; frame-ancestors *; object-src 'none'");
    expect(viewFramePolicy("default-src 'self'")).toBe("default-src 'self'");
  });

  test("on the view host the response's CSP is relaxed for framing; elsewhere untouched", async () => {
    vi.stubGlobal("Netlify", { env: { get: (k: string) => (k === "VITE_VIEW_ORIGIN" ? "https://view.drawcast.app" : undefined) } });
    try {
      const { default: nameHost } = await import("../netlify/edge-functions/name-host.mts");
      const page = () => Promise.resolve(new Response("<html>", { headers: { "content-security-policy": "default-src 'self'; frame-ancestors 'self'" } }));
      const onView = await nameHost(new Request("https://view.drawcast.app/"), { next: page });
      expect(onView.headers.get("content-security-policy")).toBe("default-src 'self'; frame-ancestors *");
      const onMain = await nameHost(new Request("https://drawcast.app/"), { next: page });
      expect(onMain.headers.get("content-security-policy")).toBe("default-src 'self'; frame-ancestors 'self'");
      const named = await nameHost(new Request("https://micro-i.drawcast.app/"), { next: page });
      expect(named.status).toBe(302);
      expect(named.headers.get("location")).toBe("https://drawcast.app/#micro-i");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
