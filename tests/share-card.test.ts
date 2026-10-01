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
  test("a published cast's title and subtitle sit under playlist:", () => {
    expect(castCardText("playlist:\n  title: What is a QALY?\n  subtitle: One number for length and quality.\n---\ntitle: Longer or better?\nelements: []\n")).toEqual({ title: "What is a QALY?", subtitle: "One number for length and quality." });
  });
  test("a playlist: header with no title gives nothing, even if a later document has one", () => {
    expect(castCardText("playlist:\n  prompt: Why?\n---\ntitle: Longer or better?\n")).toEqual({});
  });
  test("a playlist: header whose title is not a string gives nothing", () => {
    expect(castCardText("playlist:\n  title: 42\n")).toEqual({});
  });
});

describe("courseCardText", () => {
  test("the first # heading, then the first paragraph line", () => {
    expect(courseCardText("# QALY basics\n\nWhat a quality-adjusted life year is.\nMore.\n\n---\n## Lecture 1\n")).toEqual({ title: "QALY basics", subtitle: "What a quality-adjusted life year is." });
  });
  test("no heading, nothing", () => {
    expect(courseCardText("just text\n")).toEqual({});
  });
  const REAL = (priv: string) => `# Understanding the QALY: Definition, Calculation, and Debates\n${priv}enroll: https://drawcast.anvil.app\nslug: understanding-the-qaly\nlevel: advanced undergraduate\n\nA five-lecture course unpacking the Quality-Adjusted Life Year.\n\n---\n## What is a QALY, and why do we need it?\n`;
  test("a private course leaves no text", () => {
    expect(courseCardText(REAL("private: true\n"))).toEqual({});
  });
  test("option lines are skipped: title plus the intro line", () => {
    const want = { title: "Understanding the QALY: Definition, Calculation, and Debates", subtitle: "A five-lecture course unpacking the Quality-Adjusted Life Year." };
    expect(courseCardText(REAL("private: false\n"))).toEqual(want);
    expect(courseCardText(REAL(""))).toEqual(want);
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
