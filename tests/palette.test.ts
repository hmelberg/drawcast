import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";

const tokens = async (): Promise<Record<string, string>> => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of root.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
};

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#b5482e", "#b5482e")).toBeCloseTo(1, 5);
  });
});

describe("the palette", () => {
  it("gives panels a real edge — borders reach the 3:1 UI minimum", async () => {
    const t = await tokens();
    expect(contrastRatio(t["--line"], t["--paper"])).toBeGreaterThanOrEqual(3);
  });

  it("makes muted text readable — 4.5:1 on the surface it sits on", async () => {
    const t = await tokens();
    expect(contrastRatio(t["--muted"], t["--surface"])).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps body ink far clear of the minimum", async () => {
    const t = await tokens();
    expect(contrastRatio(t["--ink"], t["--surface"])).toBeGreaterThanOrEqual(7);
  });
});

// Round 2 fix: the accent keeps three deliberate roles instead of one —
// primary action, "you are here", and inline links — and loses everywhere
// else (hover states, and incidental text/controls). Rather than a narrowed
// test that only checks the sites this task happened to touch, this is an
// explicit allowlist: every var(--rust) use in styles.css must sit inside a
// rule whose selector matches one of these. A future accent use then has to
// be added here deliberately instead of drifting in unnoticed — which is how
// the file ended up with 32 uses across three "one job" rounds of intent.
// :root (where --rust is defined) is not in this list because the token
// definition itself never contains the literal text "var(--rust)", so the
// rule-matching regex below never sees it.
//
// A var(--rust) that ends up inside an @media block (none do today) gets
// attributed to the media prelude — e.g. "@media (max-width: 560px)" — as
// its "selector", by the same regex that reads a normal rule's selector.
// That text never matches anything in the allowlist below, so the test
// fails — correctly, since an unreviewed rust use is still an unreviewed
// rust use — but the failure message points at the @media line, not the
// actual rule inside it that uses --rust. If you land here debugging that:
// look for the nearest var(--rust) *inside* the reported block, not on the
// reported line itself.
const RUST_ALLOWED_SELECTORS = [
  "button.primary", // primary action — covers button.primary and button.primary.cancelling:hover
  ".tab-btn.active", // you are here
  ".library-open.current",
  ".pl-dot.current",
  ".pl-item.current",
  ".share-dest.current",
  ".cs-infocard-actions a", // inline links
  ".cs-infocard-actions .cs-infocard-act",
  ".cs-mediamodal-bar a",
];

/**
 * Round-2 fix-round-2: checks a rule's selector *list* (as captured whole
 * from source, e.g. "a, b, c") against an allowlist. The naive version of
 * this check — `selectorList.includes(allowed)` — only asks whether an
 * allowed selector appears somewhere in the joined string, so a rule
 * smuggling an unlisted selector in on the same line as a legitimate one —
 * `.tab-btn.active, .sneaky-new-thing { color: var(--rust); }` — passes
 * silently: the string contains ".tab-btn.active", and that's all the naive
 * check looks for. Splitting on "," and requiring *every* part to
 * independently match closes that hole. Each part is still matched by
 * substring (not exact equality) against the allowlist, so compound/pseudo
 * selectors like "button.primary.cancelling:hover" still match the bare
 * "button.primary" entry that names their role.
 */
export const isRustUseAllowed = (selectorList: string, allowedList: string[]): boolean =>
  selectorList
    .split(",")
    .map((part) => part.trim())
    .every((part) => allowedList.some((allowed) => part.includes(allowed)));

describe("the accent — an explicit allowlist", () => {
  it("spends var(--rust) only on the permitted selectors", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const uses = [...css.matchAll(/([^{}]+)\{([^}]*var\(--rust\)[^}]*)\}/g)].map((m) => m[1].trim());
    for (const sel of uses) {
      expect(isRustUseAllowed(sel, RUST_ALLOWED_SELECTORS), sel).toBe(true);
    }
  });

  // Proves the guard actually rejects something. A rule list that smuggles
  // an unlisted selector in alongside a permitted one must be caught
  // per-part — this is exactly the shape of rule the naive whole-string
  // .includes() check let through silently.
  it("rejects a selector list that smuggles an unlisted selector past a permitted one", () => {
    expect(isRustUseAllowed(".tab-btn.active, .sneaky-new-thing", RUST_ALLOWED_SELECTORS)).toBe(false);
  });

  // And confirms the fix didn't break genuinely compound/pseudo-class
  // matches in the process.
  it("still accepts a single selector that legitimately matches an allowed entry", () => {
    expect(isRustUseAllowed("button.primary.cancelling:hover", RUST_ALLOWED_SELECTORS)).toBe(true);
    expect(isRustUseAllowed(".cs-infocard-actions a, .cs-mediamodal-bar a", RUST_ALLOWED_SELECTORS)).toBe(true);
  });
});

// Round-2 fix-round: an explicit allowlist of every literal font-size value
// already in the file, reviewed once here — same idiom as RUST_ALLOWED_
// SELECTORS above. The denylist this replaces
// (`not.toMatch(/font-size:\s*0\.(92|85|82|78|75)rem/)`) only ever banned the
// five sizes one specific past migration retired; it caught none of
// 0.86/0.88/0.9/0.95/1.02rem, which reads exactly like a near-miss of
// --text-sm (0.875rem) or --text (1rem) but was never on that list — so a
// denylist can never actually enforce "three sizes", only guard one past
// regression. An allowlist does: any NEW literal has to be added here
// deliberately, so a future near-token typo fails loudly instead of quietly
// surviving the way these did.
const FONT_SIZE_ALLOWED = [
  "var(--text)", "var(--text-sm)", "var(--text-xs)",
  // The wordmark and a handful of other elements are deliberately their own
  // size, outside the three-token body/secondary/dense scale (see the
  // --text-sm token comment at the top of styles.css) — reviewed once, here.
  "15px", "12px",
  "2rem", "1.9rem", "1.7rem", "1.5rem", "1.4rem", "1.2rem", "1.15rem", "1.05rem", "1.02rem",
  "0.95rem", "0.9rem", "0.9em", "0.88rem", "0.86rem", "0.8rem", "0.7rem",
];

describe("the type scale", () => {
  it("names every literal font-size once — an explicit allowlist, not a denylist a near-miss slips past", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(sizes.length).toBeGreaterThan(10); // the scan itself must not silently shrink to nothing
    for (const size of sizes) {
      expect(FONT_SIZE_ALLOWED, size).toContain(size);
    }
  });

  // Proves the allowlist actually rejects something, the same way the rust
  // allowlist's own guard-test does above.
  it("rejects a font-size that isn't on the list", async () => {
    const css = 'button { color: red; font-size: 0.87rem; }';
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(sizes).toEqual(["0.87rem"]);
    expect(FONT_SIZE_ALLOWED).not.toContain("0.87rem");
  });

  it("moves the course textarea's font-size onto the scale", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(/\.course-ask\s*\{[^}]*\}/.exec(css)?.[0]).toMatch(/font-size:\s*var\(--text-sm\)/);
  });
});

describe("dark mode", () => {
  it("defines the dark palette once, and redefines only tokens that exist in light", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const blocks = [...css.matchAll(/@media\s*\(prefers-color-scheme:\s*dark\)/g)];
    expect(blocks.length).toBe(1);
    const dark = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    const root = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    for (const m of dark.matchAll(/(--[\w-]+):/g)) expect(root).toContain(m[1]);
  });

  it("lets an explicit choice win in both directions", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/:root\[data-theme="dark"\]/);
    expect(css).toMatch(/:root:not\(\[data-theme="light"\]\)/);
  });

  it("keeps dark text readable", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const dark = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    const t: Record<string, string> = {};
    for (const m of dark.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) t[m[1]] = m[2];
    expect(contrastRatio(t["--muted"], t["--surface"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["--line"], t["--paper"])).toBeGreaterThanOrEqual(3);
    // Borders sit on panels as well as on the page; a paper-only check passes
    // colours that still vanish against a surface.
    expect(contrastRatio(t["--line"], t["--surface"])).toBeGreaterThanOrEqual(3);
    // --field is the input/select/textarea ground — same minimum body text
    // needs everywhere else (round-2 fix: it used to be a literal #fff no
    // dark override ever touched, stranding dark --ink at ~1.24:1).
    expect(contrastRatio(t["--ink"], t["--field"])).toBeGreaterThanOrEqual(7);
  });
});

// Round-2 fix: four chrome rules paired a themed foreground (var(--ink), the
// one that flips light/dark) with a hardcoded LIGHT background — #fff dead
// ahead, in the same rule, so dark mode put light-on-light text everywhere
// from the spec textarea to the mode pill. --field (light #fff, themed dark)
// replaces the input/select/textarea cases; .mode-btn.active's ink FILL takes
// --paper as its foreground instead of literal white, the same fix in the
// other direction. These assertions describe the invariant, not just the
// four sites the reviewer found — a sweep, so a fifth future site fails the
// same way.
// Round-2 fix-round-2: parses an actual channel value (hex or rgba) out of a
// CSS colour literal instead of matching the literal text "#fff"/"white" —
// so a near-white PAPER tone like rgba(255, 253, 246, 0.93) is caught the
// same way pure white is. A token reference (var(--surface)) never matches:
// it carries no literal channel values, and themed-on-themed is exactly the
// safe case this test isn't after.
export const isNearWhite = (value: string): boolean => {
  if (/\bwhite\b/i.test(value)) return true;
  const hex = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (r >= 240 && g >= 235 && b >= 225) return true;
  }
  const rgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (rgba) {
    const [r, g, b] = rgba.slice(1, 4).map(Number);
    if (r >= 240 && g >= 235 && b >= 225) return true;
  }
  return false;
};

describe("dark-mode-safe surfaces", () => {
  it("defines a themed --field token, distinct from --surface once dark", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const root = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    expect(root).toMatch(/--field:\s*#fff\b/);
    const dark = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    const t: Record<string, string> = {};
    for (const m of dark.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) t[m[1]] = m[2];
    expect(t["--field"]).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(t["--field"]).not.toBe(t["--surface"]);
  });

  it("no rule pairs a themed foreground (--ink/--muted) with a literal white background", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    let checked = 0;
    for (const [, selector, body] of blocks) {
      const themedFg = /color:\s*var\(--(ink|muted)\)/.test(body);
      // Anywhere in a background declaration's value, not just anchored right
      // after the colon — .sidebar-new's bug was color-mix(in srgb, var(--ink)
      // 7%, #fff), where #fff is the color-mix's second argument, not the
      // whole background value.
      //
      // Round-2 fix-round-2: a plain "#fff\b|#ffffff\b|\bwhite\b" grep is
      // structurally blind to a NEAR-white ground — rgba(255, 253, 246, 0.93),
      // the figure's own paper tone at reduced opacity — which is exactly
      // what .cs-bigplay:hover and .cs-keyguide-key used. isNearWhite parses
      // the actual channel values (hex or rgba) instead of matching literal
      // "fff"/"white" text, so an off-white paper tone is caught the same way
      // pure white is.
      const bgMatch = /background(?:-color)?:\s*([^;]+);?/i.exec(body);
      const literalWhiteBg = bgMatch ? isNearWhite(bgMatch[1]) : false;
      if (themedFg) checked++;
      expect(themedFg && literalWhiteBg, selector.trim()).toBe(false);
    }
    expect(checked).toBeGreaterThan(10); // the scan itself must not silently shrink to nothing
  });

  // Proves isNearWhite actually parses channel values rather than matching
  // literal text — it must catch a translucent off-white rgba() the same way
  // it catches "#fff"/"white", and it must NOT flag an unrelated dark or
  // saturated background.
  it("isNearWhite recognises near-white grounds by channel value, not by literal text", () => {
    expect(isNearWhite("rgba(255, 253, 246, 0.93)")).toBe(true); // .cs-cardgate-card's ground
    expect(isNearWhite("rgba(255, 253, 246, 0.3)")).toBe(true); // .cs-bigplay's ground
    expect(isNearWhite("#fefefe")).toBe(true);
    expect(isNearWhite("white")).toBe(true);
    expect(isNearWhite("#fff")).toBe(true);
    expect(isNearWhite("var(--surface)")).toBe(false); // a themed token, not a literal
    expect(isNearWhite("rgba(61, 56, 51, 0.85)")).toBe(false); // the figure's dark ink, not near-white
    expect(isNearWhite("#b5482e")).toBe(false); // the rust accent
  });
});

// Round-2 fix-round-2: .cs-cardgate-card (the flashcard question's card) and
// .cs-cardgate-q (the question text inside it) are separate rules, so the
// single-rule scan above structurally cannot see this pairing — the near-
// white ground is on the parent, the themed ink was on the child. Named here
// explicitly, since a single-rule scan can't see it.
// This card is an overlay on the FIGURE (it sits over .cs-stage so the
// drawing shimmers through), not app chrome — the fix is fixed ink to match
// the figure's own paper, not a themed token, the same call figure-style.ts
// already makes for .cs-title/.cs-caption/.cs-lookup.
describe("the flashcard question card (an overlay on the figure, not chrome)", () => {
  it("keeps its near-white translucent ground — this test would be pointless against a themed one", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const card = /\.cs-cardgate-card\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(isNearWhite(/background(?:-color)?:\s*([^;]+);/i.exec(card)?.[1] ?? "")).toBe(true);
  });

  it("never puts a themed --ink/--muted token on that ground — border or text", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const card = /\.cs-cardgate-card\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(card).not.toMatch(/var\(--(ink|muted)\)/);
  });

  it("gives the question text fixed ink instead of the themed token", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const q = /\.cs-cardgate-q\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(q).not.toMatch(/var\(--(ink|muted)\)/);
    expect(q).toMatch(/color:\s*#[0-9a-fA-F]{3,6}\b/);
  });
});

describe("the figure is not themed", () => {
  it("never reads a chrome token — a dark --ink would put light text on white paper", async () => {
    const src = await readFile(new URL("../src/render/figure-style.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/var\(--ink/);
    expect(src).not.toMatch(/var\(--paper/);
    expect(src).not.toMatch(/var\(--surface/);
    expect(src).not.toMatch(/var\(--muted/);
  });
});
