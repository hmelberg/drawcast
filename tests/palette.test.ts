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

describe("the type scale", () => {
  // The brief's closing sentence for this step names the guard list as
  // "0.9/0.92/0.82/0.78/0.75" — omitting 0.85rem, even though the step's own
  // instruction two sentences earlier replaces 0.85rem along with the rest.
  // Leaving 0.85 out of the guard would let it silently regress, defeating
  // the point of the assertion, so it is included here too. Bare "0.9" is
  // deliberately NOT in this list: the brief only collapses the *course
  // textarea's* 0.9rem, not the other pre-existing 0.9rem uses elsewhere
  // (.model3d-container, .rv-title, .sub-status, .cs-menu) — those are
  // outside the six sizes this task names and are left alone below.
  it("leaves no font-size using one of the collapsed sizes", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/font-size:\s*0\.(92|85|82|78|75)rem/);
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
