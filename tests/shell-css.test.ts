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

describe("the modal size scale", () => {
  it("names three sizes and no per-modal override survives", async () => {
    const text = await css();
    expect(text).toMatch(/\.modal-s\s*\{[^}]*max-width:\s*30rem/);
    expect(text).toMatch(/\.modal-m\s*\{[^}]*max-width:\s*46rem/);
    expect(text).toMatch(/\.modal-l\s*\{[^}]*max-width:\s*min\(104rem,\s*96vw\)/);
    expect(text).not.toMatch(/\.wide-dialog/);
    expect(text).not.toMatch(/\.course-modal\s*\{[^}]*max-width/);
    // .modal-m already caps this dialog at 46rem (736px) — any width/max-width
    // of its own would either be silently overridden (dead CSS that lies about
    // the dialog's actual rendered width) or, if narrower than 736px, would
    // reintroduce a per-modal override the size scale is meant to replace.
    expect(text).not.toMatch(/\.author-dialog\s*\{[^}]*width/);
    // Same story for .modal-s (30rem/480px): .sub-dialog's own 520px width was
    // always ≥ that cap, so it could never once have taken effect.
    expect(text).not.toMatch(/\.sub-dialog\s*\{[^}]*width/);
  });

  it("gives every modal a footer row for its actions", async () => {
    expect(await css()).toMatch(/\.dialog-footer\s*\{/);
  });

  it("still scrolls the body instead of clipping it — a max-height alone doesn't scroll", async () => {
    expect(await css()).toMatch(/\.dialog-body\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("caps the bare dialog rule, so a dialog that names no size class isn't full-bleed", async () => {
    // A dialog with no .modal-s/m/l class (Settings, YouTube upload — until a
    // later task converts them) falls through to this rule alone. It has to
    // carry its own cap rather than relying on a size class that might not
    // be there.
    const text = await css();
    const rule = /\ndialog\s*\{([^}]*)\}/.exec(text)?.[1] ?? "";
    expect(rule).toMatch(/max-width:\s*30rem/);
  });
});

import { readFile as read2 } from "node:fs/promises";

describe("every dialog goes through the helper", () => {
  it("nothing builds a bare <dialog> outside createModal — that is how\n     Settings lost its scroll cap", async () => {
    for (const f of ["../src/main.ts", "../src/ui/course.ts"]) {
      const src = await read2(new URL(f, import.meta.url), "utf8");
      expect(src).not.toMatch(/h\(\s*"dialog"/);
    }
  });
});

describe("portrait insertion", () => {
  it("no longer asks for a portrait through a raw browser prompt", async () => {
    const src = await read2(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/window\.prompt\("Portrait/);
  });
});
