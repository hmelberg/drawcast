// A cast FILE as the local author writes it (scripts/cast.mjs, the /drawcast
// skill) → the text the app's own reader takes (parsePlaylistText).
//
// The frames harness (src/dev/frames.ts) has always been forgiving about the
// shape: a bare spec, an examples.json entry — {request, spec} or {request,
// title, playlist} — an array of those (the first is taken), or playlist YAML.
// The app's `?open=` read the text straight into parsePlaylistText, so a
// {request, spec} wrapper parsed as a spec whose steps were missing: a blank
// page playing 0 steps. Unwrap here first, and the two agree.

/** The text to parse, and the title the wrapper carried (if any). */
export interface CastFile {
  text: string;
  /** The wrapper's `title`, else its `request` — a fallback for the document title. */
  title?: string;
}

/** Unwrap a cast file's text; anything that is not a wrapper passes through untouched. */
export function unwrapCastText(text: string): CastFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { text }; // playlist YAML or a script: the reader takes it as is
  }
  const entry = Array.isArray(json) ? json[0] : json;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { text };
  const e = entry as { request?: unknown; title?: unknown; spec?: unknown; playlist?: unknown };
  const title = typeof e.title === "string" ? e.title : typeof e.request === "string" ? e.request : undefined;
  const withTitle = (inner: string): CastFile => (title !== undefined ? { text: inner, title } : { text: inner });
  if (typeof e.playlist === "string") return withTitle(e.playlist);
  if (e.playlist && typeof e.playlist === "object") return withTitle(JSON.stringify(e.playlist));
  if (e.spec && typeof e.spec === "object") return withTitle(JSON.stringify(e.spec));
  // A bare spec (or a one-element array of one): its own text, or the element's.
  return Array.isArray(json) ? { text: JSON.stringify(entry) } : { text };
}
