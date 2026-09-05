// Publishing ONE drawcast to the drawcast server (round 0 spec §4) — the
// third publish target, beside GitHub (cast.ts) and Google Drive.
//
// Two requests, never one, because storage keeps two objects: the spec is
// ~10 KB and travels in a JSON body; the audio is megabytes and travels RAW
// as its own request. One JSON body carrying both is exactly what made
// GitHub answer 422 on a baked course (2026-09-02). The spec goes first, and
// the server CLEARS any stored narration on every spec write — so when the
// document is baked the second request is not optional: skipping it would
// leave the cast silent, not "as it was".
//
// The shape is cast.ts's, minus what a repo needs and the server does not:
// no index file, no README, no preflight, no slug uniquifying — the server
// keys casts by exact name and answers 403 when a key belongs to another
// account, which is a message for the author rather than a name to invent.
//
// Nothing here throws once something has been written. A narration upload
// that fails after the spec has landed is reported IN the result
// (`audioError`), so the caller can still register the name and say
// precisely what landed and what did not.

import { apiBase } from "../learn";

/** Who can watch (spec §5, question 2). The server enforces `open` and
 *  owner-only in this round; the middle value is accepted and stored. */
export type ServerAccess = "open" | "signed-in" | "enrolled";

/**
 * `anvil/<slug>/<file>` — three segments, like a GitHub key's
 * `owner/repo/path`, so CAST_KEY_RE (views.ts, learn.ts, view-key.mts),
 * view counting, learner events and the dashboard need no new case, and
 * `parseViewerHash` reads it straight back from `#anvil=<slug>/<file>`.
 */
export function serverCastKey(slug: string, file: string): string {
  return `anvil/${slug}/${file}`;
}

/**
 * The published YAML is one file with the audio appended as a second
 * document; storage wants them apart. `formatPublished` is the only writer
 * of that separator — `\n---\n` followed by a document that begins `audio:`
 * — so this is its exact inverse: the spec keeps the single trailing newline
 * `formatPublished` gives it, and the audio starts at `audio:`. A `---`
 * between two SPEC documents is not followed by `audio:` and is left alone.
 */
export function splitBakedYaml(yaml: string): { spec: string; audio: string | null } {
  const at = yaml.indexOf("\n---\naudio:");
  if (at < 0) return { spec: yaml, audio: null };
  return { spec: yaml.slice(0, at + 1), audio: yaml.slice(at + "\n---\n".length) };
}

export interface ServerPublishArgs {
  /** The publish name — the key's first segment, already normalized. */
  slug: string;
  /** The key's file segment, `<cast-slug>.yaml`. */
  file: string;
  title: string;
  /** The prepared document exactly as `formatPublished` writes it, audio and all. */
  yaml: string;
  access: ServerAccess;
  /** The session token (account.ts's `getToken`) — never the GitHub token. */
  token: string;
  api: string;
  /** Where the shared link points; drawcast.app unless the author runs their own viewer. */
  viewerBase?: string;
}

export interface ServerPublishResult {
  /** The server's key for this copy — what events, counting and the name registry refer to. */
  cast: string;
  /** The link to share: the viewer, pointed at the server copy. */
  url: string;
  /**
   * Why the narration is NOT on the server, when it is not: the audio upload
   * answered an error, or never connected, AFTER the spec had landed. The
   * spec write has already cleared whatever narration the server held
   * before, so until the author publishes again the cast plays with a
   * browser voice. Null when there was no audio to send, or it was sent.
   */
  audioError: string | null;
}

/** The server's refusal of the spec write, in the words the author should read. */
function refusal(status: number): string {
  switch (status) {
    case 401:
      return "Not signed in — the drawcast server did not accept this browser's session. Sign in again from Settings → Publishing (drawcast account).";
    case 403:
      return "That name already belongs to another account on the drawcast server — pick another.";
    case 429:
      return "The drawcast server took too many publishes in the last hour — try again later.";
    default:
      return `The drawcast server refused the publish (HTTP ${status}).`;
  }
}

export async function publishToServer(args: ServerPublishArgs, fetchImpl: typeof fetch = fetch): Promise<ServerPublishResult> {
  const cast = serverCastKey(args.slug, args.file);
  const { spec, audio } = splitBakedYaml(args.yaml);
  const base = apiBase(args.api);
  // text/plain keeps this a CORS-simple request (no preflight), like every
  // other POST to the server; the server parses the body as JSON itself.
  const res = await fetchImpl(`${base}/_/api/cast`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ key: args.token, cast, title: args.title, spec, access: args.access }),
  });
  if (!res.ok) throw new Error(refusal(res.status));
  const url = `${(args.viewerBase ?? "https://drawcast.app").replace(/\/+$/, "")}/#anvil=${args.slug}/${args.file}`;
  if (!audio) return { cast, url, audioError: null };
  // Past this line the spec has LANDED — and its write cleared the stored
  // narration. Nothing below may throw: a failure here is a fact about the
  // audio, reported beside the publish rather than instead of it.
  const q = `cast=${encodeURIComponent(cast)}&key=${encodeURIComponent(args.token)}`;
  try {
    const up = await fetchImpl(`${base}/_/api/cast/audio?${q}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      // The audio document itself, raw — the body IS the payload, which is
      // why the cast and the token ride the query string here and nowhere else.
      body: audio,
    });
    return { cast, url, audioError: up.ok ? null : `the server refused the narration (HTTP ${up.status})` };
  } catch (err) {
    return { cast, url, audioError: `the narration upload did not complete (${(err as Error).message})` };
  }
}
