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

import { readdir, readFile as read2 } from "node:fs/promises";

describe("every dialog goes through the helper", () => {
  it("nothing builds a bare <dialog> outside createModal — that is how\n     Settings lost its scroll cap", async () => {
    // Widened from just main.ts + course.ts to every ui/*.ts (modal.ts
    // excepted — createModal itself is the one legitimate h("dialog", …)):
    // a hand-built dialog in, say, share.ts would have passed the narrower
    // scan silently.
    const uiDir = new URL("../src/ui/", import.meta.url);
    const uiFiles = (await readdir(uiDir)).filter((f) => f.endsWith(".ts") && f !== "modal.ts");
    const targets = ["../src/main.ts", ...uiFiles.map((f) => `../src/ui/${f}`)];
    expect(targets.length).toBeGreaterThan(10); // the scan itself must not silently shrink to nothing
    for (const f of targets) {
      const src = await read2(new URL(f, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/h\(\s*"dialog"/);
    }
  });
});

describe("portrait insertion", () => {
  it("no longer asks for a portrait through a raw browser prompt", async () => {
    // Relaxed from a literal `window.prompt("Portrait` match (the spec's
    // actual rule is broader: no window.prompt( at all in the portrait
    // path) — but scoped to ui/insert.ts, the module that actually IS the
    // portrait path, rather than all of main.ts: main.ts has its own
    // unrelated, legitimate window.prompt() (renaming a saved prompt), and
    // a whole-file scan would either miss a regression hiding behind a
    // different message string or false-positive on that unrelated call.
    // Line comments are stripped first — this very file's own history
    // comments mention "the deleted window.prompt() flow" in prose, which a
    // raw scan would misread as the call itself.
    const src = await read2(new URL("../src/ui/insert.ts", import.meta.url), "utf8");
    const code = src.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/window\.prompt\(/);
  });
});

describe("Open ▾ and Save ▾", () => {
  it("has no icon-only download/upload buttons left in the spec bar", async () => {
    const src = await read2(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/class:\s*"icon-only"[^)]*"⬇"/);
    expect(src).not.toMatch(/class:\s*"icon-only"[^)]*"⬆"/);
  });
});

describe("the images menu", () => {
  it("gathers the image verbs under one menu, and Pin stops hiding in a tooltip", async () => {
    const src = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(src).toMatch(/createMenu\("🖼 Images"/);
    expect(src).not.toMatch(/class:\s*"icon-only[^"]*"[^)]*"📌"/);
  });
});

describe("the format picker", () => {
  it("no longer asks YAML or JSON in the editor bar", async () => {
    const src = await read2(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/formatSel/);
  });
});

describe("the phone", () => {
  it("puts the drawing above the code editor on a narrow screen", async () => {
    const block = /@media\s*\(max-width:\s*940px\)\s*\{([\s\S]*?)\n\}/.exec(await css())?.[1] ?? "";
    expect(block).toMatch(/\.editor-preview\s*\{[^}]*order:\s*-1/);
  });

  it("turns dialogs into bottom sheets, where the footer keeps the primary\n     action on screen", async () => {
    const block = /@media\s*\(max-width:\s*560px\)\s*\{([\s\S]*?)\n\}/g;
    const text = await css();
    const sheets = [...text.matchAll(block)].map((m) => m[1]).join("\n");
    expect(sheets).toMatch(/dialog\s*\{[^}]*max-height:\s*88vh/);
    expect(sheets).toMatch(/margin-bottom:\s*0/);
  });

  it("hides theater mode where it cannot change anything", async () => {
    const text = await css();
    expect(text).toMatch(/max-width:\s*780px[\s\S]{0,400}\.cs-theater[^}]*display:\s*none/);
  });

  // The old "gives the pinned-images button a pin-btn class" test lived here
  // (added in "Sheets, a folded player bar, and the drawing above the fold"):
  // it guarded against a dangling .pin-btn CSS selector with no element using
  // it. That whole mechanism — an icon-only 📌 button whose title= became
  // touch-visible text via .pin-btn::after — is gone now: Pin moved into the
  // 🖼 Images menu above, where its label is real text on every input, so
  // there is no icon-only button left to explain. See "the images menu".
});

// Round-2 fix: refreshCredentialMenus() used to be called from inside
// persist(), the general "a setting changed" hook — so a mode switch, a
// style change, a rating, any of persist()'s 37 call sites, rebuilt the
// Open/Save menus for no reason. Only the two GitHub credential fields
// (repo, token) can ever change which destinations those menus offer.
describe("the credential menu refresh", () => {
  it("is not called from persist() any more", async () => {
    const src = await read2(new URL("../src/main.ts", import.meta.url), "utf8");
    const fn = /function persist\(\):\s*void\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
    expect(fn).not.toBe("");
    expect(fn).not.toMatch(/refreshCredentialMenus\(\)/);
  });

  it("still fires from the repo field's own listener, same as the token field already does", async () => {
    const src = await read2(new URL("../src/main.ts", import.meta.url), "utf8");
    const repoListener = /githubRepoInput\.addEventListener\("change",\s*\(\)\s*=>\s*\{([\s\S]*?)\n\}\);/.exec(src)?.[1] ?? "";
    const tokenListener = /githubTokenInput\.addEventListener\("change",\s*\(\)\s*=>\s*\{([\s\S]*?)\n\}\);/.exec(src)?.[1] ?? "";
    expect(repoListener).not.toBe("");
    expect(tokenListener).not.toBe("");
    expect(repoListener).toMatch(/refreshCredentialMenus\(\)/);
    expect(tokenListener).toMatch(/refreshCredentialMenus\(\)/);
  });
});

// Round-2 fix: main.ts inlined a third copy of fileSafe's exact regex at its
// disk-save call site (a fourth lived in saveToDrive) instead of using either
// of the two named fileSafe() functions already in the codebase (main.ts's
// own, and share.ts's). Now there is one, exported from share.ts.
describe("the filename rule", () => {
  it("main.ts has no inlined copy of the filename-safe regex — it imports fileSafe instead", async () => {
    const src = await read2(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/replace\(\/\[\^\\w\S*æøå/);
    expect(src).toMatch(/import\s*\{[^}]*\bfileSafe\b[^}]*\}\s*from\s*"\.\/ui\/share"/);
  });

  it("share.ts's fileSafe is the only definition left, and it's exported", async () => {
    const src = await read2(new URL("../src/ui/share.ts", import.meta.url), "utf8");
    expect(src).toMatch(/export function fileSafe\(/);
  });
});

// Round-2 fix-round-2: prepareSave() already sets the red status itself on
// refusal (see its own doc comment) — but saveDiskBtn's click handler used to
// close the "Save to disk" dialog only on the success path, after the early
// `if (!save) return`. A refused save left the modal + its backdrop standing
// over .editor-status, so the author saw a button that did nothing and never
// saw why. The dialog must close unconditionally, before that early return.
describe("the Save to disk dialog", () => {
  it("closes before checking whether the save was refused, so the refusal is visible", async () => {
    const src = await read2(new URL("../src/main.ts", import.meta.url), "utf8");
    const listener = /saveDiskBtn\.addEventListener\("click",\s*\(\)\s*=>\s*\{([\s\S]*?)\n\}\);/.exec(src)?.[1] ?? "";
    expect(listener).not.toBe("");
    const closeAt = listener.indexOf("saveDiskModal.dialog.close()");
    const guardAt = listener.indexOf("if (!save) return");
    expect(closeAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    expect(closeAt).toBeLessThan(guardAt);
  });
});

describe("the fullscreen figure", () => {
  it("keeps its own background and padding, whatever pane it lives in", async () => {
    // Comments stripped first, the way tests/fullscreen-frame.test.ts does it:
    // a comment explaining a selector is not that selector.
    const css = (await readFile(new URL("../src/styles.css", import.meta.url), "utf8"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // A "pane rule" is one that reaches .player-figure from an ancestor. It ties
    // with `.player-figure:fullscreen` on specificity — `:fullscreen` is a
    // pseudo-CLASS — and, coming later in the file, wins. A pane rule that
    // strips `background` therefore strips it in fullscreen too, leaving dark
    // ink on the browser's black ::backdrop.
    const paneRules = [...css.matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim())
      .filter((sel) => sel.includes(".player-figure") && !sel.startsWith(".player-figure"));
    expect(paneRules.length).toBeGreaterThan(0);
    for (const sel of paneRules) expect(sel).toContain(":not(:fullscreen)");
  });
});
