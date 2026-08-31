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

// The task-1 brief's original version of this assertion checked that every
// var(--rust) use in styles.css sits inside a button.primary selector — i.e.
// that the accent has exactly one job left. That claim is false of the file
// as it stands: styles.css has grown roughly two dozen other var(--rust)
// uses (.tab-btn.active, .library-open.current, .sidebar-new, the
// .spec-json.streaming indicator, .cs-bar-btn:hover, the playlist dots,
// .share-dest, the infocard links, the explore tray, …) that the brief's
// "five other uses" list does not name — and the brief explicitly scopes
// this task to touch only those five ("change ONLY … the five accent uses
// named … do not go hunting for other colours"). Asserting the global claim
// here would be false; weakening it to enumerate ~24 exceptions is exactly
// the "pass against scattered uses" the brief warns against avoiding. So
// this checks precisely what Task 1 guarantees instead: the four sites the
// brief names no longer spend the accent, and button.primary still does.
// See the task-1 report for the full list of out-of-scope sites found.
describe("the accent — one job (scoped to this task's four sites)", () => {
  it("moves mode-btn.active, choices-toggle.has-choice, library-open:hover and cs-progress-fill off the accent", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(/\.mode-btn\.active\s*\{[^}]*\}/.exec(css)?.[0]).not.toMatch(/var\(--rust\)/);
    expect(/\.choices-toggle\.has-choice\s*\{[^}]*\}/.exec(css)?.[0]).not.toMatch(/var\(--rust\)/);
    expect(/\.library-open:hover\s*\{[^}]*\}/.exec(css)?.[0]).not.toMatch(/var\(--rust\)/);
    expect(/\.cs-progress-fill\s*\{[^}]*height:\s*100%[^}]*\}/.exec(css)?.[0]).not.toMatch(/var\(--rust\)/);
  });

  it("keeps the accent on button.primary", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(/button\.primary\s*\{[^}]*\}/.exec(css)?.[0]).toMatch(/var\(--rust\)/);
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
