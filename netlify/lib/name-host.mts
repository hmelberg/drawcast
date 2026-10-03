// NAME.drawcast.app → https://drawcast.app/#name (name-host round,
// 2026-09-17). Pure: the edge function (netlify/edge-functions/name-host.mts)
// hands the request's host in and gets a redirect target or null.
//
// Why a redirect and not the app on the subdomain: a browser keeps
// localStorage per origin, so the sign-in token, settings and library live
// on drawcast.app — served from micro-i.drawcast.app every student would look
// signed out. One origin, one hop. The registry then resolves the name as it
// resolves any hash, so only a registered name opens anything; an unknown
// label lands on the app's own "No drawcast called …".
//
// The rule is the base half of src/names.ts NAME_RE and the same reserved
// list — duplicated here (an edge function bundles on its own, and
// src/names.ts pulls in the app) and pinned by tests/name-host.test.ts.

export const APEX = "drawcast.app";

/** A hostname label that is a name: the base half of NAME_RE (no `/sub`). */
export const NAME_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Mirrors RESERVED_PREFIXES in src/names.ts and server_code/names.py. */
export const RESERVED_LABELS = ["gh", "gdoc", "gdrive", "url", "anvil", "api", "name", "course", "learner", "me", "browse", "www", "cast", "paste", "create"] as const;

/** A request's host without port, lower-cased. */
export function bareHost(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, "");
}

/**
 * The view origin's host (security review 2026-09-28, step 2 — the same
 * VITE_VIEW_ORIGIN the build reads, src/security/view-origin.ts), or "" when
 * none is configured. If the view origin is ever a label under the apex
 * (view.drawcast.app), this is what keeps the wildcard from redirecting it
 * to a name.
 */
export function viewHostOf(origin: string | undefined | null): string {
  if (!origin) return "";
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * The view origin holds no secrets, so it may be framed (a course page, an
 * LMS): the one directive the main origin's policy must keep strict is
 * relaxed there, and nothing else changes.
 */
export function viewFramePolicy(csp: string): string {
  return /(^|;)\s*frame-ancestors[^;]*/.test(csp) ? csp.replace(/(^|;)(\s*)frame-ancestors[^;]*/, "$1$2frame-ancestors *") : csp;
}

export function hostToHash(host: string, apex: string = APEX, viewHost: string = ""): string | null {
  const bare = bareHost(host);
  if (viewHost !== "" && bare === viewHost) return null;
  const suffix = `.${apex}`;
  if (!bare.endsWith(suffix)) return null;
  const label = bare.slice(0, -suffix.length);
  if (label === "" || label.includes(".")) return null;
  if (!NAME_LABEL_RE.test(label)) return null;
  for (const p of RESERVED_LABELS) if (label === p || label.startsWith(`${p}-`)) return null;
  return `https://${apex}/#${label}`;
}
