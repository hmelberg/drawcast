// src/share/link.ts
// What the Share box hands out (spec 2026-10-02-share-design §§3, 6). A
// card needs a path — crawlers never see `#` — so a name or a GitHub cast
// is shared as drawcast.app/c/…, answered by netlify/functions/card.mts.
// A server or Drive cast with no name keeps its # link (a plain card); a
// cast that lives only inside its own link has nothing to point at.
import { nameInHash } from "../names";

export type Platform = "facebook" | "linkedin" | "x" | "bluesky" | "whatsapp" | "email";

export interface ShareLink {
  url: string;
  /** False where a link can only ever show the generic card. */
  card: boolean;
}

export const COMMENT_MAX = 280;

/** Facebook and LinkedIn refuse pre-filled post text by policy. */
export const TAKES_TEXT: Record<Platform, boolean> = { facebook: false, linkedin: false, x: true, bluesky: true, whatsapp: true, email: true };

// netlify/lib/share-card.mts parseSharePath's gh rule, copied (the app does
// not import netlify/; tests/share-link.test.ts runs every /c/ link made here
// back through parseSharePath so the two cannot drift). A path it refuses
// would send a person to the front page, so such a cast keeps its # link.
const GH_PART_RE = /^[\w.-]+$/;

function cardableGh(path: string): boolean {
  if (path.includes("%") || !/\.ya?ml$/i.test(path)) return false;
  const parts = path.split("/");
  return parts.length >= 3 && parts.every((p) => GH_PART_RE.test(p) && p !== "." && p !== "..");
}

export function shareLinkFor(hash: string, origin = "https://drawcast.app"): ShareLink | null {
  const head = hash.replace(/^#/, "").split("&", 1)[0];
  if (!head) return null;
  const gh = /^gh[=-](.+)$/i.exec(head);
  if (gh) return cardableGh(gh[1]) ? { url: `${origin}/c/gh/${gh[1]}`, card: true } : { url: `${origin}/#gh=${gh[1]}`, card: false };
  const plain = /^(anvil|gdrive)[=-](.+)$/.exec(head);
  if (plain) return { url: `${origin}/#${plain[1]}=${plain[2]}`, card: false };
  const name = nameInHash(`#${head}`);
  return name ? { url: `${origin}/c/${name}`, card: true } : null;
}

function text(s: { title: string; comment: string }): string {
  const c = s.comment.trim().slice(0, COMMENT_MAX);
  return c || s.title;
}

export function platformUrl(p: Platform, s: { url: string; title: string; comment: string }): string {
  const e = encodeURIComponent;
  switch (p) {
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${e(s.url)}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${e(s.url)}`;
    case "x":
      return `https://x.com/intent/post?url=${e(s.url)}&text=${e(text(s))}`;
    case "bluesky":
      return `https://bsky.app/intent/compose?text=${e(`${text(s)} ${s.url}`)}`;
    case "whatsapp":
      return `https://wa.me/?text=${e(`${text(s)} ${s.url}`)}`;
    case "email": {
      const c = s.comment.trim().slice(0, COMMENT_MAX);
      return `mailto:?subject=${e(s.title)}&body=${e(c ? `${c}\n\n${s.url}` : s.url)}`;
    }
  }
}
