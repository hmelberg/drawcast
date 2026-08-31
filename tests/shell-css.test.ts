import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const css = async () => readFile(new URL("../src/styles.css", import.meta.url), "utf8");

describe("one control size per bar", () => {
  it("defines the bar height and tap minimum as tokens", async () => {
    const root = /:root\s*\{([^}]*)\}/.exec(await css())?.[1] ?? "";
    expect(root).toMatch(/--bar-h:/);
    expect(root).toMatch(/--tap:\s*44px/);
  });

  it("has no icon-only size exception inside a pane bar", async () => {
    expect(await css()).not.toMatch(/\.pane-bar\s+\.icon-only\s*\{[^}]*font-size/);
  });
});

describe("the touch tier", () => {
  it("raises every bar control to the tap minimum when there is no hover", async () => {
    const text = await css();
    const block = /@media\s*\(hover:\s*none\)\s*\{([\s\S]*?)\n\}/.exec(text)?.[1] ?? "";
    for (const sel of [".pane-bar button", ".cs-bar-btn", ".sidebar-row", ".mode-btn", ".dialog-x"]) {
      expect(block).toContain(sel);
    }
    expect(block).toMatch(/min-height:\s*var\(--tap\)/);
  });

  it("has exactly one touch block — the old rule is absorbed, not duplicated", async () => {
    const hits = (await css()).match(/@media\s*\(hover:\s*none\)/g) ?? [];
    expect(hits.length).toBe(1);
  });

  it("grows the seek bar on touch, where :hover never fires", async () => {
    const block = /@media\s*\(hover:\s*none\)\s*\{([\s\S]*?)\n\}/.exec(await css())?.[1] ?? "";
    // The visible track must stay 12px, but the box must actually grow past
    // that (padding) — a test that only checked height would also pass
    // against a version where the hit area is clipped away to nothing. And
    // box-sizing: content-box has to hold, or the global border-box default
    // turns "height: 12px" back into the *total* box and the 32px of padding
    // eats the content box instead of adding to it — same silent collapse.
    expect(block).toMatch(/\.cs-progress\s*\{[^}]*box-sizing:\s*content-box/);
    expect(block).toMatch(/\.cs-progress\s*\{[^}]*height:\s*12px/);
    expect(block).toMatch(/\.cs-progress\s*\{[^}]*padding:\s*16px 0/);
  });
});
