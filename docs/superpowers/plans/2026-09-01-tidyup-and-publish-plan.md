# Tidy-up + Publish (Parts 1 & 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement roadmap Parts 1 and 3 — the mechanical tidy-up (A1–A5, A7, A8, C5, C6) and the publish round (A4, B1, B2, B3, B9, B10) — per `ROADMAP-2026-09.md`, its §F.3 rulings, and the review's amendments.

**Architecture:** Pure decision logic goes in testable modules (`src/ui/*.ts`, `src/publish/*.ts`); `src/main.ts` does only DOM wiring and is pinned by source-text drift tests in `tests/`. All work lands on `main`, one commit per task, pushed after each task.

**Tech Stack:** TypeScript, Vite, vitest with `environment: "node"` (NO DOM — `h()` at module scope crashes test imports), js-yaml, h()-helper UI.

**Spec:** `docs/superpowers/ROADMAP-2026-09.md` (items + §F.3 rulings), `docs/superpowers/specs/2026-09-01-publish-design.md` [P], `docs/superpowers/specs/2026-09-01-style-and-vocabulary-design.md` [S], `docs/superpowers/2026-09-01-roadmap-review.md` (amendments: errors-only lint chip; References tab hidden with A8; count-only embed label; all-SVG icons deferred to player part; A6 deferred to player part).

## Global Constraints

- Tests: `npm test` (vitest, node env, no DOM). Typecheck: `npx tsc --noEmit`. Both must be green at every commit. Baseline: 2682 tests / 162 files green.
- NEVER put an `h()` call at module scope in `src/ui/*.ts` — build lazily inside a `build()` singleton (see `src/ui/insert.ts:7-11`).
- `createModal(...)` requires an explicit `app.appendChild(modal.dialog)` / `document.body.append(modal.dialog)` — `tests/shell-css.test.ts:251-276` enforces it.
- Menus bake `hidden` at construction (`src/ui/menu.ts:29-36`); anything dynamic uses the host-span + `replaceChildren(build…())` pattern (`main.ts:782-797`). A one-visible-item menu renders as a plain button (`soloLabel`, menu.ts:33-37).
- No backwards compatibility anywhere: replace or delete, never freeze. No migration code.
- User-facing copy drops the words "pin" and "bake" (P §3.7); spec field names `strokes`/`audio` stay.
- Ruling (§F.3.1): Save writes the document verbatim; embed checkboxes appear ONLY on Publish (GitHub + courses). Save → Drive and Save → GitHub stay one click.
- Existing drift tests that read `main.ts`/`share.ts` source are listed in each task; they must be updated in the same commit as the change they pin, never deleted wholesale.
- Commit messages: conventional (`feat:`/`refactor:`/`test:`), each ending with the two standard trailers (Co-Authored-By Claude + Claude-Session URL) used by this session's earlier commits.
- Append every judgment call made during implementation to `docs/superpowers/plans/2026-09-01-tidyup-publish-ledger.md` (create it in Task 1) as a dated bullet: what was decided, why.

---

### Task 1: A3 — `fileSafe` gains a word-boundary length cap

**Files:**
- Modify: `src/ui/share.ts:141-151` (`fileSafe`)
- Test: `tests/file-safe.test.ts` (new)
- Create: `docs/superpowers/plans/2026-09-01-tidyup-publish-ledger.md` (empty ledger with a title line)

**Interfaces:**
- Produces: `fileSafe(name: string, fallback = "drawcast"): string` — same signature, output now capped at 40 chars, cut at a word boundary (space), trailing spaces trimmed. Keeps spaces and the `æøå` character class (a disk file stays readable — NOT a slug).

**Current code** (`share.ts:149-151`):
```ts
export function fileSafe(name: string, fallback = "drawcast"): string {
  return name.replace(/[^\wæøå -]+/gi, "").trim() || fallback;
}
```

- [ ] **Step 1: Write the failing test** — `tests/file-safe.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fileSafe } from "../src/ui/share";

describe("fileSafe", () => {
  it("keeps spaces and Norwegian characters — a filename, not a slug", () => {
    expect(fileSafe("Årsak og effekt")).toBe("Årsak og effekt");
  });
  it("strips illegal characters and falls back when nothing survives", () => {
    expect(fileSafe("???")).toBe("drawcast");
    expect(fileSafe("???", "prompt")).toBe("prompt");
  });
  it("caps at 40 characters, cut at a word boundary (P §8.1)", () => {
    const long = "Ricardo on trade and comparative advantage in the nineteenth century";
    const out = fileSafe(long);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).toBe("Ricardo on trade and comparative");
    expect(out).not.toMatch(/ $/);
  });
  it("hard-cuts a single 80-char word rather than returning it whole", () => {
    expect(fileSafe("a".repeat(80)).length).toBe(40);
  });
  it("leaves short titles untouched", () => {
    expect(fileSafe("Supply and demand")).toBe("Supply and demand");
  });
});
```
- [ ] **Step 2: Run:** `npx vitest run tests/file-safe.test.ts` — expect the cap tests to FAIL (function returns full string).
- [ ] **Step 3: Implement** — mirror `slugify`'s boundary logic (`src/publish/github.ts:115-129`) with space as the boundary:
```ts
export function fileSafe(name: string, fallback = "drawcast"): string {
  const MAX = 40;
  let safe = name.replace(/[^\wæøå -]+/gi, "").trim();
  if (safe.length > MAX) {
    const cut = safe.slice(0, MAX + 1);
    const boundary = cut.lastIndexOf(" ");
    safe = (boundary > MAX / 2 ? cut.slice(0, boundary) : safe.slice(0, MAX)).trim();
  }
  return safe || fallback;
}
```
Update the function's doc comment: add one line "Capped at 40 characters, cut at a word boundary — the fix for 'the name is a bit long' (P §8.1)."
- [ ] **Step 4: Run** `npx vitest run tests/file-safe.test.ts` → PASS, then `npm test` (the shell-css single-definition guard at `tests/shell-css.test.ts:196-210` must stay green) and `npx tsc --noEmit`.
- [ ] **Step 5:** Create the ledger file with the header `# Ledger — tidy-up + publish round, started 2026-09-01`. Commit: `feat: cap fileSafe at a word boundary (A3)`.

---

### Task 2: A7 — lint chip shows only errors to non-developers

**Files:**
- Create: `src/ui/lint-chip.ts` (pure decision module)
- Modify: `src/main.ts:2231-2260` (`setLint`)
- Test: `tests/lint-chip.test.ts` (new)

**Interfaces:**
- Produces: in `src/ui/lint-chip.ts`:
```ts
export interface LintIssueLike { rule: string; message: string; severity: "warn" | "error" }
export interface LintChipModel {
  hidden: boolean;
  className: string;            // "lint-chip clean" | "lint-chip warn" | "lint-chip error"
  text: string;                 // "✓ Lint clean" | `⚠ ${n}`
  title: string;
  items: { text: string; className: string }[];  // what the expanded list shows
}
export function lintChipModel(issues: LintIssueLike[], warnings: string[], developerMode: boolean): LintChipModel
```
- Consumes: nothing new. `main.ts` `setLint` becomes a thin renderer of the model.

**Rules (review verdict on F.1(3) — D2 option 2):**
- `developerMode: true` → exactly today's behaviour: clean chip shown ("✓ Lint clean"), any issue/warning shows `⚠ total` with the full list; `className` worst-severity.
- `developerMode: false` → chip visible ONLY when at least one `severity === "error"` issue exists (today: only `out-of-canvas`, `src/lint/lint.ts:112`). Then `text` counts errors only, `items` lists errors only, `className` is `"lint-chip error"`. Clean or warn-only → `hidden: true`.

- [ ] **Step 1: Write the failing tests** — `tests/lint-chip.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { lintChipModel, type LintIssueLike } from "../src/ui/lint-chip";

const warn = (rule = "label-overlap"): LintIssueLike => ({ rule, message: "m", severity: "warn" });
const error = (): LintIssueLike => ({ rule: "out-of-canvas", message: "m", severity: "error" });

describe("lintChipModel — non-developer (D2 option 2: errors only)", () => {
  it("hides the chip when there are only warnings — compiler-quality noise the author cannot act on", () => {
    expect(lintChipModel([warn(), warn()], ["planner note"], false).hidden).toBe(true);
  });
  it("hides the clean chip", () => {
    expect(lintChipModel([], [], false).hidden).toBe(true);
  });
  it("shows errors, counting and listing errors alone", () => {
    const m = lintChipModel([warn(), error()], ["w"], false);
    expect(m.hidden).toBe(false);
    expect(m.text).toBe("⚠ 1");
    expect(m.className).toBe("lint-chip error");
    expect(m.items).toHaveLength(1);
    expect(m.items[0].className).toBe("error");
  });
});

describe("lintChipModel — developer mode (unchanged behaviour)", () => {
  it("reports clean as information", () => {
    const m = lintChipModel([], [], true);
    expect(m.hidden).toBe(false);
    expect(m.text).toBe("✓ Lint clean");
    expect(m.className).toBe("lint-chip clean");
  });
  it("shows the full count and list, worst severity wins", () => {
    const m = lintChipModel([warn(), error()], ["planner note"], true);
    expect(m.text).toBe("⚠ 3");
    expect(m.className).toBe("lint-chip error");
    expect(m.items).toHaveLength(3);
  });
  it("warn-only shows amber", () => {
    expect(lintChipModel([warn()], [], true).className).toBe("lint-chip warn");
  });
});
```
- [ ] **Step 2: Run** `npx vitest run tests/lint-chip.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/ui/lint-chip.ts` (pure — no `h()`, no imports from main):
```ts
// Decides what the lint chip shows. Non-developers see only error-severity
// issues (a genuinely broken layout, e.g. out-of-canvas); warn-severity lint
// is renderer-quality signal the author cannot fix by editing YAML, so it is
// developer-only. Ruling: review of ROADMAP-2026-09 §F.1(3) → D2 option 2.
export interface LintIssueLike { rule: string; message: string; severity: "warn" | "error" }
export interface LintChipModel { hidden: boolean; className: string; text: string; title: string; items: { text: string; className: string }[] }

export function lintChipModel(issues: LintIssueLike[], warnings: string[], developerMode: boolean): LintChipModel {
  const errors = issues.filter((i) => i.severity === "error");
  if (!developerMode) {
    if (errors.length === 0) return { hidden: true, className: "lint-chip clean", text: "", title: "", items: [] };
    return {
      hidden: false,
      className: "lint-chip error",
      text: `⚠ ${errors.length}`,
      title: `${errors.length} layout ${errors.length === 1 ? "error" : "errors"} — click for details`,
      items: errors.map((i) => ({ text: `${i.rule}: ${i.message}`, className: i.severity })),
    };
  }
  const total = issues.length + warnings.length;
  if (total === 0) return { hidden: false, className: "lint-chip clean", text: "✓ Lint clean", title: "Layout warnings — click for details", items: [] };
  const worst = errors.length > 0 ? "error" : "warn";
  return {
    hidden: false,
    className: `lint-chip ${worst}`,
    text: `⚠ ${total}`,
    title: `${total} layout ${total === 1 ? "warning" : "warnings"} — click for details`,
    items: [...issues.map((i) => ({ text: `${i.rule}: ${i.message}`, className: i.severity })), ...warnings.map((w) => ({ text: w, className: "" }))],
  };
}
```
- [ ] **Step 4: Rewire** `main.ts` `setLint` (2236-2260) to render the model — keep `lastHandle`, `lintBox` open/close state:
```ts
function setLint(hd: RenderHandle): void {
  lastHandle = hd;
  lintBox.replaceChildren();
  const m = lintChipModel(hd.layout.issues, [...hd.layout.warnings, ...hd.plan.warnings], settings.developerMode);
  lintChip.hidden = m.hidden;
  lintChip.className = m.className;
  lintChip.textContent = m.text;
  lintChip.title = m.title;
  if (m.hidden || m.items.length === 0) { lintBox.hidden = true; lintOpen = false; return; }
  const ul = h("ul", { class: "lint-list" });
  for (const i of m.items) ul.appendChild(h("li", i.className ? { class: i.className } : {}, i.text));
  lintBox.appendChild(ul);
  lintBox.hidden = !lintOpen;
}
```
Import `lintChipModel` at the top of main.ts. Update the function's doc comment (2231-2235) to describe the errors-only rule. Update the Developer-mode settings label at `main.ts:1432-1439` from "show the 1–5 rating, the full lint list and the Data panel" to "show the 1–5 rating, all lint warnings and the Data panel".
- [ ] **Step 5: Run** `npm test` + `npx tsc --noEmit` → green. Commit: `feat: lint chip shows only error-severity issues to non-developers (A7)`.

---

### Task 3: A8 — "👍 Learn from this" and the References tab behind developerMode

**Files:**
- Modify: `src/main.ts:1480-1493` (`applyDeveloperMode`), `main.ts:1165-1231` (Instructions modal / tabs), possibly `src/ui/tabs.ts` (read it first — the tabs API is unexplored)
- Test: extend `tests/shell-css.test.ts` (new describe) or a new `tests/developer-gates.test.ts`

**Interfaces:**
- Consumes: `applyDeveloperMode()` already toggles `ratingBox.hidden`, `dataRow.hidden`, `body.dev-mode` (main.ts:1481-1486).
- Produces: `promoteBtn.hidden = !on` inside `applyDeveloperMode`; the References tab visible only in developer mode. Machinery (exemplar store, `pickExemplars`, `{{EXEMPLARS}}`) is untouched — S §6.

- [ ] **Step 1: Read `src/ui/tabs.ts`** to learn `createTabs`' return shape (the explorer saw `instructionsTabs.el` and `.show(id)`). Decide the mechanism: preferred — a `hidden` toggle on the References tab's button element if `createTabs` exposes buttons; fallback — a CSS rule keyed on the already-toggled `body.dev-mode` class hiding the tab button (find the tab button's class in tabs.ts and add a `styles.css` rule `body:not(.dev-mode) <tab-btn-selector>[…references…] { display: none; }` — grep the class before trusting the selector, per this repo's dead-selector rule). If neither is clean, extend `createTabs` with a `setHidden(id, hidden)` method. Record the choice in the ledger.
- [ ] **Step 2: Write the failing drift test** — `tests/developer-gates.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

describe("developerMode gates (S §6 + review amendment)", () => {
  it("applyDeveloperMode hides the promote button for normal users", () => {
    const fn = /function applyDeveloperMode\(\):\s*void\s*\{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
    expect(fn).not.toBe("");
    expect(fn).toMatch(/promoteBtn\.hidden = !on/);
  });
  it("the References tab is gated with the same flag", () => {
    const fn = /function applyDeveloperMode\(\):\s*void\s*\{([\s\S]*?)\n\}/.exec(main)?.[1] ?? "";
    expect(fn).toMatch(/[Rr]eferences/);
  });
});
```
(Adjust the second assertion to whatever mechanism Step 1 chose — it must assert the gate lives in `applyDeveloperMode` so toggling the setting takes effect without a reload. If the CSS route is taken, assert the `styles.css` rule exists AND the tab button class it names exists in `tabs.ts`.)
- [ ] **Step 3: Run** the new test → FAIL.
- [ ] **Step 4: Implement.** In `applyDeveloperMode`: `promoteBtn.hidden = !on;` plus the References-tab toggle; if the References tab is active when the flag turns off, call `instructionsTabs.show("instructions")`. Note `setDoc` (main.ts:2171) and the click handler (2854-2862) touch `promoteBtn.textContent`/`disabled` but never `hidden` — no conflict.
- [ ] **Step 5: Run** `npm test` + `npx tsc --noEmit` → green. Manual check is impossible headless; the drift test is the gate. Commit: `feat: gate Learn-from-this and the References tab behind developerMode (A8)`.

---

### Task 4: A5 — Player/Editor pill out of the topbar, "▶ Player" row in the sidebar

**Files:**
- Modify: `src/main.ts` (topbar construction — grep `mode-btn` to find the pill; sidebar tools div at 1060-1082), `src/styles.css` (remove dead pill CSS)
- Test: update `tests/palette.test.ts:278-284` (`.mode-btn.active` shape) and `tests/shell-css.test.ts:22` (`.mode-btn` in the hover:none block); add a drift test for the sidebar row

**Interfaces:**
- Consumes: `showMode("player")` — hoisted function at `main.ts:2276`; player mode's own `✎ Edit` escape is `switchBtn` via `trailing: isPlayer ? [switchBtn] : []` (main.ts:2009) — VERIFY switchBtn does not use class `mode-btn` before deleting the class' CSS (grep first).
- Produces: the topbar holds the wordmark alone (S §7.3); a `▶ Player` button row at the TOP of `.sidebar-tools` (before "📝 Instructions").

- [ ] **Step 1: Grep** `mode-btn` across `src/` and `tests/` — list every hit. Confirm the pill's construction site and that the player's Edit button (`switchBtn`) doesn't share the class.
- [ ] **Step 2: Write the failing drift test** (append to `tests/developer-gates.test.ts` or new `tests/sidebar-player-row.test.ts`):
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("the Player/Editor pill is gone (A5, S §7.3)", () => {
  it("main.ts no longer builds mode-btn buttons", () => {
    expect(main).not.toMatch(/class:\s*"mode-btn/);
  });
  it("a ▶ Player sidebar row opens player mode", () => {
    expect(main).toMatch(/sidebar-row[^)]*▶ Player/);
  });
  it("the dead pill CSS is deleted", () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\.mode-btn/);
  });
});
```
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement:** delete the pill from the topbar; add to `.sidebar-tools` (main.ts:1060, FIRST child) the row:
```ts
(() => {
  const b = h("button", { class: "sidebar-row" }, "▶ Player");
  b.addEventListener("click", () => showMode("player"));
  return b;
})(),
```
Delete `.mode-btn` CSS rules; update `tests/palette.test.ts:278-284` (delete that assertion block or repoint it) and `tests/shell-css.test.ts:22` (drop `.mode-btn` from the hover:none selector list). Grep for any other pill references (e.g. a `showMode` call from the deleted buttons).
- [ ] **Step 5:** `npm test` + `npx tsc --noEmit` → green. Commit: `feat: replace the Player/Editor pill with a sidebar Player row (A5)`.

---

### Task 5: A1 + A2 + A4 — bar order, Publish moves above the picture, Share→Publish rename

**Files:**
- Modify: `src/main.ts` (spec-bar and preview-bar construction ~1000-1045; `shareBtn` at 806), `src/ui/share.ts:554` (modal title), `share.ts:100-104` (DESTS label)
- Test: update `tests/share-destinations.test.ts` (label assertions if any), add drift tests

**Interfaces:**
- Consumes: `shareBtn` (main.ts:806), preview-bar children (lint chip, `✎ Review`, export chip), spec-bar groups (`YAML▾ ↻ │ Open ▾ Save ▾ │ Insert ▾` target order — S §7.1; `.bar-group + .bar-group` divider is automatic, styles.css:481-486).
- Produces: `↗ Publish` button in the PREVIEW bar immediately after `✎ Review`; spec bar order `YAML▾ ↻ │ Open ▾ Save ▾ │ Insert ▾`; modal title `↗ Publish`; DESTS link label `Publish to GitHub`.

- [ ] **Step 1: Read** `main.ts:1000-1045` — both bar constructions. Note which children sit in which `bar-group` and where `shareBtn` and the `pane-spacer` are.
- [ ] **Step 2: Write failing drift tests** (new `tests/publish-placement.test.ts`):
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");

describe("Publish placement and naming (A1, A2, A4)", () => {
  it("the button says Publish, not Share", () => {
    expect(main).toMatch(/"↗ Publish"/);
    expect(main).not.toMatch(/"↗ Share"/);
  });
  it("the modal is titled Publish", () => {
    expect(share).toMatch(/createModal\("↗ Publish"/);
  });
  it("the GitHub destination is named for what it does", () => {
    expect(share).toMatch(/label: "Publish to GitHub"/);
    expect(share).not.toMatch(/label: "Link"/);
  });
  it("Publish is built in the preview bar, directly after Review (P §6)", () => {
    // Both must be children of the same h(...) call, Review before Publish.
    const bar = /h\("div",\s*\{\s*class:\s*"pane-bar"[^]*?\)/g;
    const bars = main.match(bar) ?? [];
    const withBoth = bars.find((b) => b.includes("reviewBtn") && b.includes("shareBtn"));
    expect(withBoth).toBeTruthy();
    expect(withBoth!.indexOf("reviewBtn")).toBeLessThan(withBoth!.indexOf("shareBtn"));
  });
  it("the spec bar groups Insert after Open/Save (S §7.1)", () => {
    const openIdx = main.indexOf("openMenuHost");
    const insertIdx = main.indexOf("insertMenu", openIdx);
    expect(openIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(openIdx);
  });
});
```
Adjust the structural regexes to the real bar markup found in Step 1 — the assertions' *intent* is fixed (Review precedes Publish in the same preview bar; Insert's group follows Open/Save's group), the regex is whatever reliably matches the real code. Guard every extraction with `expect(x).toBeTruthy()` so a scan can't silently match nothing.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement:**
  - Move the `insertMenu` (+ `importInput` stays with its current group logic — check what else lives in Insert's group) so the spec bar reads `YAML▾ ↻ │ Open ▾ Save ▾ │ Insert ▾`.
  - Move `shareBtn` from the spec bar into the preview bar directly after `✎ Review`; rename its text to `↗ Publish` and title to `"Publish to GitHub, upload to YouTube, or export a video"`.
  - `share.ts:554` title → `"↗ Publish"`; DESTS `label: "Link"` → `label: "Publish to GitHub"` (id stays `"link"` — `settings.shareTo` and `migrateShareTo` untouched).
  - P §2's consequence check: the preview bar is the one that folds on a phone, and the spec bar's dividers assumed three groups — re-read the relevant CSS (`styles.css` bar-group rules, any `@media (max-width: 940px)` bar rules from `tests/shell-css.test.ts:146`) and fix anything that assumed the old membership. Run the existing shell-css tests to catch it.
  - Grep `"Share"` across `src/` for stray user-facing copy (status lines, titles) and update to Publish where it names this modal/button; leave unrelated uses.
- [ ] **Step 5:** `npm test` + `npx tsc --noEmit` → green (update `tests/share-destinations.test.ts` if it pins the old label; `tests/shell-css.test.ts` bar assertions may need the new home). Commit: `feat: Share becomes Publish and moves to the preview bar; Insert follows Open/Save (A1, A2, A4)`.

---

### Task 6: C6 — `Insert → Image…` reduced to disk import only

**Files:**
- Modify: `src/ui/insert.ts` (dialog fields 109-163, submit paths 188-247, open() reset 250-268), `src/main.ts:657-667` (menu label)
- Test: update `tests/portrait-insert.test.ts` (whatever pins the removed paths); the pure `portraitInsert` and its `PortraitSource` union STAY unchanged (YAML still expresses `of:`/`url:`; only the dialog narrows)

**Interfaces:**
- Consumes: `traceFromBlob(blob): Promise<string>` (`src/render/portrait.ts:155`).
- Produces: dialog titled `Insert image from disk` with ONE source path (file input, no radios), keeping Part/Place/After-step controls; menu item label `Image from disk…`.

- [ ] **Step 1:** Read `tests/portrait-insert.test.ts` in full; note which tests exercise name/url modes via the pure `portraitInsert` (keep those — the pure function is unchanged) vs. any drift test on the dialog markup (update those).
- [ ] **Step 2: Write the failing drift test** (append to `tests/portrait-insert.test.ts`):
```ts
it("the dialog offers only the disk path — name/url ride in YAML (C6, P §4)", async () => {
  const src = (await import("node:fs/promises").then((m) => m.readFile(new URL("../src/ui/insert.ts", import.meta.url), "utf8")));
  expect(src).not.toMatch(/portrait-source/);        // the radio group is gone
  expect(src).not.toMatch(/A person's name/);
  expect(src).toMatch(/type: "file", accept: "image\/\*"/);
});
```
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement:** in `build()`: delete `nameRadio`/`urlRadio`/`fileRadio`, `nameInput`, `urlInput`, `sourceMode`, `syncSourceMode`; `fileInput` loses `hidden`; modal title `"Insert image from disk"`; the submit handler keeps ONLY the `mode === "file"` branch (insert.ts:206-222) — delete the probe/`resolvePortraits` branch (224-247) and the now-unused imports; `open()` reset drops the radio/name/url lines. In `main.ts:659` label → `"Image from disk…"`. Keep `PortraitSource`/`portraitInsert` exports untouched.
- [ ] **Step 5:** `npm test` + `npx tsc --noEmit` → green. Commit: `feat: Insert image is disk-import only (C6)`.

---

### Task 7: C5 — delete the `halftone`/`poster`/`line` looks

**Files:**
- Modify: `src/spec/schema.ts:177-181` (delete the `look` property), `src/spec/types.ts:117-118` (delete `look` from `SpecElement`), `src/render/portrait.ts` (LOOK_DIM 78-83, `PortraitLook` 117, `traceFromUrl` 119-124, resolver call 200, `portraitCacheKey` 22-26, `TRACE_VERSION` 14), `src/render/tracer.ts` (generation branches — see Step 1)
- Test: `tests/portrait-trace.test.ts` (poster/halftone describes), `tests/portrait-element.test.ts:73,118-119`

**Rules:** measured 0 of 114 bundled specs use `look`; replace-or-delete is the standing rule. The `t2:` DECODE/render path in `src/layout/tier2.ts` STAYS — it renders any already-encoded strokes; only look *generation* dies.

- [ ] **Step 1: Grep** `traceImage|traceHalftone|tracePoster|traceLines|PortraitLook|LOOK_DIM|"halftone"|"poster"|\blook\b` across `src/` and `tests/`. Build the exact deletion list. Determine whether `tracer.ts`'s generation half has ANY caller besides `traceFromUrl`'s non-photo branch (`src/render/source.ts` uses only `LOOK_DIM.page`). If `traceImage`+`traceHalftone`+`tracePoster`+`traceLines`+`TraceOpts` become caller-free, delete them (and their tests); `encodeTrace`/`decodeTrace` stay if the decode path or `traceFromBlob` chain still needs them — check before cutting.
- [ ] **Step 2: Write the failing drift test** (new `tests/looks-deleted.test.ts`):
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../src/spec/schema.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/spec/types.ts", import.meta.url), "utf8");

describe("the look variants are gone (C5, P §5)", () => {
  it("the schema no longer advertises look to the model", () => {
    expect(schema).not.toMatch(/halftone/);
    expect(schema).not.toMatch(/\blook:/);
  });
  it("SpecElement has no look field", () => {
    expect(types).not.toMatch(/look\?:/);
  });
});
```
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement the deletion list**, then:
  - `LOOK_DIM` shrinks to `{ photo: 240, page: 640 }` (keep the export — `source.ts` reads `.page`); simplify `traceFromUrl(url)` to the photo path only (drop the `look` parameter); `portraitCacheKey` drops the look component; **bump `TRACE_VERSION` to 6** (`portrait.ts:14`) with a comment `// v6: single photo look` so stale cached traces are discarded.
  - Delete the corresponding describes in `tests/portrait-trace.test.ts` / cache-key-per-look assertions in `tests/portrait-element.test.ts`; keep photo-path tests.
  - Update prose: `tracer.ts` header comment if the file shrinks; note in the ledger that `STYLE.md:109` and the source-element spec still mention looks historically (docs stay — they are records).
- [ ] **Step 5:** `npm test` + `npx tsc --noEmit` → green (tsc is the real net here — it finds every survivor referencing a deleted symbol). Commit: `feat: delete the unused halftone/poster/line looks (C5)`. **Push all Part-1 commits now** (`git push`, verify with `git ls-remote`).

---

### Task 8: B1 — Publish destinations the author *can* enable show disabled, with the reason

**Files:**
- Modify: `src/ui/share.ts` (DESTS 100-104, `shareDestinations` 111-115, `currentCaps` 132-139, rail construction in `refresh()` ~605-625, `selectDestination` 561)
- Test: `tests/share-destinations.test.ts` (extend)

**Interfaces:**
- Produces (replaces `shareDestinations`' return shape — update BOTH callers: `share.ts:607` and any test):
```ts
export interface DestOffer { id: ShareTo; label: string; action: string; enabled: boolean; reason?: string }
export function destinationOffers(caps: ShareCaps, subject: "drawcast" | "course"): DestOffer[]
```
**Rules (P §0.1):** a credential the author can supply in Settings → offered disabled with reason + route; a credential they cannot supply (environment) → hidden.
- `link` (needs `github` — a Settings value): always offered; disabled with reason `"Set a repository and token in Settings"` when `!caps.github`.
- `video` (needs `tts` — a Settings key): always offered; disabled with reason `"Add a Google TTS key in Settings"` when `!caps.tts`.
- `youtube` (needs `google` env config AND `tts`): hidden when `!caps.google` (env — cannot be supplied); offered when `caps.google`, disabled with the TTS reason when `!caps.tts`.
- Courses: same filtering as today (`link` only), then the same enable/disable logic.

- [ ] **Step 1: Write the failing tests** (extend `tests/share-destinations.test.ts`; keep the existing `shareDestinations` describes only if the function survives as `destinationOffers(...).filter(o => o.enabled)` — otherwise port them):
```ts
describe("destinationOffers — the §0.1 third state", () => {
  it("offers GitHub publishing disabled with a route when the repo is missing", () => {
    const offers = destinationOffers({ github: false, google: true, tts: true }, "drawcast");
    const link = offers.find((o) => o.id === "link")!;
    expect(link.enabled).toBe(false);
    expect(link.reason).toMatch(/Settings/);
  });
  it("hides YouTube entirely when Google is not configured — an env credential does not advertise itself", () => {
    const offers = destinationOffers({ github: true, google: false, tts: true }, "drawcast");
    expect(offers.map((o) => o.id)).not.toContain("youtube");
  });
  it("offers YouTube disabled when only the TTS key is missing", () => {
    const offers = destinationOffers({ github: true, google: true, tts: false }, "drawcast");
    const yt = offers.find((o) => o.id === "youtube")!;
    expect(yt.enabled).toBe(false);
    expect(yt.reason).toMatch(/TTS key/);
  });
  it("with no credentials at all a drawcast still sees two disabled rows, never an empty modal", () => {
    const offers = destinationOffers({ github: false, google: false, tts: false }, "drawcast");
    expect(offers.map((o) => o.id)).toEqual(["link", "video"]);
    expect(offers.every((o) => !o.enabled)).toBe(true);
  });
  it("a course is offered the GitHub destination alone, same third-state rules", () => {
    expect(destinationOffers({ github: false, google: true, tts: true }, "course").map((o) => o.id)).toEqual(["link"]);
  });
});
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** in `share.ts`: extend the DESTS rows with `settingsSuppliable` metadata and a `reason`; write `destinationOffers`; rewrite `refresh()`'s rail loop: disabled offers render as `disabled` rail buttons whose sub-line (a `.hint` span inside the button, or `title`) carries the reason, and clicking them calls `current.openSettings()` — wait: a `disabled` button swallows clicks, so render them as ENABLED buttons with a `.dest-off` class + the reason line, whose click opens Settings instead of selecting (record this in the ledger). `selectDestination` must only ever select an enabled offer; if the remembered `settings.shareTo` is disabled, fall back to the first enabled; if none is enabled, show the panel area's hint `"Publishing needs a destination — the rows above say what each one needs."` (reuse/replace `emptyHint`). Add a `.dest-off` CSS rule (muted text) in `styles.css` — grep the rail's existing classes first.
- [ ] **Step 4:** update the `"three panels"` literal test if the comment changes; `npm test` + `npx tsc --noEmit` → green. Commit: `feat: publish destinations the author can enable show disabled with the reason (B1)`. Push.

---

### Task 9: B9 — the yaml carries its founding prompt

**Files:**
- Modify: `src/playlist/playlist.ts` (`PlaylistMeta` 15, `DEFAULT_META` 58, `readMeta` 69-83, `isSingle` 195-206, `formatPlaylist` header block 219-225), `src/main.ts` (replace `doc.prompt` reads/writes — see Step 3), `src/store.ts` (SavedDrawing.prompt STAYS — the library keeps its own copy)
- Test: `tests/playlist.test.ts` (extend), one drift test

**Interfaces:**
- Produces: `PlaylistMeta.prompt?: string`; `formatPlaylist` writes `header.prompt` when set; `readMeta` reads it; `isSingle` returns false when `meta.prompt !== undefined` (a doc with a prompt always serializes with a header — §F.3.3's accepted shape change); helper in `main.ts`: `const docPrompt = (): string | undefined => doc.playlist.meta.prompt;`
- **Ruling (§F.3.3):** founding Generate request ONLY — the revise path never writes it. The published copy keeps it (one serializer, no special cases).

- [ ] **Step 1: Write the failing tests** (extend `tests/playlist.test.ts`):
```ts
describe("playlist.prompt — the founding request travels in the file (B9)", () => {
  test("a single spec with a prompt serializes with a header and round-trips", () => {
    const p = parsePlaylistText(SPEC_A);
    p.meta.prompt = "explain comparative advantage";
    const text = formatPlaylist(p, "yaml");
    expect(text).toContain("prompt: explain comparative advantage");
    const back = parsePlaylistText(text);
    expect(back.meta.prompt).toBe("explain comparative advantage");
    expect(back).toEqual(p);
  });
  test("no prompt → no header, exactly as before", () => {
    const p = parsePlaylistText(SPEC_A);
    expect(formatPlaylist(p, "yaml")).not.toContain("---");
  });
  test("isSingle is false once a prompt is set — the header must survive", () => {
    const p = parsePlaylistText(SPEC_A);
    p.meta.prompt = "x";
    expect(isSingle(p)).toBe(false);
  });
});
```
- [ ] **Step 2: Run** → FAIL. **Implement** in `playlist.ts`: add `prompt?: string` to `PlaylistMeta` (doc comment: `/** The founding Generate request, when AI-generated. Original only — revise instructions live in history. */`); `readMeta`: `if (typeof raw.prompt === "string") meta.prompt = raw.prompt;`; `formatPlaylist`: `if (playlist.meta.prompt !== undefined) header.prompt = playlist.meta.prompt;` (place after `subtitle`); `isSingle`: add `playlist.meta.prompt === undefined &&`.
- [ ] **Step 3: Rewire `main.ts`.** `doc.prompt` sites (177-199 interface, 298, 303, 312, 2100, 2165, 2168, 2191, 2337, 2518, 2578, 2676, 2721, 2761, 2767, 2819, 2855, 3421, and `share.ts:396`): keep the `Doc.prompt` field as the LIBRARY-facing copy but make the playlist meta the serialized source of truth. Concretely:
  - Where a doc is created from a fresh generation (`2518`, `2676`): also set `playlist.meta.prompt = rawRequest` before `setDoc` (for a `singlePlaylist`, set it on the returned playlist).
  - Where a doc is loaded from parsed text (Drive open 3578-3600, disk import 3421, GitHub source open ~3654-3700, `docFromSaved` 296-303): `prompt: parsed.meta.prompt ?? saved.prompt` — parsed meta wins; the library field is the fallback for pre-B9 entries.
  - `autosave()` (2191) keeps writing `prompt: doc.prompt` to `SavedDrawing`.
  - Keep `doc.prompt` and `meta.prompt` from drifting: in `setDoc` (2149), after `doc = next;` add `doc.prompt = doc.playlist.meta.prompt ?? doc.prompt;` — the meta is authoritative when present.
  - The revise path (2578) copies `prompt: doc.prompt` and never touches meta — verify, don't change.
- [ ] **Step 4: Drift test** (append to `tests/playlist.test.ts` or `tests/publish-placement.test.ts`):
```ts
it("generation writes the founding prompt into the playlist meta (B9)", async () => {
  const main = (await import("node:fs/promises").then((m) => m.readFile(new URL("../src/main.ts", import.meta.url), "utf8")));
  expect(main).toMatch(/meta\.prompt = rawRequest/);
});
```
- [ ] **Step 5:** `npm test` + `npx tsc --noEmit` → green. **Manually sanity-check the visible change** (ledger note): a generated single-spec doc now shows a small `playlist:\n  prompt: …` header atop the YAML editor — this is §F.3.3's accepted shape change, deliberate. Commit: `feat: the yaml carries its founding prompt (B9)`. Push.

---

### Task 10: B2 — Embed images / Embed narration as Publish checkboxes; pin→embed rename

**Files:**
- Create: `src/publish/embed.ts` (pure-with-injected-resolvers helper)
- Modify: `src/ui/share.ts` (link panel 191-212; `ShareDeps.publish` signature; count label), `src/ui/insert.ts` (rename Pin dialog copy; export `unembeddedImages`), `src/main.ts` (menu item 669 label; `publishTextFor` 3440; `publishDrawcast` 3472), `src/ui/course.ts` (publish 682 + share deps 817-854)
- Test: `tests/publish-embed.test.ts` (new), `tests/share-destinations.test.ts` or drift extension

**Interfaces:**
- Produces `src/publish/embed.ts`:
```ts
import type { Playlist } from "../playlist/playlist";
import type { Spec } from "../spec/types";

export interface EmbedDeps {
  resolvePortraits: (spec: Spec) => Promise<unknown>;
  resolveSources: (spec: Spec, opts: { contactEmail: string }) => Promise<unknown>;
  contactEmail: string;
}
/** A FRESH playlist whose specs are deep clones with images resolved into
 *  `strokes`. The input playlist and its spec objects are never touched —
 *  §3.4: exportSequence hands out the document's own objects. */
export async function embeddedPlaylist(playlist: Playlist, deps: EmbedDeps): Promise<Playlist>
```
Implementation: `const specs = itemsOf(playlist).map((i) => structuredClone(i.spec));` then `await Promise.all(specs.flatMap((s) => [deps.resolvePortraits(s), deps.resolveSources(s, { contactEmail: deps.contactEmail })]));` then `return playlistWithSpecs(playlist, specs);`
- Produces in `insert.ts` (next to `pinnableCount`, 311): `export function unembeddedImages(playlist: Playlist): number` — count of elements with `type === "portrait" || type === "source"` and **no `strokes`**, across every part (count only — the review cut the bytes estimate).
- Changes `ShareDeps.publish: (choices: { bake: boolean; embedImages: boolean }) => Promise<void>` — update `main.ts:3820` and `course.ts` accordingly.

- [ ] **Step 1: Write the failing tests** — `tests/publish-embed.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { embeddedPlaylist } from "../src/publish/embed";
import { parsePlaylistText, itemsOf } from "../src/playlist/playlist";
import { unembeddedImages } from "../src/ui/insert";

const TEXT = [
  "elements:",
  "  - {id: p1, type: portrait, of: Ricardo}",
  "commands: []",
].join("\n");

describe("embeddedPlaylist — resolves on a copy, never the document (B2, P §3.4)", () => {
  it("hands clones to the resolvers and returns a fresh playlist", async () => {
    const doc = parsePlaylistText(TEXT);
    const original = itemsOf(doc)[0].spec;
    const out = await embeddedPlaylist(doc, {
      contactEmail: "x@y.z",
      resolvePortraits: async (spec) => { (spec.elements![0] as { strokes?: string }).strokes = "img1:aa:data:,x"; return []; },
      resolveSources: async () => [],
    });
    expect(itemsOf(out)[0].spec).not.toBe(original);
    expect((itemsOf(out)[0].spec.elements![0] as { strokes?: string }).strokes).toBeDefined();
    expect((original.elements![0] as { strokes?: string }).strokes).toBeUndefined();  // the one test that matters most — P §6
  });
});

describe("unembeddedImages", () => {
  it("counts portrait/source elements without strokes across every part", () => {
    expect(unembeddedImages(parsePlaylistText(TEXT))).toBe(1);
  });
  it("embedded elements do not count", () => {
    const p = parsePlaylistText(TEXT);
    (itemsOf(p)[0].spec.elements![0] as { strokes?: string }).strokes = "img1:aa:data:,x";
    expect(unembeddedImages(p)).toBe(0);
  });
});
```
(Adapt element typing to the real `SpecElement`; if `elements` is required on `Spec`, drop the `!`.)
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `embed.ts` and `unembeddedImages` as specified.
- [ ] **Step 4: Wire the UI** (`share.ts` link panel): replace `linkBakeCb`/"with narration" with two checkboxes, both checked by default:
```
☑ Embed images (3)   the published file carries them; your document is unchanged
☑ Embed narration    the published file speaks; viewers need no key
```
The images count comes from `unembeddedImages(current.doc().playlist)` in `prepPanels()`; when the count is 0, show `Embed images` unchecked+disabled with hint "all images are already in the file". `publishGo` passes `{ bake: narrationCb.checked, embedImages: imagesCb.checked && count > 0 }`. Persisting the choices: reuse the existing `settings.shareTo`-style persistence ONLY if a settings field already exists — otherwise default-on each open, no new setting (ledger note).
- [ ] **Step 5: Wire main.ts:** `publishTextFor(signal, bake, embedImages)`: first `const source = embedImages ? await embeddedPlaylist(doc.playlist, { resolvePortraits, resolveSources, contactEmail: settings.contactEmail }) : doc.playlist;` then every use of `doc.playlist` inside the function switches to `source` (`formatPlaylist(source, "yaml")`, `playlistSpeakLines(source)`, `formatPublished(source, track)`). `publishDrawcast({ bake, embedImages })` threads it through. Status line gains ` — ${n} image(s) embedded` when n > 0.
- [ ] **Step 6: Course wiring** (`course.ts:682` publish): accept the same choices object; when `embedImages`, wrap each lecture's yaml: parse with `parsePlaylistText`, run `embeddedPlaylist`, re-`formatPlaylist` — reuse the same deps. (Course lectures publish text via `yamlFor(index)` — apply the wrap there.)
- [ ] **Step 7: The rename** (P §3.7): `main.ts:669` menu label `"Pin all images"` → `"Embed images in the file"`; menu title (main.ts:679) → `"Add an image, or embed every image into the file"`; `insert.ts:335` modal title → `"Embed images in the file"`, button (344) `"Pin"` → `"Embed"`; dialog copy states the distinction: embedding here changes **your document** — publishing embeds into **the copy you send** (P §3.6). Grep `[Pp]in` in `src/ui/insert.ts`, `main.ts`, `styles.css` for stragglers (comments may keep the word; user-facing strings may not). Existing drift test `tests/shell-css.test.ts:131-133` (no icon-only 📌) stays valid.
- [ ] **Step 8:** `npm test` + `npx tsc --noEmit` → green. Commit: `feat: embed images/narration as publish-time choices on a copy; pin becomes embed (B2)`. Push.

---

### Task 11: B3 — editable name on the Publish panel and the disk-save dialog

**Files:**
- Modify: `src/ui/share.ts` (link panel — slug field), `src/main.ts` (`publishDrawcast` 3472-3511 threads the slug; disk dialog 680-730 gains a name input; `ShareDeps.publish` choices gain `slug?: string`)
- Test: `tests/publish-name.test.ts` (new, pure bits) + drift assertions

**Interfaces:**
- Publish panel: a text input prefilled with `doc.publishedAs ?? slugify(title)` (import `slugify` from `../publish/github`), refreshed in `prepPanels()`. On publish, pass `slug: field.value.trim() || undefined`; `publishDrawcast` forwards it to `publishCast({ …, slug })` instead of `doc.publishedAs`. Editing the name of an already-published cast mints a NEW file at the new slug (the old one stays — publishCast never deletes); the field's hint says so: `"Changing the name publishes a new copy; the old link keeps working."`
- Disk dialog: a text input prefilled `fileSafe(save.title)` at `openSaveToDisk()`; the save handler uses `${fileSafe(nameInput.value, fileSafe(save.title))}.${format}` — user text still passes through `fileSafe` so illegal characters can't reach `downloadText`.
- Drive/GitHub saves: UNTOUCHED (ruling §F.3.1 / review R2).

- [ ] **Step 1: Failing drift test** (`tests/publish-name.test.ts`):
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

describe("the name is visible and editable where a panel exists (B3, F.1(2))", () => {
  it("the publish panel shows an editable slug", () => {
    expect(share).toMatch(/publishedAs \?\? slugify\(/);
  });
  it("the disk dialog carries a name field fed through fileSafe", () => {
    const listener = /saveDiskBtn\.addEventListener\("click",[^]*?\n\}\);/.exec(main)?.[0] ?? "";
    expect(listener).not.toBe("");
    expect(listener).toMatch(/fileSafe\(/);
  });
  it("Drive and GitHub saves stay one click — no new dialogs (ruling §F.3.1)", () => {
    const fn = /function buildSaveMenu\(\):[^]*?\n\}/.exec(main)?.[0] ?? "";
    expect(fn).toMatch(/onSelect: \(\) => void saveToDrive\(\)/);
    expect(fn).toMatch(/onSelect: \(\) => void saveSourceToGithub\(\)/);
  });
});
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per the interfaces above. The slug input normalizes on blur through `slugify(value)` so what's shown is what publishes. `prepPanels()` (share.ts:593) refreshes the prefill each open.
- [ ] **Step 4:** `npm test` + `npx tsc --noEmit` → green. Commit: `feat: editable name on publish and disk save (B3)`. Push.

---

### Task 12: B10 — Drive saves land in an app-created `drawcast` folder

**Files:**
- Modify: `src/google/drive.ts` (`DriveMeta` 8-11, `multipartBody` 14-24 unchanged shape, `saveSpec` 36-52 gains a parent, new `ensureFolder`), `src/main.ts:3526-3560` (`saveToDrive`)
- Test: `tests/drive-folder.test.ts` (new)

**Interfaces:**
- `DriveMeta` gains `parents?: string[]`.
- New pure export: `export function folderQuery(name: string): string` → `name = 'drawcast' and mimeType = 'application/vnd.google-apps.folder' and trashed = false` (single-quote escaping: `name.replace(/'/g, "\\'")`).
- New: `export async function ensureFolder(name = "drawcast"): Promise<string | null>` — `requireScope(DRIVE_SCOPE)`; GET `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(folderQuery(name))}&fields=files(id)` (drive.file lists only app-created/picked files, so this finds only our folder); hit → its id; miss → POST `files` with `{ name, mimeType: "application/vnd.google-apps.folder" }` → id. Any failure → `null` (a folderless save to root beats a failed save — ledger the graceful-degradation choice). Memoize per session in a module `let`, cleared on failure.
- `saveSpec(text, name, mimeType, fileId, parent?: string | null)` — the CREATE path (POST) includes `parents: [parent]` when set; the UPDATE path (PATCH) never sends `parents` (moving an existing file is not this function's job — Drive rejects `parents` on PATCH anyway).
- `saveToDrive` (main.ts): `const folder = target.driveFileId ? null : await ensureFolder();` then `saveSpec(save.text, name, mimeType, target.driveFileId, folder)`.

- [ ] **Step 1: Failing tests** — `tests/drive-folder.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { folderQuery, multipartBody } from "../src/google/drive";

describe("Drive folder (B10, §F.3.2)", () => {
  it("queries for the app's own folder by name, excluding trash", () => {
    expect(folderQuery("drawcast")).toBe("name = 'drawcast' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  });
  it("escapes quotes in the folder name", () => {
    expect(folderQuery("it's")).toContain("it\\'s");
  });
  it("the multipart metadata carries parents on create", () => {
    const body = multipartBody({ name: "n.yaml", mimeType: "text/yaml", parents: ["FOLDER1"] }, "x", "b");
    expect(body).toContain('"parents":["FOLDER1"]');
  });
});
```
Plus a drift assertion that `saveSpec`'s PATCH path never sends parents:
```ts
it("an update never re-parents", async () => {
  const src = (await import("node:fs/promises").then((m) => m.readFile(new URL("../src/google/drive.ts", import.meta.url), "utf8")));
  const fn = /export async function saveSpec[^]*?\n\}/.exec(src)?.[0] ?? "";
  expect(fn).toMatch(/fileId \? \{ name, mimeType \}/);  // adjust to the real ternary shape
});
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per the interfaces. `saveSpec` builds `const metadata: DriveMeta = fileId ? { name, mimeType } : parent ? { name, mimeType, parents: [parent] } : { name, mimeType };` — adjust the drift regex to match. Extend the file-top comment (drive.ts:1-4) with one line about the folder: created by the app, therefore inside `drive.file` scope.
- [ ] **Step 4:** `npm test` + `npx tsc --noEmit` → green. Commit: `feat: Drive saves land in an app-created drawcast folder (B10)`. Push.

---

### Task 13: Close the round

- [ ] **Step 1:** Full `npm test` + `npx tsc --noEmit` one last time from a clean checkout state (`git status` clean).
- [ ] **Step 2:** Update `docs/superpowers/ROADMAP-2026-09.md`: mark A1–A5, A7, A8, C5, C6, B1, B2, B3, B9, B10 as **DONE (2026-09-01)** in their tables; note A6 deferred to the player part.
- [ ] **Step 3:** Finalize the ledger (`docs/superpowers/plans/2026-09-01-tidyup-publish-ledger.md`) — every ruling dated.
- [ ] **Step 4:** Commit `docs: check off parts 1+3; ledger` and push. Verify `git ls-remote origin main` matches local HEAD.

## Self-review notes

- Spec coverage: A1(T5) A2(T5) A3(T1) A4(T5) A5(T4) A7(T2) A8(T3) C5(T7) C6(T6) B1(T8) B2(T10) B3(T11) B9(T9) B10(T12). A6 deliberately deferred (Part 2). References-tab hiding folded into T3 per review §2.3.
- Type consistency: `ShareDeps.publish` changes shape in T10 and gains `slug` in T11 — T11 depends on T10; both callers (main.ts, course.ts) updated in the same task as each change.
- Order rationale: T1–T7 are Part 1 (independent, roughly ascending risk); T8–T12 are Part 3; T5 before T8 because both edit the DESTS rows; T10 before T11 because both edit the link panel and the publish signature.
