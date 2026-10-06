// A separate origin for watching other people's casts (security review
// 2026-09-28, step 2; design in docs/security/2026-09-28-viewer-origin.md).
//
// The editor's origin (drawcast.app) keeps the BYOK Anthropic key, the
// drawcast account token, the GitHub and TTS keys and Google tokens. A shared
// link played there puts a stranger's cast one "Run it" away from all of
// them. With VITE_VIEW_ORIGIN set at build time, the same build serves a
// second origin that plays public casts and holds none of that:
//   - on the main origin, a public share link (#gh=, #gdoc=, #gdrive=, a
//     #cast= that carries the cast in the link itself, and a #name that
//     resolves to one) goes to the view origin;
//   - on the view origin, anything else — the editor, a sign-in coming back,
//     a private server cast (#anvil=), a course door, a join link, a cast
//     that reports learner progress — goes back to the main origin, since
//     each of those needs the account; `&main` in the hash marks such a
//     hand-back so the main origin does not bounce it again;
//   - on the view origin, the secret getters (store.ts, account.ts,
//     google/auth.ts) answer empty and the setters do nothing, so no path
//     can put a secret there even by mistake;
//   - "Edit a copy" hands the cast to the main origin as #remix&<source>,
//     which the editor fetches and opens as an unsaved document — through
//     the step-1 trust gate, like any upload.
// Unset (today's deployment, deploy previews, localhost) changes nothing.
//
// Imports names.ts (→ learn.ts) only: account.ts imports this, and the
// viewer chunk must stay small.

import { isNameHash } from "../names";

export interface OriginConfig {
  /** e.g. "https://drawcast-view.app" — empty = the feature is off. */
  view: string;
  /** Where the editor lives. */
  main: string;
}

function normalizeOrigin(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") return "";
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.hostname === "localhost" ? u.origin : "";
  } catch {
    return "";
  }
}

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const ORIGINS: OriginConfig = {
  view: normalizeOrigin(env.VITE_VIEW_ORIGIN),
  main: normalizeOrigin(env.VITE_MAIN_ORIGIN) || "https://www.drawcast.app",
};

function here(): string {
  try {
    return globalThis.location?.origin ?? "";
  } catch {
    return "";
  }
}

/** Is this page the secret-free view origin? */
export function onViewOrigin(origin: string = here(), cfg: OriginConfig = ORIGINS): boolean {
  return cfg.view !== "" && origin === cfg.view;
}

/** A stranger's public cast. `cast` carries the cast inside the link
 *  (links/inline-cast.ts) — anyone can write one, so it is treated exactly
 *  like the fetched sources. */
const PUBLIC_SOURCE_RE = /[#&](gdoc|gh|gdrive|cast)[=-]/;
const ANVIL_RE = /[#&]anvil[=-]/;
/** Exported: viewer.ts's runNamed tests the same hash for the same reason
 *  (the course page's own Join link, or a copied one) — one pattern. */
export const JOIN_RE = /[#&]join(?:=|&|$)/;
const TOKEN_RE = /[#&]t=/;
const STAY_RE = /[#&]main(?:&|$)/;
const REMIX_RE = /^#remix&/;
/** The public catalogue (entry.ts routes it before any name): no account. */
const BROWSE_RE = /^#browse(?:&|$)/;
/** The paste page (paste.ts): a textarea that opens a #cast= link. No account. */
const PASTE_RE = /^#paste(?:&|$)/;

/** The hash with the main-origin marker added once. */
export function withStayMarker(hash: string): string {
  if (STAY_RE.test(hash)) return hash;
  return hash === "" || hash === "#" ? "#main" : `${hash}&main`;
}

export type BootRoute = { go: string } | { go: null };

/**
 * Where this page belongs, decided before anything reads storage. `go` is a
 * full URL to replace the location with, or null to boot here.
 */
export function bootRoute(loc: { origin: string; hash: string }, cfg: OriginConfig = ORIGINS): BootRoute {
  if (!cfg.view) return { go: null };
  const { hash } = loc;
  if (loc.origin === cfg.view) {
    const playable = (PUBLIC_SOURCE_RE.test(hash) || isNameHash(hash) || BROWSE_RE.test(hash) || PASTE_RE.test(hash)) && !REMIX_RE.test(hash);
    const needsAccount = ANVIL_RE.test(hash) || JOIN_RE.test(hash) || TOKEN_RE.test(hash) || STAY_RE.test(hash);
    if (playable && !needsAccount) return { go: null };
    // The editor, a sign-in coming back, a private cast: the main origin.
    return { go: `${cfg.main}/${needsAccount && !TOKEN_RE.test(hash) ? withStayMarker(hash) : hash}` };
  }
  if (loc.origin === cfg.main) {
    if (PUBLIC_SOURCE_RE.test(hash) && !ANVIL_RE.test(hash) && !JOIN_RE.test(hash) && !STAY_RE.test(hash) && !TOKEN_RE.test(hash) && !REMIX_RE.test(hash)) {
      return { go: `${cfg.view}/${hash}` };
    }
  }
  return { go: null };
}

/**
 * After a #name resolved: a public cast plays on the view origin; a course
 * door or a private server cast needs the account, so the main origin.
 * Null = stay.
 */
export function namedRoute(resolved: { kind: "cast" | "course"; target: string }, hash: string, origin: string = here(), cfg: OriginConfig = ORIGINS): string | null {
  if (!cfg.view) return null;
  const accountBound = resolved.kind === "course" || resolved.target.startsWith("anvil/") || JOIN_RE.test(hash);
  if (origin === cfg.view && accountBound) return `${cfg.main}/${withStayMarker(hash)}`;
  if (origin === cfg.main && !accountBound && !STAY_RE.test(hash)) return `${cfg.view}/${hash}`;
  return null;
}

/**
 * A course name's own GitHub course page, or null to show the door instead.
 * Null when the hash asks for the door (`&join`), when there is no page, when
 * the page is not on the course owner's own `https://<owner>.github.io` site
 * (a registry entry is data, not a licence to redirect anywhere — final
 * review I1), and when the visitor arrived FROM that page's origin: pages
 * published before `&join` link the bare name, and sending them back would
 * loop (final review C1).
 */
export function coursePageRedirect(resolved: { kind: "cast" | "course"; target: string; page: string | null }, hash: string, referrer: string): string | null {
  if (resolved.kind !== "course" || !resolved.page || JOIN_RE.test(hash)) return null;
  let page: URL;
  try {
    page = new URL(resolved.page);
  } catch {
    return null;
  }
  const owner = resolved.target.split("/", 1)[0].toLowerCase();
  if (!owner || page.protocol !== "https:" || page.hostname.toLowerCase() !== `${owner}.github.io`) return null;
  if (referrer) {
    try {
      if (new URL(referrer).origin === page.origin) return null;
    } catch {
      /* an unreadable referrer is no referrer */
    }
  }
  return resolved.page;
}

/**
 * On the view origin, a cast that reports learner progress to the drawcast
 * server needs the signed-in account: hand it to the main origin. Null = stay.
 */
export function enrollRoute(enroll: string | undefined, enrollApi: string, hash: string, origin: string = here(), cfg: OriginConfig = ORIGINS): string | null {
  if (!onViewOrigin(origin, cfg) || !enroll) return null;
  return enroll.replace(/\/+$/, "") === enrollApi.replace(/\/+$/, "") ? `${cfg.main}/${withStayMarker(hash)}` : null;
}

/**
 * A locked lecture (private lectures, registry delivery 2): unlocking needs
 * the account (item-key.ts's fetchItemKey), which lives on the main origin
 * only. On the view origin, hand it over there, marked, before ever trying
 * to unlock — a door built on that origin could never open, since the
 * secret getters there always answer empty (module doc above). On the main
 * origin, or with the view origin unconfigured, stay: that is the only
 * origin an encrypted envelope is ever handed to isLocked/unlockForViewer.
 */
export function lockedRoute(origin: string, hash: string, cfg: OriginConfig = ORIGINS): string | null {
  return onViewOrigin(origin, cfg) ? `${cfg.main}/${withStayMarker(hash)}` : null;
}

/** "Edit a copy": the main origin's editor, told which public cast to fetch. */
export function remixUrl(sourceHash: string, cfg: OriginConfig = ORIGINS): string {
  const src = sourceHash
    .replace(/^#/, "")
    .split("&")
    .filter((p) => p !== "" && p !== "main" && !/^(join|t)(=|$)/.test(p))
    .join("&");
  return `${cfg.main}/#remix&${src}`;
}

/** The source hash inside a #remix& hash ("#gh=o/r/p.yaml"), or null. */
export function remixSource(hash: string): string | null {
  if (!REMIX_RE.test(hash)) return null;
  const src = `#${hash.slice("#remix&".length)}`;
  return PUBLIC_SOURCE_RE.test(src) ? src : null;
}

/** The editor's front page (the view origin's "Made with drawcast"). */
export function mainAppUrl(cfg: OriginConfig = ORIGINS): string {
  return `${cfg.main}/`;
}
