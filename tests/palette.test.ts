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

describe("the accent — an explicit allowlist", () => {
  it("spends var(--rust) only on the permitted selectors", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const uses = [...css.matchAll(/([^{}]+)\{([^}]*var\(--rust\)[^}]*)\}/g)].map((m) => m[1].trim());
    for (const sel of uses) {
      expect(RUST_ALLOWED_SELECTORS.some((allowed) => sel.includes(allowed)), sel).toBe(true);
    }
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
