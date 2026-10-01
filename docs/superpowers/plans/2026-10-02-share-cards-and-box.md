# Share: cards and the share box — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `drawcast.app/c/<name>` link that shows the cast's own card (title, line, picture) when pasted into Facebook, LinkedIn, X, Bluesky, Slack or a chat app, and a Share box in the player that hands that link out.

**Architecture:** A Node Netlify Function (`netlify/functions/card.mts`) owns the paths `/c/*` and `/card/*`. A person asking for `/c/<x>` is sent with a 302 to the `#` link that already plays. A link-preview crawler gets a small HTML page with Open Graph tags. `/card/<x>.png` streams the cast's existing poster from GitHub, or a generic picture. The pure rules sit in `netlify/lib/share-card.mts`. In the app, `src/share/link.ts` turns the current hash into the share link plus platform URLs, and `src/ui/share-box.ts` is the dialog. The viewer's existing share icon (`src/viewer.ts` `shareButton`) opens that dialog instead of copying.

**Tech Stack:** TypeScript, Netlify Functions (Node, `config.path`), js-yaml (already a dependency), vitest (`environment: "node"`; DOM is checked by eye in the browser, as the repo does elsewhere).

**Spec:** `docs/superpowers/specs/2026-10-02-share-design.md` (deliveries 1 and 2, §§3–6). Read it first.

## Global Constraints

- Two deliberate departures from the spec, both simpler. (1) The player already has a share icon in its control bar (`src/viewer.ts` `shareButton`, beside fullscreen, on every width), so Share opens from that icon, not from a new ⋯ item. (2) In the editor, Share is a `Share…` button on the publish success line, not a block at the top of the Share panel. The spec's §§4, 6 are updated to match.

- Work in the worktree `.claude/worktrees/share` (branch `share`). The main checkout has other sessions' work in progress: never edit, stash or commit there.
- The worktree has no `node_modules`: run `npm ci` in it once before anything else.
- Link form: `https://drawcast.app/c/<name>` (a name may carry a sub-name, `<base>/<sub>`), `https://drawcast.app/c/gh/<owner>/<repo>/<path>` for a GitHub cast without a name. Never a `#` link where a card is possible.
- Picture: the existing `<file>.png` beside the cast (`posterPathFor`). No new picture is drawn in this plan.
- Card text: `title` and `subtitle` from the cast's YAML header. No new field.
- Generic card: title `drawcast`, line `Drawn explanations you can watch and play with`, image `/share-card.png` (1200×630).
- Every failure gives the generic card with status 200, never an error page.
- Card page `Cache-Control: public, max-age=600`; card image `public, max-age=3600`; a person's 302 `no-store`.
- `/c/` and `/card/` never record a visit.
- Facebook and LinkedIn take no pre-filled text. With a comment, those buttons copy it to the clipboard first.
- Comment: at most 280 characters.
- Deferred to later plans: the `?s=` share tag and stats (delivery 4), pictures from Claude Code publishes (delivery 3), the server's own picture (version 2).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before any push or deploy: run the full suite (`npx vitest run`) and `npx tsc --noEmit`. Pushing or deploying needs the user's go-ahead.
- When playing casts in a browser for checks, mute the player and silence WebAudio tones.

## Review Focus

1. **A real browser mistaken for a crawler.** It would land on the card page, not the cast. The bot list must not match Chrome, Safari, Firefox, or Facebook's and Instagram's in-app browsers (`FBAN`, `FBAV`, `Instagram`). Test in Task 1 with real user-agent strings.
2. **Hostile text in a title** (`"`, `<`, `&`, `</title><script>`). It must come out escaped in the card HTML. Test in Task 1.
3. **A `/c/` path with `..`, an encoded slash, a query string, or a trailing slash.** It must map to the same `#` link or be refused (generic card or 404), never a redirect outside drawcast.app. Test in Task 1 (`parseSharePath`) and Task 2 (the 302 `Location` always starts with the request's origin).
4. **A private cast** (a locked envelope from GitHub, a denied server cast). Its title must never appear on a card. Test in Task 1 (`castCardText` on an envelope) and Task 2.
5. **A cast whose name has a sub-name** (`learn-russian/3`). The share link must keep the slash and the card must resolve it. Test in Task 1 (`parseSharePath`, `hashForShare`) and Task 4 (`shareLinkFor`).

---

## Delivery 1 — cards

### Task 1: The pure rules (`netlify/lib/share-card.mts`)

**Files:**
- Create: `netlify/lib/share-card.mts`
- Test: `tests/share-card.test.ts`

**Interfaces:**
- Produces:
  - `type ShareTarget = { kind: "name"; name: string } | { kind: "gh"; owner: string; repo: string; path: string }`
  - `parseSharePath(pathname: string, prefix: "/c/" | "/card/"): ShareTarget | null`. For `/card/` the path ends `.png`, which is stripped first. For a `gh` card the stripped path then gets `.yaml` back.
  - `hashForShare(t: ShareTarget): string` gives `"#<name>"` or `"#gh=<owner>/<repo>/<path>"`.
  - `cardPathFor(t: ShareTarget): string` gives `"/card/<name>.png"` or `"/card/gh/<owner>/<repo>/<path without .yaml>.png"`.
  - `sharePathFor(t: ShareTarget): string` gives `"/c/<name>"` or `"/c/gh/<owner>/<repo>/<path>"`.
  - `isPreviewBot(userAgent: string | null): boolean`
  - `castCardText(yamlText: string): { title?: string; subtitle?: string }`
  - `courseCardText(markdown: string): { title?: string; subtitle?: string }`
  - `interface Card { title: string; description?: string; url: string; image: string; playUrl: string }`
  - `cardHtml(card: Card): string`
  - `GENERIC: { title: string; description: string; image: string }` (image is the path `/share-card.png`)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/share-card.test.ts
// The share card's pure rules (spec 2026-10-02-share-design §§3–5): which
// /c/ and /card/ paths mean which cast, who is a link-preview crawler, the
// card text read from a cast or a course, and the card page itself.
import { describe, expect, test } from "vitest";
import { cardHtml, cardPathFor, castCardText, courseCardText, GENERIC, hashForShare, isPreviewBot, parseSharePath, sharePathFor } from "../netlify/lib/share-card.mts";

describe("parseSharePath", () => {
  test("a name, and a name with a sub-name", () => {
    expect(parseSharePath("/c/vaccines", "/c/")).toEqual({ kind: "name", name: "vaccines" });
    expect(parseSharePath("/c/learn-russian/3", "/c/")).toEqual({ kind: "name", name: "learn-russian/3" });
  });
  test("a trailing slash and upper case are tolerated", () => {
    expect(parseSharePath("/c/Vaccines/", "/c/")).toEqual({ kind: "name", name: "vaccines" });
  });
  test("a GitHub cast, nested folders kept", () => {
    expect(parseSharePath("/c/gh/ann/casts/casts/sub/herd.yaml", "/c/")).toEqual({ kind: "gh", owner: "ann", repo: "casts", path: "casts/sub/herd.yaml" });
  });
  test("refused: empty, reserved names, malformed, traversal, encoded slashes, non-yaml gh paths", () => {
    for (const p of ["/c/", "/c/gh", "/c/api", "/c/gh-x", "/c/-bad", "/c/a/b/c", "/c/gh/ann/casts/../x.yaml", "/c/gh/ann/casts/%2e%2e/x.yaml", "/c/gh/ann/casts/a%2Fb.yaml", "/c/gh/ann/casts/x.txt", "/c/gh/ann", "/elsewhere/vaccines"]) {
      expect(parseSharePath(p, "/c/"), p).toBeNull();
    }
  });
  test("card paths: .png stripped, a gh path gets .yaml back", () => {
    expect(parseSharePath("/card/vaccines.png", "/card/")).toEqual({ kind: "name", name: "vaccines" });
    expect(parseSharePath("/card/learn-russian/3.png", "/card/")).toEqual({ kind: "name", name: "learn-russian/3" });
    expect(parseSharePath("/card/gh/ann/casts/casts/herd.png", "/card/")).toEqual({ kind: "gh", owner: "ann", repo: "casts", path: "casts/herd.yaml" });
    expect(parseSharePath("/card/vaccines", "/card/")).toBeNull();
  });
});

describe("the paths and hashes a target maps to", () => {
  const name = { kind: "name", name: "learn-russian/3" } as const;
  const gh = { kind: "gh", owner: "ann", repo: "casts", path: "casts/herd.yaml" } as const;
  test("hash", () => {
    expect(hashForShare(name)).toBe("#learn-russian/3");
    expect(hashForShare(gh)).toBe("#gh=ann/casts/casts/herd.yaml");
  });
  test("share and card paths round-trip through parseSharePath", () => {
    for (const t of [name, gh]) {
      expect(parseSharePath(sharePathFor(t), "/c/")).toEqual(t);
      expect(parseSharePath(cardPathFor(t), "/card/")).toEqual(t);
    }
    expect(cardPathFor(gh)).toBe("/card/gh/ann/casts/casts/herd.png");
  });
});

describe("isPreviewBot", () => {
  const bots = [
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Facebot",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "WhatsApp/2.23.20.0",
    "TelegramBot (like TwitterBot)",
    "Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)",
    "Mastodon/4.2.0 (http.rb/5.1.1; +https://mastodon.social/)",
    "Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5",
    "Iframely/1.3.1 (+https://iframely.com/docs/about)",
    "Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)",
  ];
  const people = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.108;FBBV/123]",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Instagram 350.0.0.0",
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 [LinkedInApp]/9.30",
  ];
  test("the crawlers are crawlers", () => {
    for (const ua of bots) expect(isPreviewBot(ua), ua).toBe(true);
  });
  test("people's browsers, in-app ones included, are not", () => {
    for (const ua of people) expect(isPreviewBot(ua), ua).toBe(false);
    expect(isPreviewBot(null)).toBe(false);
    expect(isPreviewBot("")).toBe(false);
  });
});

describe("castCardText", () => {
  test("title and subtitle from the header, quoted or plain", () => {
    expect(castCardText('title: "Why vaccines work"\nsubtitle: Herd immunity, drawn in three minutes.\nitems:\n  - spec: {}\n')).toEqual({ title: "Why vaccines work", subtitle: "Herd immunity, drawn in three minutes." });
  });
  test("folded text is joined", () => {
    expect(castCardText("title: >-\n  A long\n  title\n").title).toBe("A long title");
  });
  test("only the first document counts (the audio document after --- is ignored)", () => {
    expect(castCardText("title: A\n---\naudio:\n  title: B\n")).toEqual({ title: "A" });
  });
  test("missing, non-string, broken YAML and a locked envelope give nothing", () => {
    expect(castCardText("items: []\n")).toEqual({});
    expect(castCardText("title: 42\n")).toEqual({});
    expect(castCardText("title: [unclosed\n")).toEqual({});
    expect(castCardText("drawcast-encrypted: 1\ncipher: AAAA\n")).toEqual({});
  });
  test("text is trimmed to card size", () => {
    const long = "x".repeat(400);
    expect(castCardText(`title: ${long}\nsubtitle: ${long}\n`).title!.length).toBeLessThanOrEqual(120);
    expect(castCardText(`title: ${long}\nsubtitle: ${long}\n`).subtitle!.length).toBeLessThanOrEqual(300);
  });
});

describe("courseCardText", () => {
  test("the first # heading, then the first paragraph line", () => {
    expect(courseCardText("# QALY basics\n\nWhat a quality-adjusted life year is.\nMore.\n\n---\n## Lecture 1\n")).toEqual({ title: "QALY basics", subtitle: "What a quality-adjusted life year is." });
  });
  test("no heading, nothing", () => {
    expect(courseCardText("just text\n")).toEqual({});
  });
});

describe("cardHtml", () => {
  const card = { title: 'A "quoted" <title> & more', description: "</title><script>x()</script>", url: "https://drawcast.app/c/vaccines", image: "https://drawcast.app/card/vaccines.png", playUrl: "https://drawcast.app/#vaccines" };
  test("every value is escaped", () => {
    const html = cardHtml(card);
    expect(html).not.toContain("<script>");
    expect(html).toContain("A &quot;quoted&quot; &lt;title&gt; &amp; more");
  });
  test("the Open Graph and X tags, the refresh and the link are there", () => {
    const html = cardHtml(card);
    for (const tag of ['property="og:title"', 'property="og:description"', 'property="og:image"', 'property="og:url" content="https://drawcast.app/c/vaccines"', 'name="twitter:card" content="summary_large_image"', 'http-equiv="refresh" content="0; url=https://drawcast.app/#vaccines"', 'href="https://drawcast.app/#vaccines"']) {
      expect(html).toContain(tag);
    }
  });
  test("no description, no description tag", () => {
    expect(cardHtml({ ...card, description: undefined })).not.toContain("og:description");
  });
  test("the generic card's wording", () => {
    expect(GENERIC).toEqual({ title: "drawcast", description: "Drawn explanations you can watch and play with", image: "/share-card.png" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/share-card.test.ts`
Expected: FAIL, because `../netlify/lib/share-card.mts` cannot be resolved.

- [ ] **Step 3: Write the module**

```ts
// netlify/lib/share-card.mts
// The share card's pure rules (spec 2026-10-02-share-design §§3–5). A link
// someone pastes into a feed is drawcast.app/c/<name> (or /c/gh/<owner>/
// <repo>/<path> for a GitHub cast with no name): a path, because a
// link-preview crawler never sees anything after `#`. netlify/functions/
// card.mts answers it — a person with a redirect to the `#` link that plays,
// a crawler with the card page built here. The name rule is name-host.mts's
// (the same one src/names.ts holds), so a /c/ path can only ever mean a
// name the registry could have.
import yaml from "js-yaml";
import { NAME_LABEL_RE, RESERVED_LABELS } from "./name-host.mts";

export type ShareTarget = { kind: "name"; name: string } | { kind: "gh"; owner: string; repo: string; path: string };

const SUB_RE = /^[a-z0-9-]{1,20}$/;
const GH_PART_RE = /^[\w.-]+$/;

function isName(base: string, sub: string | undefined): boolean {
  if (!NAME_LABEL_RE.test(base)) return false;
  for (const p of RESERVED_LABELS) if (base === p || base.startsWith(`${p}-`)) return false;
  return sub === undefined || SUB_RE.test(sub);
}

/** The cast a /c/ or /card/ path means, or null. Percent-encoding is refused
 *  outright: no real name or repo path needs it, and it is how `..` and `/`
 *  would be smuggled past the segment checks. */
export function parseSharePath(pathname: string, prefix: "/c/" | "/card/"): ShareTarget | null {
  if (!pathname.startsWith(prefix) || pathname.includes("%")) return null;
  let rest = pathname.slice(prefix.length).replace(/\/+$/, "");
  if (prefix === "/card/") {
    if (!rest.endsWith(".png")) return null;
    rest = rest.slice(0, -".png".length);
  }
  const parts = rest.split("/");
  if (parts[0] === "gh") {
    const [, owner, repo, ...path] = parts;
    if (!owner || !repo || path.length === 0) return null;
    if (![owner, repo, ...path].every((p) => GH_PART_RE.test(p) && p !== "." && p !== "..")) return null;
    let file = path.join("/");
    if (prefix === "/card/") file += ".yaml";
    if (!/\.ya?ml$/i.test(file)) return null;
    return { kind: "gh", owner, repo, path: file };
  }
  if (parts.length > 2) return null;
  const base = parts[0].toLowerCase();
  const sub = parts[1]?.toLowerCase();
  if (!isName(base, sub)) return null;
  return { kind: "name", name: sub === undefined ? base : `${base}/${sub}` };
}

export function hashForShare(t: ShareTarget): string {
  return t.kind === "name" ? `#${t.name}` : `#gh=${t.owner}/${t.repo}/${t.path}`;
}

export function sharePathFor(t: ShareTarget): string {
  return t.kind === "name" ? `/c/${t.name}` : `/c/gh/${t.owner}/${t.repo}/${t.path}`;
}

export function cardPathFor(t: ShareTarget): string {
  return t.kind === "name" ? `/card/${t.name}.png` : `/card/gh/${t.owner}/${t.repo}/${t.path.replace(/\.ya?ml$/i, "")}.png`;
}

/** Link-preview crawlers (spec §3). Matched by their own product tokens only:
 *  the in-app browsers of Facebook, Instagram and LinkedIn carry `FBAN`,
 *  `Instagram` and `LinkedInApp` — a person, who must get the cast. */
const BOT_RE = /facebookexternalhit|facebot|linkedinbot|twitterbot|slackbot|discordbot|whatsapp\/|telegrambot|bluesky|cardyb|mastodon\/|redditbot|applebot|googlebot|skypeuripreview|iframely|embedly/i;

export function isPreviewBot(userAgent: string | null): boolean {
  return !!userAgent && BOT_RE.test(userAgent);
}

const TITLE_MAX = 120;
const LINE_MAX = 300;

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : one.slice(0, max - 1).trimEnd() + "…";
}

/** title and subtitle from a published cast's header — the first YAML
 *  document only (the audio rides in a second one). A locked envelope has
 *  neither key, so a private cast never puts a word on a card. */
export function castCardText(text: string): { title?: string; subtitle?: string } {
  const first = text.split(/^---\s*$/m, 1)[0];
  let head: unknown;
  try {
    head = yaml.load(first);
  } catch {
    return {};
  }
  if (!head || typeof head !== "object") return {};
  const { title, subtitle } = head as Record<string, unknown>;
  const out: { title?: string; subtitle?: string } = {};
  if (typeof title === "string" && title.trim()) out.title = clip(title, TITLE_MAX);
  if (typeof subtitle === "string" && subtitle.trim()) out.subtitle = clip(subtitle, LINE_MAX);
  return out;
}

/** A course's course.md: its `# Title`, and the first line of the paragraph
 *  under it. */
export function courseCardText(md: string): { title?: string; subtitle?: string } {
  const lines = md.split(/\r?\n/);
  const at = lines.findIndex((l) => /^# \S/.test(l));
  if (at < 0) return {};
  const out: { title?: string; subtitle?: string } = { title: clip(lines[at].slice(2), TITLE_MAX) };
  for (const l of lines.slice(at + 1)) {
    if (/^(---|#)/.test(l)) break;
    if (l.trim()) {
      out.subtitle = clip(l, LINE_MAX);
      break;
    }
  }
  return out;
}

export interface Card {
  title: string;
  description?: string;
  /** The /c/ link itself — og:url and canonical. */
  url: string;
  /** Absolute. */
  image: string;
  /** The # link that plays — the refresh and the fallback link. */
  playUrl: string;
}

export const GENERIC = { title: "drawcast", description: "Drawn explanations you can watch and play with", image: "/share-card.png" } as const;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function cardHtml(card: Card): string {
  const t = esc(card.title);
  const d = card.description ? esc(card.description) : null;
  const meta = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="drawcast">`,
    `<meta property="og:title" content="${t}">`,
    ...(d ? [`<meta property="og:description" content="${d}">`, `<meta name="description" content="${d}">`] : []),
    `<meta property="og:url" content="${esc(card.url)}">`,
    `<meta property="og:image" content="${esc(card.image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<link rel="canonical" href="${esc(card.url)}">`,
    `<meta http-equiv="refresh" content="0; url=${esc(card.playUrl)}">`,
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${t} — drawcast</title>${meta.join("")}</head><body><a href="${esc(card.playUrl)}">${t}</a></body></html>`;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tests/share-card.test.ts tests/name-host.test.ts`
Expected: PASS. If one of the bot strings fails, fix `BOT_RE`, not the test. The people list must stay unmatched.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/share-card.mts tests/share-card.test.ts
git commit -m "Share cards: the pure rules — /c/ and /card/ paths, crawlers, card text and page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The card function (`netlify/functions/card.mts`) and the generic picture

**Files:**
- Create: `netlify/functions/card.mts`
- Create: `public/share-card.png` (1200×630)
- Create: `scripts/share-card-image.mjs` (draws that PNG; kept so it can be redrawn)
- Test: `tests/card-endpoint.test.ts`

**Interfaces:**
- Consumes (Task 1): `parseSharePath`, `hashForShare`, `cardPathFor`, `sharePathFor`, `isPreviewBot`, `castCardText`, `courseCardText`, `cardHtml`, `GENERIC`, `ShareTarget`.
- Consumes (existing): `posterPathFor(castPath)` from `src/publish/cast.ts` gives the `.png` beside a `.yaml`. Copy its one-line rule, `path.replace(/\.ya?ml$/i, "") + ".png"`, rather than importing it, because `src/publish/cast.ts` pulls in app code. Pin it with a test.
- Produces:
  - `interface CardDeps { resolve(name: string): Promise<{ kind: "cast" | "course"; target: string } | null>; fetchText(url: string): Promise<string | null>; fetchImage(url: string): Promise<Response | null> }`
  - `handleCardRequest(req: Request, deps: CardDeps): Promise<Response>`
  - `config = { path: ["/c/*", "/card/*"] }`

How a target turns into card text and a picture URL:

| Resolved target | Text fetched from | Text read with | Picture |
|---|---|---|---|
| `kind: "cast"`, `owner/repo/path.yaml` | `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<path>` | `castCardText` | `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<path .png>` |
| `kind: "cast"`, `anvil/<slug>/<file>` | `https://drawcast.anvil.app/_/api/cast?cast=<key, encoded>&key=` | `castCardText` | generic (version 2) |
| `kind: "cast"`, `gdrive/<id>` | nothing | — | generic |
| `kind: "course"`, `owner/repo/<dir>` | `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<dir>/course.md` | `courseCardText` | generic |
| a `gh` share path (no name) | as the first row | `castCardText` | as the first row |

- [ ] **Step 1: Write the failing tests**

```ts
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
    expect(d.fetched).toContain("https://raw.githubusercontent.com/ann/casts/HEAD/casts/vaccines.png");
  });
  test("anything else is the generic picture by redirect", async () => {
    for (const p of ["/card/nobody.png", "/card/srv.png", "/card/drv.png", "/card/qaly.png", "/card/gh/ann/casts/casts/herd.png", "/card/x"]) {
      const res = await handleCardRequest(get(p, CHROME), deps());
      expect(res.status, p).toBe(302);
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/card-endpoint.test.ts`
Expected: FAIL, because `../netlify/functions/card.mts` cannot be resolved.

- [ ] **Step 3: Write the function**

```ts
// netlify/functions/card.mts
// drawcast.app/c/<name> and /card/<name>.png (spec 2026-10-02-share-design
// §§3–5). A person asking for /c/ is redirected at once to the # link that
// plays — no lookup, no visit (their own lookup after the redirect counts
// it, with the Referer the browser keeps across a 302). A link-preview
// crawler gets a card page: the cast's title and subtitle and the poster
// published beside it. Every failure is the generic card, status 200 — a
// broken preview in someone's feed is worse than a plain one.
import { cardHtml, cardPathFor, castCardText, courseCardText, GENERIC, hashForShare, isPreviewBot, parseSharePath, sharePathFor, type ShareTarget } from "../lib/share-card.mts";

const ANVIL_BASE = "https://drawcast.anvil.app";
const RAW = "https://raw.githubusercontent.com";
const FETCH_MS = 4000;

export interface CardDeps {
  resolve(name: string): Promise<{ kind: "cast" | "course"; target: string } | null>;
  fetchText(url: string): Promise<string | null>;
  fetchImage(url: string): Promise<Response | null>;
}

/** src/publish/cast.ts posterPathFor's rule, at a raw GitHub URL (that file
 *  pulls in the app; tests/card-endpoint.test.ts pins the two together). */
export function posterUrlFor(owner: string, repo: string, path: string): string {
  return `${RAW}/${owner}/${repo}/HEAD/${path.replace(/\.ya?ml$/i, "")}.png`;
}

function rawUrl(owner: string, repo: string, path: string): string {
  return `${RAW}/${owner}/${repo}/HEAD/${path}`;
}

/** A GitHub key `owner/repo/rest`, or null. */
function splitKey(target: string): { owner: string; repo: string; path: string } | null {
  const m = /^([\w.-]+)\/([\w.-]+)\/(.+)$/.exec(target);
  return m ? { owner: m[1], repo: m[2], path: m[3] } : null;
}

interface Found {
  text?: { title?: string; subtitle?: string };
  /** Absolute poster URL at the source, when the cast has one. */
  poster?: string;
}

/** A cast's card text from its source; "locked" for a private cast's
 *  envelope — which must leave no trace on a card, not even "A drawcast". */
async function castText(url: string, deps: CardDeps): Promise<{ title?: string; subtitle?: string } | "locked" | undefined> {
  const text = await deps.fetchText(url);
  if (text === null) return undefined;
  if (text.startsWith("drawcast-encrypted:")) return "locked";
  return castCardText(text);
}

async function find(t: ShareTarget, deps: CardDeps): Promise<Found | null> {
  if (t.kind === "gh") {
    const text = await castText(rawUrl(t.owner, t.repo, t.path), deps);
    return text === "locked" ? null : { text, poster: posterUrlFor(t.owner, t.repo, t.path) };
  }
  const r = await deps.resolve(t.name);
  if (!r) return null;
  if (r.kind === "course") {
    const k = splitKey(r.target);
    if (!k) return null;
    const md = await deps.fetchText(rawUrl(k.owner, k.repo, `${k.path}/course.md`));
    return { text: md === null ? undefined : courseCardText(md) };
  }
  if (r.target.startsWith("gdrive/")) return null;
  if (r.target.startsWith("anvil/")) {
    const text = await castText(`${ANVIL_BASE}/_/api/cast?cast=${encodeURIComponent(r.target)}&key=`, deps);
    return text === "locked" ? null : { text };
  }
  const k = splitKey(r.target);
  if (!k || !/\.ya?ml$/i.test(k.path)) return null;
  const text = await castText(rawUrl(k.owner, k.repo, k.path), deps);
  return text === "locked" ? null : { text, poster: posterUrlFor(k.owner, k.repo, k.path) };
}

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=600" } });
}

function redirect(location: string, cache = "no-store"): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": cache } });
}

export async function handleCardRequest(req: Request, deps: CardDeps): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405 });
  const url = new URL(req.url);
  const origin = url.origin;
  const genericImage = `${origin}${GENERIC.image}`;

  if (url.pathname.startsWith("/card/")) {
    const t = parseSharePath(url.pathname, "/card/");
    try {
      const found = t ? await find(t, deps) : null;
      if (found?.poster) {
        const img = await deps.fetchImage(found.poster);
        if (img && img.ok && (img.headers.get("content-type") ?? "").startsWith("image/")) {
          return new Response(img.body, { status: 200, headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
        }
      }
    } catch {
      /* the generic picture below */
    }
    return redirect(genericImage, "public, max-age=600");
  }

  const t = parseSharePath(url.pathname, "/c/");
  if (!isPreviewBot(req.headers.get("user-agent"))) return redirect(t ? `${origin}/${hashForShare(t)}` : `${origin}/`);

  const generic = cardHtml({ title: GENERIC.title, description: GENERIC.description, url: `${origin}/`, image: genericImage, playUrl: `${origin}/` });
  if (!t) return html(generic);
  let found: Found | null = null;
  try {
    found = await find(t, deps);
  } catch {
    found = null;
  }
  if (!found) return html(generic);
  // A known cast whose text could not be read (GitHub down, a locked
  // envelope) keeps nothing of its own but its picture — and a locked one
  // has none to keep (private publishes commit no poster).
  if (!found.text?.title && !found.poster) return html(generic);
  return html(
    cardHtml({
      title: found.text?.title ?? "A drawcast",
      description: found.text?.subtitle,
      url: `${origin}${sharePathFor(t)}`,
      image: found.poster ? `${origin}${cardPathFor(t)}` : genericImage,
      playUrl: `${origin}/${hashForShare(t)}`,
    }),
  );
}

async function timed(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

const live: CardDeps = {
  // Anvil directly, not the name function: a crawler is not a visit.
  resolve: async (name) => {
    const res = await timed(`${ANVIL_BASE}/_/api/name?n=${encodeURIComponent(name)}`);
    if (!res) return null;
    const b = (await res.json().catch(() => null)) as { kind?: unknown; target?: unknown } | null;
    return b && (b.kind === "cast" || b.kind === "course") && typeof b.target === "string" ? { kind: b.kind, target: b.target } : null;
  },
  fetchText: async (url) => {
    const res = await timed(url);
    return res ? await res.text() : null;
  },
  fetchImage: (url) => timed(url),
};

export default (req: Request): Promise<Response> => handleCardRequest(req, live);

export const config = { path: ["/c/*", "/card/*"] };
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/card-endpoint.test.ts tests/share-card.test.ts`
Expected: PASS. A known cast whose text cannot be read (GitHub down, no title) keeps its own picture and the title "A drawcast". A locked envelope gives the generic card: `castText` returns `"locked"` and `find` returns null.

- [ ] **Step 5: Draw the generic picture**

Create `scripts/share-card-image.mjs`. It renders an SVG to a 1200×630 PNG with the headless Chromium that `scripts/cast.mjs` already uses (same lookup):

```js
// scripts/share-card-image.mjs — draws public/share-card.png, the picture a
// link card shows when a cast has none of its own (spec 2026-10-02-share-design §4).
// Run: node scripts/share-card-image.mjs
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const home = homedir();
const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
  ?? (process.platform === "darwin" ? `${home}/Library/Caches/ms-playwright` : `${process.env.XDG_CACHE_HOME ?? `${home}/.cache`}/ms-playwright`);
const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort() : [];
if (!shells.length) throw new Error("no headless Chromium — run: npx playwright-core install chromium-headless-shell");
const dir = `${cache}/${shells.at(-1)}`;
const sub = readdirSync(dir).find((d) => d.startsWith("chrome-headless-shell"));
const browser = await chromium.launch({ executablePath: `${dir}/${sub}/chrome-headless-shell` });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(`<!doctype html><html><body style="margin:0">
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#faf7f2"/>
  <path d="M170 420 C 300 250, 420 520, 560 330 S 820 200, 1030 300" fill="none" stroke="#3d3833" stroke-width="10" stroke-linecap="round"/>
  <circle cx="1030" cy="300" r="16" fill="#c8553d"/>
  <text x="170" y="220" font-family="Georgia, serif" font-size="96" fill="#3d3833">drawcast</text>
  <text x="172" y="520" font-family="Georgia, serif" font-size="38" fill="#6b625a">Drawn explanations you can watch and play with</text>
</svg></body></html>`);
await page.screenshot({ path: "public/share-card.png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log("wrote public/share-card.png");
```

Check the executable path against `scripts/cast.mjs` lines 200–212: the binary inside `chrome-headless-shell-*` is `chrome-headless-shell`, or the platform's own name there. Use exactly what `cast.mjs` builds. Run `node scripts/share-card-image.mjs`, then open `public/share-card.png` and look at it. The text must be legible and nothing clipped.

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit && npx vitest run tests/card-endpoint.test.ts tests/share-card.test.ts tests/name-host.test.ts`
Expected: no type errors, all PASS.

```bash
git add netlify/functions/card.mts tests/card-endpoint.test.ts public/share-card.png scripts/share-card-image.mjs
git commit -m "Share cards: /c/ redirects people and gives crawlers a card; /card/ streams the poster

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Check delivery 1 against a real deploy

**Files:** none (verification only).

- [ ] **Step 1: Run locally with `netlify dev`**

Run `npx netlify dev --port 8888` in the worktree, so it serves this worktree's functions and not main's. Then:

```bash
curl -sI http://localhost:8888/c/<a real public name> | grep -i location
curl -s -A "facebookexternalhit/1.1" http://localhost:8888/c/<the same name> | head -c 1200
curl -sI -A "facebookexternalhit/1.1" http://localhost:8888/card/<the same name>.png
curl -s -A "facebookexternalhit/1.1" http://localhost:8888/c/nobody-at-all | grep og:title
```

Expected:
- The first command gives `location: http://localhost:8888/#<name>`.
- The second gives the card page with the cast's own title.
- The third gives `200` and `image/png`, or a 302 to `/share-card.png` if that cast has no poster.
- The fourth gives `og:title" content="drawcast"`.

Pick the name from a cast published from the app to GitHub, because those have a poster. Also open `http://localhost:8888/c/<name>` in a browser: the cast must play, muted.

- [ ] **Step 2: Ask the user before deploying**

Pushing `share` and deploying is outward-facing. Report the local results and ask whether to deploy (a deploy preview or production). After the go-ahead, deploy, then paste a `/c/<name>` link into Facebook's Sharing Debugger (developers.facebook.com/tools/debug) and LinkedIn's Post Inspector (linkedin.com/post-inspector). Record what each shows (title, line, picture, crop) in the delivery's report.

---

## Delivery 2 — the share box

### Task 4: The share link and platform URLs (`src/share/link.ts`)

**Files:**
- Create: `src/share/link.ts`
- Test: `tests/share-link.test.ts`

**Interfaces:**
- Consumes (existing): `nameInHash(hash: string): string | null` from `src/names.ts`.
- Produces:
  - `type Platform = "facebook" | "linkedin" | "x" | "bluesky" | "whatsapp" | "email"`
  - `interface ShareLink { url: string; card: boolean }`. `card` is false where only a generic card is possible.
  - `shareLinkFor(hash: string, origin?: string): ShareLink | null`, with origin defaulting to `"https://drawcast.app"`. Returns null when the cast has no source someone else can open (`#cast=`, `#paste`, an empty hash, a local file).
  - `platformUrl(p: Platform, s: { url: string; title: string; comment: string }): string`
  - `TAKES_TEXT: Record<Platform, boolean>`, false for facebook and linkedin.
  - `COMMENT_MAX = 280`

Mapping, by the first hash segment:

| Hash | Share link | `card` |
|---|---|---|
| `#vaccines…` (a name; `nameInHash` gives it) | `<origin>/c/vaccines` | true |
| `#learn-russian/3…` | `<origin>/c/learn-russian/3` | true |
| `#gh=o/r/p.yaml…` or `#gh-o/r/p.yaml` | `<origin>/c/gh/o/r/p.yaml` | true |
| `#anvil=slug/file.yaml…` (no name) | `<origin>/#anvil=slug/file.yaml` | false |
| `#gdrive=<id>…` | `<origin>/#gdrive=<id>` | false |
| `#cast=…`, `#paste…`, `""`, `#` | null | — |

Everything after the first `&` (mode, speed, join, …) is dropped: a share link carries no one's personal settings.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/share-link.test.ts
// What Share hands out (spec 2026-10-02-share-design §§3, 6): a /c/ path
// wherever a card is possible, the plain # link where it is not, nothing for
// a cast that lives only in its own link.
import { describe, expect, test } from "vitest";
import { COMMENT_MAX, platformUrl, shareLinkFor, TAKES_TEXT } from "../src/share/link";

describe("shareLinkFor", () => {
  test("names and sub-names become /c/ links", () => {
    expect(shareLinkFor("#vaccines")).toEqual({ url: "https://drawcast.app/c/vaccines", card: true });
    expect(shareLinkFor("#learn-russian/3&mode=silent")).toEqual({ url: "https://drawcast.app/c/learn-russian/3", card: true });
  });
  test("GitHub casts become /c/gh/ links, either spelling", () => {
    expect(shareLinkFor("#gh=ann/casts/casts/herd.yaml&speed=1.5")).toEqual({ url: "https://drawcast.app/c/gh/ann/casts/casts/herd.yaml", card: true });
    expect(shareLinkFor("#gh-ann/casts/casts/herd.yaml")).toEqual({ url: "https://drawcast.app/c/gh/ann/casts/casts/herd.yaml", card: true });
  });
  test("server and Drive casts keep their # link, with no card", () => {
    expect(shareLinkFor("#anvil=srv/intro.yaml&join")).toEqual({ url: "https://drawcast.app/#anvil=srv/intro.yaml", card: false });
    expect(shareLinkFor("#gdrive=abcdefghijkl")).toEqual({ url: "https://drawcast.app/#gdrive=abcdefghijkl", card: false });
  });
  test("nothing to share for a cast inside its link, a paste, or no hash", () => {
    for (const h of ["#cast=eJx", "#paste", "", "#"]) expect(shareLinkFor(h), h).toBeNull();
  });
  test("the origin is the one given", () => {
    expect(shareLinkFor("#vaccines", "http://localhost:8888")?.url).toBe("http://localhost:8888/c/vaccines");
  });
});

describe("platformUrl", () => {
  const s = { url: "https://drawcast.app/c/vaccines", title: "Why vaccines work", comment: "Thought of you & this" };
  test("each platform gets the link; those that take text get the comment", () => {
    expect(platformUrl("facebook", s)).toBe("https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fdrawcast.app%2Fc%2Fvaccines");
    expect(platformUrl("linkedin", s)).toBe("https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fdrawcast.app%2Fc%2Fvaccines");
    expect(platformUrl("x", s)).toBe("https://x.com/intent/post?url=https%3A%2F%2Fdrawcast.app%2Fc%2Fvaccines&text=Thought%20of%20you%20%26%20this");
    expect(platformUrl("bluesky", s)).toBe("https://bsky.app/intent/compose?text=Thought%20of%20you%20%26%20this%20https%3A%2F%2Fdrawcast.app%2Fc%2Fvaccines");
    expect(platformUrl("whatsapp", s)).toBe("https://wa.me/?text=Thought%20of%20you%20%26%20this%20https%3A%2F%2Fdrawcast.app%2Fc%2Fvaccines");
    expect(platformUrl("email", s)).toBe("mailto:?subject=Why%20vaccines%20work&body=Thought%20of%20you%20%26%20this%0A%0Ahttps%3A%2F%2Fdrawcast.app%2Fc%2Fvaccines");
  });
  test("no comment: the title is the text, and the email body is just the link", () => {
    const n = { ...s, comment: "  " };
    expect(platformUrl("x", n)).toContain("&text=Why%20vaccines%20work");
    expect(platformUrl("email", n)).toBe("mailto:?subject=Why%20vaccines%20work&body=https%3A%2F%2Fdrawcast.app%2Fc%2Fvaccines");
  });
  test("a comment over the limit is cut", () => {
    const long = { ...s, comment: "y".repeat(400) };
    expect(decodeURIComponent(platformUrl("whatsapp", long)).startsWith("y".repeat(COMMENT_MAX) + " https")).toBe(true);
  });
  test("Facebook and LinkedIn take no text", () => {
    expect(TAKES_TEXT).toEqual({ facebook: false, linkedin: false, x: true, bluesky: true, whatsapp: true, email: true });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/share-link.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Write the module**

```ts
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

export function shareLinkFor(hash: string, origin = "https://drawcast.app"): ShareLink | null {
  const head = hash.replace(/^#/, "").split("&", 1)[0];
  if (!head) return null;
  const gh = /^gh[=-]([\w.-]+\/[\w.-]+\/[^&\s]+\.ya?ml)$/i.exec(head);
  if (gh) return { url: `${origin}/c/gh/${gh[1]}`, card: true };
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
```

Check `nameInHash` in `src/names.ts` before relying on it. It must return null for `cast=…`, `paste`, `gh=…`, `anvil=…` and `gdrive=…`, and the bare name for `#vaccines&mode=silent`. If it behaves differently, adapt `shareLinkFor`, not the test table.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/share-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/share/link.ts tests/share-link.test.ts
git commit -m "Share: the link a cast is shared by, and each platform's share URL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: The share box (`src/ui/share-box.ts`)

**Files:**
- Create: `src/ui/share-box.ts`
- Modify: `src/styles.css` (append a `.share-box` block)
- Test: `tests/share-box.test.ts` (the pure part only; the DOM is checked by eye in Task 6)

**Interfaces:**
- Consumes (Task 4): `ShareLink`, `Platform`, `platformUrl`, `TAKES_TEXT`, `COMMENT_MAX`.
- Consumes (existing): `h` from `src/ui/dom` (the helper the other `src/ui/*.ts` files import; check the import line in `src/ui/controls.ts`), `icon` from `src/ui/icons`.
- Produces:
  - `interface ShareInfo { link: ShareLink; title: string; subtitle?: string; image?: string }`. `image` is the absolute URL of the card picture (`/card/…`), absent for `card: false`.
  - `cardImageUrl(link: ShareLink): string | undefined`. For a `/c/…` URL it gives the matching `/card/….png` URL (same rule as `cardPathFor`), otherwise undefined.
  - `openShareBox(info: ShareInfo): void`
  - `DESKTOP_PLATFORMS: Platform[] = ["email", "facebook", "linkedin", "x", "bluesky", "whatsapp"]`

What the box contains (spec §6), top to bottom:
1. The card preview: `<img>` from `info.image`, or for `card: false` no image and the line "Links to this cast show a plain card." Then the title in bold, then the subtitle.
2. The link in a read-only `<input>`, and a **Copy link** button that writes it to the clipboard and changes to "Copied" for 1.6 s.
3. A `<textarea>` "Add a comment (optional)", with `maxlength=280`.
4. If `navigator.share` exists: a large **Share…** button. It calls `navigator.share({ title, text: comment || title, url })`. If `navigator.canShare?.({ files: [file] })` is true for a `File` made from the fetched card image, it adds `files: [file]`. Fetch the image when the box opens so the click stays a user gesture. If the fetch fails, share without the file. A rejected promise (cancelled) is ignored.
5. The platform list: one `<a target="_blank" rel="noopener">` per `DESKTOP_PLATFORMS` entry, with its name as text. Its `href` is recomputed from `platformUrl` on every comment `input`. When `!TAKES_TEXT[p]` and the comment is non-empty, its click first writes the comment to the clipboard and shows "Your comment is copied — paste it into the post." under the list. With a native share button present, the list sits under a quieter heading, "Or share to".
6. **Copy image**, only when `info.image` is set and `"ClipboardItem" in window`. It fetches the image and writes `new ClipboardItem({ "image/png": blob })`, then shows "Copied" for 1.6 s. Any failure shows "Could not copy the picture".

The box is a `<dialog class="share-box">` appended to `document.body` and opened with `showModal()`. A close button (`icon("close")`, `aria-label="Close"`) and Escape both close it. On close it removes itself. Focus starts on the Copy link button. Only one box at a time: opening a second removes the first.

- [ ] **Step 1: Write the failing test for the pure helper**

```ts
// tests/share-box.test.ts
// The share box's one pure rule: the picture a /c/ link's card shows. The
// dialog itself is checked by eye (spec 2026-10-02-share-design §6).
import { expect, test } from "vitest";
import { cardImageUrl, DESKTOP_PLATFORMS } from "../src/ui/share-box";

test("a /c/ link's picture is its /card/ twin; a plain link has none", () => {
  expect(cardImageUrl({ url: "https://drawcast.app/c/vaccines", card: true })).toBe("https://drawcast.app/card/vaccines.png");
  expect(cardImageUrl({ url: "https://drawcast.app/c/learn-russian/3", card: true })).toBe("https://drawcast.app/card/learn-russian/3.png");
  expect(cardImageUrl({ url: "https://drawcast.app/c/gh/ann/casts/casts/herd.yaml", card: true })).toBe("https://drawcast.app/card/gh/ann/casts/casts/herd.png");
  expect(cardImageUrl({ url: "https://drawcast.app/#gdrive=abcdefghijkl", card: false })).toBeUndefined();
});

test("the computer's list, email first", () => {
  expect(DESKTOP_PLATFORMS).toEqual(["email", "facebook", "linkedin", "x", "bluesky", "whatsapp"]);
});
```

The module must not touch the DOM at import time, because vitest runs with no DOM. Build everything inside `openShareBox`.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/share-box.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Write the module**

```ts
// src/ui/share-box.ts
// The Share box (spec 2026-10-02-share-design §6): the card as a feed will
// show it, the link, an optional comment, and where to send it — the
// device's own share sheet where there is one, a short list of platforms
// everywhere. Nothing is posted by drawcast: every button opens the
// platform's own share page, or the mail app, with the link filled in.
// Built only when opened — vitest imports this file with no DOM.
import { COMMENT_MAX, platformUrl, TAKES_TEXT, type Platform, type ShareLink } from "../share/link";
import { h } from "./dom";
import { icon } from "./icons";

export interface ShareInfo {
  link: ShareLink;
  title: string;
  subtitle?: string;
  /** Absolute /card/… URL; absent where only a plain card is possible. */
  image?: string;
}

export const DESKTOP_PLATFORMS: Platform[] = ["email", "facebook", "linkedin", "x", "bluesky", "whatsapp"];

const LABEL: Record<Platform, string> = { email: "Email", facebook: "Facebook", linkedin: "LinkedIn", x: "X", bluesky: "Bluesky", whatsapp: "WhatsApp" };

/** netlify/lib/share-card.mts cardPathFor's rule, on a full /c/ URL. */
export function cardImageUrl(link: ShareLink): string | undefined {
  if (!link.card) return undefined;
  const u = new URL(link.url);
  if (!u.pathname.startsWith("/c/")) return undefined;
  const rest = u.pathname.slice("/c/".length);
  const png = rest.startsWith("gh/") ? `${rest.replace(/\.ya?ml$/i, "")}.png` : `${rest}.png`;
  return `${u.origin}/card/${png}`;
}

let current: HTMLDialogElement | null = null;

function flash(btn: HTMLElement, text: string, back: string): void {
  btn.textContent = text;
  window.setTimeout(() => (btn.textContent = back), 1600);
}

export function openShareBox(info: ShareInfo): void {
  current?.remove();
  const note = h("p", { class: "share-note", role: "status" });
  const say = (s: string): void => {
    note.textContent = s;
  };

  const preview = h(
    "div",
    { class: "share-card" },
    ...(info.image ? [h("img", { src: info.image, alt: "" })] : [h("p", { class: "share-plain" }, "Links to this cast show a plain card.")]),
    h("strong", {}, info.title),
    ...(info.subtitle ? [h("span", {}, info.subtitle)] : []),
  );

  const linkField = h("input", { type: "text", readonly: "", value: info.link.url, "aria-label": "Link" }) as HTMLInputElement;
  const copyLink = h("button", { type: "button" }, "Copy link") as HTMLButtonElement;
  copyLink.addEventListener("click", () => {
    void navigator.clipboard?.writeText(info.link.url).then(() => flash(copyLink, "Copied", "Copy link"), () => linkField.select());
  });

  const comment = h("textarea", { rows: "2", maxlength: String(COMMENT_MAX), placeholder: "Add a comment (optional)", "aria-label": "Comment" }) as HTMLTextAreaElement;
  const s = () => ({ url: info.link.url, title: info.title, comment: comment.value });

  const items = DESKTOP_PLATFORMS.map((p) => {
    const a = h("a", { href: platformUrl(p, s()), target: "_blank", rel: "noopener" }, LABEL[p]) as HTMLAnchorElement;
    a.addEventListener("click", () => {
      if (!TAKES_TEXT[p] && comment.value.trim()) {
        void navigator.clipboard?.writeText(comment.value.trim()).then(() => say("Your comment is copied — paste it into the post."));
      }
    });
    return { p, a };
  });
  comment.addEventListener("input", () => {
    for (const { p, a } of items) a.href = platformUrl(p, s());
  });
  const list = h("ul", { class: "share-list" }, ...items.map(({ a }) => h("li", {}, a)));

  let file: File | null = null;
  if (info.image) {
    void fetch(info.image)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b) file = new File([b], "drawcast.png", { type: b.type || "image/png" });
      })
      .catch(() => undefined);
  }

  const native: HTMLElement[] = [];
  if (typeof navigator.share === "function") {
    const btn = h("button", { type: "button", class: "share-native" }, icon("share"), " Share…") as HTMLButtonElement;
    btn.addEventListener("click", () => {
      const data: ShareData = { title: info.title, text: comment.value.trim() || info.title, url: info.link.url };
      if (file && navigator.canShare?.({ files: [file] })) data.files = [file];
      navigator.share(data).catch(() => undefined);
    });
    native.push(btn, h("p", { class: "share-or" }, "Or share to"));
  }

  const extra: HTMLElement[] = [];
  if (info.image && "ClipboardItem" in window) {
    const copyImage = h("button", { type: "button" }, "Copy image") as HTMLButtonElement;
    copyImage.addEventListener("click", () => {
      void fetch(info.image!)
        .then((r) => r.blob())
        .then((b) => navigator.clipboard.write([new ClipboardItem({ [b.type || "image/png"]: b })]))
        .then(() => flash(copyImage, "Copied", "Copy image"), () => say("Could not copy the picture"));
    });
    extra.push(copyImage);
  }

  const close = h("button", { type: "button", class: "share-close", "aria-label": "Close" }, icon("close")) as HTMLButtonElement;
  const dlg = h(
    "dialog",
    { class: "share-box", "aria-label": "Share this drawcast" },
    close,
    preview,
    h("div", { class: "share-row" }, linkField, copyLink),
    comment,
    ...native,
    list,
    ...extra,
    note,
  ) as HTMLDialogElement;
  close.addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => {
    dlg.remove();
    if (current === dlg) current = null;
  });
  document.body.appendChild(dlg);
  current = dlg;
  dlg.showModal();
  copyLink.focus();
}
```

Check that `h` accepts `readonly: ""` and `value` as attributes and that `h("dialog", …)` works. Look at `src/ui/dom.ts` (or wherever `h` lives; follow `src/ui/controls.ts`'s import). If `value` is set as an attribute, `input.value` still reads it on first render, which is fine. Also check the `ShareData.files` typing under the repo's `lib` setting. If `tsc` complains, widen it locally with `(data as ShareData & { files?: File[] }).files = [file]`.

- [ ] **Step 4: Styles**

Append to `src/styles.css`, using the variables the file already uses for dialogs. Look at the `dialog` and `dialog::backdrop` rules near line 1196 and reuse their colours:

```css
/* The Share box (spec 2026-10-02-share-design §6). */
.share-box { width: min(26rem, calc(100vw - 2rem)); padding: 1rem 1.1rem 1.1rem; border: 0; border-radius: 10px; }
.share-box .share-close { position: absolute; top: 0.4rem; right: 0.4rem; background: none; border: 0; padding: 0.3rem; cursor: pointer; }
.share-card { display: flex; flex-direction: column; gap: 0.25rem; margin: 0.6rem 0 0.8rem; }
.share-card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; background: #f2eee8; }
.share-card span, .share-plain, .share-or, .share-note { color: #6b625a; font-size: 0.9rem; margin: 0; }
.share-row { display: flex; gap: 0.4rem; margin-bottom: 0.6rem; }
.share-row input { flex: 1; min-width: 0; }
.share-box textarea { width: 100%; box-sizing: border-box; margin-bottom: 0.6rem; }
.share-native { width: 100%; padding: 0.6rem; font-size: 1rem; margin-bottom: 0.4rem; display: flex; align-items: center; justify-content: center; gap: 0.4rem; }
.share-list { list-style: none; padding: 0; margin: 0 0 0.6rem; display: flex; flex-wrap: wrap; gap: 0.4rem 0.9rem; }
```

- [ ] **Step 5: Run the test and type-check**

Run: `npx vitest run tests/share-box.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/share-box.ts src/styles.css tests/share-box.test.ts
git commit -m "Share box: card preview, link, comment, device share sheet, platforms, copy image

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The viewer's share icon opens the box

**Files:**
- Modify: `src/viewer.ts` (`shareButton`, around lines 647–676, and its use around line 723)

**Interfaces:**
- Consumes (Task 4): `shareLinkFor(hash): ShareLink | null`. Consumes (Task 5): `openShareBox(info)`, `cardImageUrl(link)`.
- The viewer already knows the playlist once it loads. The title is what it puts in `document.title`; the subtitle is `playlist.meta.subtitle`. Find where `runViewer` parses the cast text into a playlist, and keep `meta.subtitle` in a variable the button reads.

Behaviour:
- `shareLinkFor(location.hash, "https://drawcast.app")` is computed when the button is clicked. The origin is always `https://drawcast.app`, even on the view origin or a deploy preview: the link people get must be the public one. For local checks, `?shareOrigin=` is not added, because YAGNI. Task 3's `curl` checks cover the function locally.
- When it is null (`#cast=` and the like), the button keeps today's behaviour: device share or copy `location.href`. The link inside the link is all there is, and nothing is lost.
- Otherwise, the click calls `openShareBox({ link, title: castTitle || document.title, subtitle, image: cardImageUrl(link) })`.

- [ ] **Step 1: Change `shareButton`**

Replace the click handler body in `shareButton()` (`src/viewer.ts:654`). Give the function a parameter that reads the current title and subtitle:

```ts
function shareButton(meta: () => { title: string; subtitle?: string }): HTMLButtonElement {
  const btn = h("button", { class: "cs-bar-btn viewer-share", title: "Share this drawcast" }, icon("share")) as HTMLButtonElement;
  btn.addEventListener("click", () => {
    const link = shareLinkFor(location.hash);
    if (link) {
      const { title, subtitle } = meta();
      openShareBox({ link, title, subtitle, image: cardImageUrl(link) });
      return;
    }
    // A cast that lives only in its own link: that link is the share.
    const url = location.href;
    const title = document.title;
    if (navigator.share) {
      navigator.share({ title, url }).catch(() => {
        /* cancelled — not an error */
      });
      return;
    }
    void navigator.clipboard?.writeText(url).then(() => {
      btn.replaceChildren(icon("check"));
      btn.title = "Link copied";
      window.setTimeout(() => {
        btn.replaceChildren(icon("share"));
        btn.title = "Share this drawcast";
      }, 1600);
    });
  });
  return btn;
}
```

Update the doc comment above it to say the icon now opens the Share box (spec 2026-10-02-share-design §6), keeping the copy fallback for `#cast=` links. Add the imports `import { shareLinkFor } from "./share/link";` and `import { cardImageUrl, openShareBox } from "./ui/share-box";`.

- [ ] **Step 2: Feed it the title and subtitle**

At the `const shareBtn = shareButton();` line (around 723), declare `let castMeta: { title: string; subtitle?: string } = { title: document.title };` above it and pass `() => castMeta`. Where `runViewer` has the parsed playlist, set `castMeta = { title: playlist.meta.title ?? document.title, subtitle: playlist.meta.subtitle };`. Find that spot by searching `runViewer` for `parsePlaylistText` or `.meta.title`.

- [ ] **Step 3: Type-check and run the viewer's tests**

Run: `npx tsc --noEmit && npx vitest run tests/share-link.test.ts tests/share-box.test.ts $(ls tests | grep -E '^viewer' | sed 's#^#tests/#')`
Expected: no type errors; PASS.

- [ ] **Step 4: Check it by eye in the browser**

Run `npm run dev -- --port 5199 --strictPort` in the worktree. Open a public named cast (`http://localhost:5199/#<name>`), mute the player, and press the share icon. Check:
- the box opens with the card (the picture will 404 locally, because `/card/` lives on drawcast.app; the `<img>` simply shows nothing), the title, the subtitle and the `https://drawcast.app/c/<name>` link;
- Copy link copies it;
- typing a comment updates the X and WhatsApp links;
- Facebook with a comment shows the "copied" note;
- Escape closes the box;
- a `#cast=` link still copies or shares its own URL.

In Chrome's device toolbar (a phone), "Share…" shows where `navigator.share` exists. Take one screenshot of the box for the report.

- [ ] **Step 5: Commit**

```bash
git add src/viewer.ts
git commit -m "Viewer: the share icon opens the Share box with the cast's /c/ link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The editor offers Share after a publish

**Files:**
- Modify: `src/main.ts`, the GitHub publish success status (around lines 5300–5310, `setStatus(\`Published to ${out.castUrl}…\`)`)

**Interfaces:**
- Consumes (Tasks 4–5): `shareLinkFor`, `openShareBox`, `cardImageUrl`.
- Consumes (existing): `doc.freeName` (set from the registry just above), `doc.title`, `doc.playlist.meta.subtitle`, `setStatusAction(text, label, onClick, kind)` (`src/main.ts:540`), and the repo, casts folder and slug this publish used (the same values in the `target:` string at line 5283).

Behaviour: after a successful public GitHub publish, the status line keeps its text and gains a **Share…** button. The share link is `shareLinkFor("#" + doc.freeName)` when there is a free name. Otherwise it is `shareLinkFor(\`#gh=${repoStr}/${joinPath(castsDir, \`${out.slug}.yaml\`)}\`)`, built from the same pieces as the registry target at line 5283. A private (locked) publish gets no button.

- [ ] **Step 1: Change the success line**

Replace the non-private branch:

```ts
else setStatus(`Published to ${out.castUrl}${lastEmbedNote}${lastBakeNote}${regSuffix}`, "ok");
```

with:

```ts
else {
  const link = shareLinkFor(doc.freeName ? `#${doc.freeName}` : `#gh=${repoStr}/${joinPath(castsDir, `${out.slug}.yaml`)}`);
  const text = `Published to ${out.castUrl}${lastEmbedNote}${lastBakeNote}${regSuffix}`;
  if (link) setStatusAction(text, "Share…", () => openShareBox({ link, title: doc.title, subtitle: doc.playlist.meta.subtitle, image: cardImageUrl(link) }), "ok");
  else setStatus(text, "ok");
}
```

Use the variable names actually in scope there: check that `repoStr`, `castsDir` and `out.slug` exist at that point by reading lines 5230–5310. If the slug lives under another name, use it. Add the imports at the top of `main.ts`, beside the other `./ui/…` imports.

- [ ] **Step 2: Type-check, run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors. The full suite passes. The suite is large, and the known birpc teardown error at the very end is not a failure of this work (see `netlify.toml`'s comment). Report the counts.

- [ ] **Step 3: Check it by eye**

In the dev server, publish a test cast to a scratch repo only if the user has one configured and agrees, since this is outward-facing. Otherwise, check the branch by temporarily calling the same `setStatusAction(...)` from the browser console with a known link, then revert. Confirm the Share… button opens the box.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "Editor: Share… after a GitHub publish opens the Share box

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the tasks

- Full suite and `tsc` once more. Then report to the user: what was built, the local `curl` results, screenshots of the box, and anything skipped.
- Ask before pushing `share`, merging to `main`, or deploying. After a deploy, run Task 3 Step 2's debugger checks and add the results to the report.
- Deliveries 3 (pictures from Claude Code publishes) and 4 (the `?s=` tag and stats) get their own plans.
