# Editor Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the drawcast shell from ~25 always-visible controls to a structured set, behind one rule — a button in a bar is a verb, its options live in the modal it opens — and make the player usable on a phone.

**Architecture:** Four new focused modules under `src/ui/` (`menu.ts`, `share.ts`, `insert.ts`, `sidebar.ts`) take work out of the 3828-line `main.ts`. Each exposes a **pure function** that decides what the UI shows, plus a thin DOM builder. The pure functions are what the tests exercise — vitest runs `environment: "node"` with no DOM. CSS rules are pinned by source-text drift tests, the pattern already used in `tests/course-panel.test.ts:77–86`.

**Tech Stack:** TypeScript, Vite, vitest (node environment), vanilla DOM via the `h()` helper in `src/ui/dom.ts`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-editor-shell-design.md`

## Global Constraints

- **The rule (spec §1):** no checkbox and no `<select>` sits permanently in a bar beside the button it modifies. `☑ with narration` must exist in exactly **one** place in the source when this plan is done.
- **Behaviour is preserved.** `publishDrawcast`, `publishCourse`, `exportVideo`, the YouTube upload, `traceFromBlob`, `runCourse`, `reviseCourse`, `matchLibrary` and the `inFlight` AbortController set keep their code. Controls change place, not wiring. The one exception is portrait *placement* (Task 7).
- **A capability without its credential does not advertise itself.** `driveOpenBtn.hidden = !pickerConfigured()`, `uploadYtBtn.hidden = !googleConfigured()` (`main.ts:574–584`). Carried forward.
- **Touch minimum 44px** for every interactive control under `@media (hover: none)`.
- **No icon-only control may rely on `title=` alone.** It carries visible text, or lives in a dialog that explains it. `📌` is the only permitted icon-only survivor and gains a visible label on touch.
- **Existing drift tests must be updated, never deleted.** `tests/course-panel.test.ts:77–86` pins `dialog { max-width: 30rem }` and `.course-modal`'s `min()` widths; those assertions move to the new class names in Task 4.
- **Run `npm test` before every commit.** The suite is ~2161 tests; a task is not done until it is green.
- **Push after each task** — this repo's convention.

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/menu.ts` | **new.** One dropdown-menu primitive: a button that opens a list of items. Used by `Open ▾`, `Save ▾`, `＋ Insert ▾` and the player's `⋯`. |
| `src/ui/share.ts` | **new.** `shareDestinations()` + the Share modal. Absorbs `ytDialog`. |
| `src/ui/insert.ts` | **new.** `portraitInsert()` + the Insert-portrait dialog. |
| `src/ui/sidebar.ts` | **new.** `sidebarSections()` + the four collapsible sections. |
| `src/ui/modal.ts` | modify. `createModal` gains a `footer`; add the `.modal-s/m/l` sizes. |
| `src/ui/controls.ts` | modify. Extract `shouldIdle()`; fold the player bar under 560px. |
| `src/ui/course.ts` | modify. Split the twelve-control bar into four regions. |
| `src/store.ts` | modify. `shareTo` + `sidebarSections` settings; `SETTINGS_TABS`. |
| `src/main.ts` | modify. Shell assembly shrinks; Settings gets tabs. |
| `src/styles.css` | modify. `--bar-h`, `.bar-group`, modal scale, touch tier, sheets. |

---

### Task 1: The idle policy — a hidden control bar during a question

**Spec:** §10.2 (last item), §10.3. This is first because it is the only defect a *viewer* can hit, and it is independent of every other task.

**Files:**
- Modify: `src/ui/controls.ts:750–771`
- Test: `tests/idle-policy.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `export function shouldIdle(s: { playing: boolean; gateOpen: boolean }): boolean` from `src/ui/controls.ts`.

- [ ] **Step 1: Reproduce on a real phone before writing anything**

The spec calls this diagnosed, not observed. Open a drawcast with a click-the-figure question on a phone, play it, wait past 2.8s so the bar fades, and try to bring the controls back during the question.

Record the outcome in the commit message. **If the controls come back without submitting an answer, stop: skip to Step 6, implement `shouldIdle` anyway as a guard, and note that the collision did not reproduce.** The function is cheap and pins the invariant either way.

- [ ] **Step 2: Write the failing test**

```ts
// tests/idle-policy.test.ts
import { describe, expect, it } from "vitest";
import { shouldIdle } from "../src/ui/controls";

describe("shouldIdle", () => {
  it("idles out while playing with nothing waiting on the viewer", () => {
    expect(shouldIdle({ playing: true, gateOpen: false })).toBe(true);
  });

  it("never idles out while a gate is open — on a phone the tap that would\n     bring the bar back is the tap that answers the question", () => {
    expect(shouldIdle({ playing: true, gateOpen: true })).toBe(false);
  });

  it("never idles out when paused", () => {
    expect(shouldIdle({ playing: false, gateOpen: false })).toBe(false);
    expect(shouldIdle({ playing: false, gateOpen: true })).toBe(false);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/idle-policy.test.ts`
Expected: FAIL — `shouldIdle is not a function`.

- [ ] **Step 4: Implement**

Add to `src/ui/controls.ts`, above the `attachControls` body that uses it:

```ts
/**
 * Whether the control bar may fade out. A gate holds it visible: on a phone
 * the only gesture that brings a hidden bar back is a tap on the figure, and
 * during a click-the-figure question that same tap submits an answer.
 */
export function shouldIdle(s: { playing: boolean; gateOpen: boolean }): boolean {
  return s.playing && !s.gateOpen;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run tests/idle-policy.test.ts`
Expected: PASS, 4 assertions.

- [ ] **Step 6: Wire it into the live idle timer**

In `src/ui/controls.ts:756–771`, add a `gateOpen` flag beside `playing` and route both scheduling sites through `shouldIdle`:

```ts
  let playing = false;
  let gateOpen = false;
  const setIdle = (idle: boolean) => figure.classList.toggle("cs-idle", idle);
  const scheduleIdle = (ms = IDLE_MS) => {
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    if (!shouldIdle({ playing, gateOpen })) return;
    idleTimer = window.setTimeout(() => setIdle(true), ms);
  };
```

Every gate factory in this file (`clickGate`, `quizGateFor`, `askGateFor`, `figureGateFor`, `pianoGateFor`, `chessGateFor`) appends its overlay to `stage` and removes it in `done()`. Set `gateOpen = true` where the overlay is appended and `gateOpen = false; activity();` in `done()` — the `activity()` call is what brings a bar that already faded back the moment the question is answered.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all green. `tests/ask-player.test.ts` and `tests/card-model.test.ts` exercise the gates; they must not regress.

- [ ] **Step 8: Commit and push**

```bash
git add src/ui/controls.ts tests/idle-policy.test.ts
git commit -m "The control bar no longer hides behind a question"
git push origin main
```

---

### Task 2: `--bar-h`, the touch tier, and the seek bar

**Spec:** §6, §10.3 (first two bullets). CSS only — no behaviour changes, visible immediately.

**Files:**
- Modify: `src/styles.css:7–21` (tokens), `:416–431` (`.pane-bar`), `:681–712` (player controls), `:99–108` (`.icon-btn`), `:84–98` (`.mode-btn`), `:380–392` (`.sidebar-row`), `:757–765` (`.dialog-x`)
- Test: `tests/shell-css.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the `--bar-h` and `--tap` custom properties, relied on by Tasks 3, 5, 8 and 11.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shell-css.test.ts
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

  it("grows the seek bar on touch, where :hover never fires", async () => {
    const block = /@media\s*\(hover:\s*none\)\s*\{([\s\S]*?)\n\}/.exec(await css())?.[1] ?? "";
    expect(block).toMatch(/\.cs-progress\s*\{[^}]*height:\s*12px/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/shell-css.test.ts`
Expected: FAIL on all four — no `--bar-h`, no touch block.

- [ ] **Step 3: Add the tokens**

In `src/styles.css`, inside `:root` (after `--mono-font`):

```css
  /* One height for every control in a bar — and the touch minimum the same
     controls grow to when there is no hover to reveal anything. */
  --bar-h: 1.9rem;
  --tap: 44px;
```

- [ ] **Step 4: Apply the bar height and delete the size exception**

Replace `styles.css:429–430`:

```css
.pane-bar button, .pane-bar select { font-size: 0.82rem; padding: 0.24rem 0.5rem; min-height: var(--bar-h); }
```

The `.pane-bar .icon-only` rule is **deleted** — that is the step the row was visibly on.

- [ ] **Step 5: Add the touch tier**

Add one block near the end of the shared-controls section, replacing the existing bare `@media (hover: none)` rule at `styles.css:565` by absorbing it:

```css
/* Touch: nothing here can be revealed by hovering and no finger is 25px wide.
   Every control a thumb aims at grows to the platform minimum, and the seek
   bar grows unconditionally because :hover will never fire to grow it. */
@media (hover: none) {
  .pane-bar button, .pane-bar select,
  .cs-bar-btn, .sidebar-row, .mode-btn, .dialog-x, .menu-item {
    min-height: var(--tap);
  }
  .cs-bar-btn { min-width: var(--tap); }
  .library-del { opacity: 1; pointer-events: auto; }
  .cs-progress { height: 12px; }
  .cs-progress::before { content: ""; position: absolute; inset: -10px 0; }
  .cs-controlbar { gap: 0.2rem; }
}
```

`.cs-progress` needs `position: relative` added to its base rule at `styles.css:697` for the `::before` hit area to anchor.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/shell-css.test.ts`
Expected: PASS, 4 assertions.

- [ ] **Step 7: Run the whole suite and commit**

```bash
npm test
git add src/styles.css tests/shell-css.test.ts
git commit -m "One size per bar, and controls a thumb can hit"
git push origin main
```

---

### Task 3: The menu primitive

**Spec:** §4, §7 — the shared piece four later tasks need. Building it once is why `Open ▾`, `Save ▾`, `＋ Insert ▾` and the player's `⋯` cost almost nothing later.

**Files:**
- Create: `src/ui/menu.ts`
- Test: `tests/menu-model.test.ts` (create)

**Interfaces:**
- Consumes: `h` from `./dom`.
- Produces:
  ```ts
  export interface MenuItem { label: string; onSelect(): void; hidden?: boolean }
  export function visibleItems(items: MenuItem[]): MenuItem[];
  export function createMenu(label: string, items: MenuItem[], opts?: { title?: string }): HTMLElement;
  ```
  `createMenu` returns the trigger button with the panel attached. **When exactly one item is visible it renders as a plain button that runs that item directly** — so a user without Google never pays a click for a one-item `Open ▾`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/menu-model.test.ts
import { describe, expect, it } from "vitest";
import { visibleItems, type MenuItem } from "../src/ui/menu";

const item = (label: string, hidden = false): MenuItem => ({ label, hidden, onSelect: () => {} });

describe("visibleItems", () => {
  it("drops hidden items — a capability without its credential does not advertise itself", () => {
    expect(visibleItems([item("From disk"), item("From Google Drive", true)]).map((i) => i.label))
      .toEqual(["From disk"]);
  });

  it("keeps order", () => {
    expect(visibleItems([item("a"), item("b"), item("c")]).map((i) => i.label)).toEqual(["a", "b", "c"]);
  });

  it("can end up empty", () => {
    expect(visibleItems([item("a", true)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/menu-model.test.ts`
Expected: FAIL — cannot resolve `../src/ui/menu`.

- [ ] **Step 3: Implement**

```ts
// src/ui/menu.ts
// One dropdown primitive for every "a verb with a few ways to do it" control:
// Open, Save, Insert, and the player's overflow. A menu whose items reduce to
// one is not a menu — it renders as that one button, so a user without Google
// never pays a click to reach the only option they have.

import { h } from "./dom";

export interface MenuItem {
  label: string;
  onSelect(): void;
  /** Same rule as the buttons this replaces: no credential, no advertisement. */
  hidden?: boolean;
}

export function visibleItems(items: MenuItem[]): MenuItem[] {
  return items.filter((i) => !i.hidden);
}

export function createMenu(label: string, items: MenuItem[], opts: { title?: string } = {}): HTMLElement {
  const live = visibleItems(items);
  if (live.length === 1) {
    const only = h("button", opts.title ? { title: opts.title } : {}, `${label.replace(/ ▾$/, "")} ${live[0].label}`.trim());
    only.addEventListener("click", () => live[0].onSelect());
    return only;
  }
  const panel = h("div", { class: "menu-panel", hidden: "" });
  const trigger = h("button", { class: "menu-trigger", "aria-expanded": "false", ...(opts.title ? { title: opts.title } : {}) }, `${label} ▾`);
  const close = (): void => {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  for (const item of live) {
    const b = h("button", { class: "menu-item" }, item.label);
    b.addEventListener("click", () => {
      close();
      item.onSelect();
    });
    panel.appendChild(b);
  }
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    trigger.setAttribute("aria-expanded", String(!panel.hidden));
  });
  // Dismissal belongs on the document, not the trigger: a click anywhere else
  // — including on another menu's trigger — has to close this one.
  document.addEventListener("click", close);
  return h("span", { class: "menu" }, trigger, panel);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/menu-model.test.ts`
Expected: PASS, 3 assertions.

- [ ] **Step 5: Style it**

Add to `src/styles.css`, after the `.pane-bar` section:

```css
/* ---------- the ▾ menu: a verb with a few ways to do it ---------- */
.menu { position: relative; display: inline-flex; }
.menu-panel {
  position: absolute;
  top: calc(100% + 0.3rem);
  left: 0;
  z-index: 30;
  min-width: 11rem;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1.5px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 3px 10px rgba(61, 56, 51, 0.14);
  padding: 0.25rem;
}
.menu-item {
  border: none;
  background: none;
  text-align: left;
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
  font-size: 0.85rem;
  color: var(--ink);
  cursor: pointer;
}
.menu-item:hover { background: color-mix(in srgb, var(--ink) 6%, var(--surface)); }
```

- [ ] **Step 6: Run the whole suite and commit**

```bash
npm test
git add src/ui/menu.ts tests/menu-model.test.ts src/styles.css
git commit -m "A menu primitive, and a menu of one is just a button"
git push origin main
```

---

### Task 4: The modal size scale and the footer row

**Spec:** §7. Everything from here that adds a dialog depends on this.

**Files:**
- Modify: `src/ui/modal.ts:44–62`, `src/styles.css:736–745` and `:479–480`, `:1400–1403`
- Modify: `tests/course-panel.test.ts:77–86` (move the two width assertions to the new names — do **not** delete them)
- Test: `tests/shell-css.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `Modal` gains `footer: HTMLElement`. The three classes `.modal-s`, `.modal-m`, `.modal-l`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/shell-css.test.ts`:

```ts
describe("the modal size scale", () => {
  it("names three sizes and no per-modal override survives", async () => {
    const text = await css();
    expect(text).toMatch(/\.modal-s\s*\{[^}]*max-width:\s*30rem/);
    expect(text).toMatch(/\.modal-m\s*\{[^}]*max-width:\s*46rem/);
    expect(text).toMatch(/\.modal-l\s*\{[^}]*max-width:\s*min\(104rem,\s*96vw\)/);
    expect(text).not.toMatch(/\.wide-dialog/);
    expect(text).not.toMatch(/\.course-modal\s*\{[^}]*max-width/);
  });

  it("gives every modal a footer row for its actions", async () => {
    expect(await css()).toMatch(/\.dialog-footer\s*\{/);
  });
});
```

And in `tests/course-panel.test.ts`, replace the two assertions at lines 77–86 (keep the `describe` and the file's other tests intact):

```ts
  it("still gives the course modal a working-surface width", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const rule = /\.modal-l\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/width:\s*min\(/);
    expect(rule).toMatch(/max-width:\s*min\(/);
  });

  it("still caps the small dialog, so ordinary dialogs stay narrow", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(/\.modal-s\s*\{[^}]*max-width:\s*30rem/.test(css)).toBe(true);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/shell-css.test.ts tests/course-panel.test.ts`
Expected: FAIL — no `.modal-s`, `.wide-dialog` still present.

- [ ] **Step 3: Replace the width rules**

In `src/styles.css`, change the bare `dialog` rule (`:736–745`) to drop `max-width` and keep everything else, then add the scale:

```css
/* Three sizes, named. .modal-s is one subject or a confirmation; .modal-m is
   lists and tabs; .modal-l is a working surface you edit inside. The body cap
   scales with the size instead of being overridden per modal. */
.modal-s { max-width: 30rem; }
.modal-m { max-width: 46rem; }
.modal-l { width: min(104rem, 96vw); max-width: min(104rem, 96vw); }
.modal-s .dialog-body, .modal-m .dialog-body { max-height: min(70vh, 42rem); }
.modal-l .dialog-body { max-height: min(86vh, 64rem); }

/* Actions live at the foot, right-aligned, primary last — never mid-body. */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.9rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--line);
}
.dialog-footer .footer-left { margin-right: auto; display: flex; gap: 0.5rem; }
```

Delete `.wide-dialog` (`:479`), the old `.dialog-body` cap (`:480`), and the `.course-modal` width and body rules (`:1400–1403`).

- [ ] **Step 4: Give `createModal` a footer**

In `src/ui/modal.ts`, extend the interface and the factory:

```ts
export interface Modal {
  dialog: HTMLDialogElement;
  /** Append the modal's content here — the head is already in place. */
  body: HTMLElement;
  /**
   * The action row. Right-aligned, primary last; anything appended to
   * `.footer-left` in it sits on the far side. A modal with no actions simply
   * never touches this and it stays empty and invisible.
   */
  footer: HTMLElement;
  open(): void;
}

export function createModal(title: string, opts: ModalOptions = {}): Modal {
  const size = opts.size ?? "s";
  const dialog = h("dialog", { class: `modal-${size}${opts.class ? ` ${opts.class}` : ""}` }) as HTMLDialogElement;
  const body = h("div", { class: "dialog-body" });
  const footer = h("div", { class: "dialog-footer" });
  dialog.append(dialogHead(dialog, title, opts), body, footer);
  return {
    dialog,
    body,
    footer,
    open: () => {
      if (!dialog.open) dialog.showModal();
    },
  };
}
```

Add `size?: "s" | "m" | "l"` to `ModalOptions`, documented as: *the size scale; omit for `s`.*

An empty footer must not draw its border. Add:

```css
.dialog-footer:empty { display: none; }
```

- [ ] **Step 5: Update the five existing `createModal` callers**

- `main.ts:928` `createModal("✦ Templates", { class: "wide-dialog" })` → `createModal("✦ Templates", { size: "m" })`
- `main.ts:981` `createModal("📝 Instructions", { class: "wide-dialog" })` → `createModal("📝 Instructions", { size: "m" })`
- `main.ts:1045` `createModal("📊 Data")` → unchanged (defaults to `s`)
- `main.ts:1567` `createModal("Subtitles", { class: "sub-dialog" })` → `createModal("Subtitles", { class: "sub-dialog" })` (keeps its own class, gains `modal-s`)
- `ui/course.ts:71` `createModal("Course", { class: "course-modal" })` → `createModal("Course", { size: "l", class: "course-modal" })`

Move the Instructions modal's two loose `.row`s of buttons (`main.ts:992–993`) into `instructionsModal.footer`, primary last.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/shell-css.test.ts tests/course-panel.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole suite and commit**

```bash
npm test
git add src/ui/modal.ts src/styles.css src/main.ts src/ui/course.ts tests/
git commit -m "Three named modal sizes, and a footer for the actions"
git push origin main
```

---

### Task 5: The four hand-built dialogs move onto `createModal`

**Spec:** §0.1, §9 (first paragraph). This is what gives Settings the scroll cap it never had.

**Files:**
- Modify: `src/main.ts:1103–1181` (Settings), the author dialog, `:1481` (3D), `:3332–3352` (YouTube)
- Test: `tests/shell-css.test.ts` (extend)

**Interfaces:**
- Consumes: `createModal` with `footer` from Task 4.
- Produces: nothing new; four call sites change shape.

- [ ] **Step 1: Write the failing test**

Append to `tests/shell-css.test.ts`:

```ts
import { readFile as read2 } from "node:fs/promises";

describe("every dialog goes through the helper", () => {
  it("nothing builds a bare <dialog> outside createModal — that is how\n     Settings lost its scroll cap", async () => {
    for (const f of ["../src/main.ts", "../src/ui/course.ts"]) {
      const src = await read2(new URL(f, import.meta.url), "utf8");
      expect(src).not.toMatch(/h\(\s*"dialog"/);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/shell-css.test.ts -t "bare"`
Expected: FAIL — `main.ts` has four `h("dialog"` calls.

- [ ] **Step 3: Convert Settings**

Replace `main.ts:1103–1104`:

```ts
const settingsModal = createModal("Settings", { size: "m" });
const dialog = settingsModal.dialog;
settingsModal.body.append(
  // ...every existing settings-field block, unchanged, minus the dialogHead call
);
```

Keep every `.settings-field` block and every `.settings-note` string **verbatim** — those explanations are why someone trusts pasting a token.

- [ ] **Step 4: Convert the other three**

- **Author dialog** (`main.ts` ~1240): `createModal("✦ New template", { size: "m" })`; its `authorGenBtn` / `authorSaveBtn` row moves to `footer`.
- **3D viewer** (`main.ts:1481`): `createModal("3D", { size: "m" })`; `model3dSpinBtn` / `model3dLabelsBtn` move to `footer`.
- **YouTube** (`main.ts:3332`): `createModal("▶ Upload to YouTube", { size: "m", backdropCloses: false })`; the `h("div", { class: "row" }, ytGo, ytSaveCopy)` row becomes `footer` with `ytSaveCopy` in `.footer-left` and `ytGo` last. **This dialog is dismantled again in Task 6** — convert it anyway, so the suite stays green between tasks.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/shell-css.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite and commit**

```bash
npm test
git add src/main.ts tests/shell-css.test.ts
git commit -m "Settings gets the scroll cap every other dialog already had"
git push origin main
```

---

### Task 6: Share — one verb, four destinations

**Spec:** §2. Replaces `⬇`, `⬆ Publish`, `☑ with narration`, `🎬 Export video`, `▶ YouTube`.

**Files:**
- Create: `src/ui/share.ts`
- Modify: `src/store.ts` (add `shareTo`), `src/main.ts:805–828` (bars), `:3094–3139` (publish), `:3332+` (YouTube moves in)
- Test: `tests/share-destinations.test.ts` (create)

**Interfaces:**
- Consumes: `createModal` + `footer` (Task 4).
- Produces:
  ```ts
  export type ShareTo = "link" | "youtube" | "video" | "spec";
  export interface ShareCaps { github: boolean; google: boolean; tts: boolean }
  export interface ShareDest { id: ShareTo; label: string; action: string }
  export function shareDestinations(caps: ShareCaps, subject: "drawcast" | "course"): ShareDest[];
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/share-destinations.test.ts
import { describe, expect, it } from "vitest";
import { shareDestinations } from "../src/ui/share";

const all = { github: true, google: true, tts: true };

describe("shareDestinations", () => {
  it("offers four destinations for a drawcast when everything is configured", () => {
    expect(shareDestinations(all, "drawcast").map((d) => d.id))
      .toEqual(["link", "youtube", "video", "spec"]);
  });

  it("names each action with the verb its button performs", () => {
    const byId = Object.fromEntries(shareDestinations(all, "drawcast").map((d) => [d.id, d.action]));
    expect(byId).toEqual({ link: "Publish", youtube: "Upload", video: "Export", spec: "Download" });
  });

  it("hides the link when there is no GitHub — a capability without its\n     credential does not advertise itself", () => {
    expect(shareDestinations({ ...all, github: false }, "drawcast").map((d) => d.id))
      .toEqual(["youtube", "video", "spec"]);
  });

  it("hides YouTube without Google, and video without a TTS key", () => {
    expect(shareDestinations({ github: true, google: false, tts: false }, "drawcast").map((d) => d.id))
      .toEqual(["link", "spec"]);
  });

  it("offers a course the link alone — batch video is not written", () => {
    expect(shareDestinations(all, "course").map((d) => d.id)).toEqual(["link"]);
  });

  it("can offer nothing at all", () => {
    expect(shareDestinations({ github: false, google: false, tts: false }, "course")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/share-destinations.test.ts`
Expected: FAIL — cannot resolve `../src/ui/share`.

- [ ] **Step 3: Implement the pure part**

```ts
// src/ui/share.ts
// Every way a drawcast leaves the app, behind one verb. The options that used
// to sit in the toolbar next to Publish live here instead, beside the
// destination they actually belong to — baking is Link's, the language
// checkboxes are YouTube's, and burn-captions differs between the downloaded
// file and the upload on purpose.

export type ShareTo = "link" | "youtube" | "video" | "spec";

export interface ShareCaps {
  /** A GitHub repo AND token are set. */
  github: boolean;
  /** Google is configured (client id present). */
  google: boolean;
  /** A Google Cloud TTS key is set — recording needs a voice it can capture. */
  tts: boolean;
}

export interface ShareDest {
  id: ShareTo;
  label: string;
  /** The primary button's word. A button says what it does. */
  action: string;
}

const DESTS: (ShareDest & { needs: (c: ShareCaps) => boolean; courses: boolean })[] = [
  { id: "link", label: "Link", action: "Publish", needs: (c) => c.github, courses: true },
  { id: "youtube", label: "YouTube", action: "Upload", needs: (c) => c.google && c.tts, courses: false },
  { id: "video", label: "Video file", action: "Export", needs: (c) => c.tts, courses: false },
  { id: "spec", label: "Spec file", action: "Download", needs: () => true, courses: false },
];

export function shareDestinations(caps: ShareCaps, subject: "drawcast" | "course"): ShareDest[] {
  return DESTS
    .filter((d) => (subject === "course" ? d.courses : true) && d.needs(caps))
    .map(({ id, label, action }) => ({ id, label, action }));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/share-destinations.test.ts`
Expected: PASS, 6 assertions.

- [ ] **Step 5: Add the `shareTo` setting**

In `src/store.ts`, add to `Settings` after `specFormat`:

```ts
  /** The Share destination used last, so a repeat publish is one keypress. */
  shareTo: ShareTo;
```

and to `DEFAULT_SETTINGS`: `shareTo: "link",`. Import the type from `./ui/share` — or, to keep `store.ts` free of UI imports (it is imported by the standalone viewer), declare it inline as the same union and let `share.ts` import it from the store. **Take the second option**: `store.ts` must not pull in UI code.

- [ ] **Step 6: Build the modal**

Add to `src/ui/share.ts` an `openShare(deps)` that builds a `createModal("↗ Share", { size: "m" })`, renders `shareDestinations(...)` as a left rail of buttons, shows the selected destination's options on the right, and puts one primary button in `footer` labelled `dest.action`.

The four option panels are lifts, not rewrites:
- **Link** — the `publishBakeCb` checkbox moved from `main.ts:567`, calling `publishDrawcast()` (or `publishCourse` when `subject === "course"`).
- **YouTube** — the whole body of `ytDialog` (`main.ts:3333–3352`): `ytTitle`, `ytDesc`, `ytLangBox`, `ytPrivacy`, `ytBurnCb`, the `yt-warning` div, with `ytSaveCopy` in `.footer-left`.
- **Video file** — `settings.burnCaptions` and the language, calling `exportVideo`.
- **Spec file** — the format select, calling the existing download path from `exportBtn`.

Selecting a destination writes `settings.shareTo` and calls `persist()`.

When `subject === "course"` and no destination is available, the modal shows the Settings link rather than an empty rail: `"Set your GitHub repository and token in Settings to publish."` — this replaces the red status line at `main.ts:3097–3100`.

- [ ] **Step 7: Delete the five controls**

From `main.ts:805–828`, remove `exportBtn`, `publishBtn`, `publishBakeLabel`, `exportVideoBtn`, `uploadYtBtn` from the bars and add one `↗ Share` button. `exportChip` stays in the preview bar — it is progress, not an action.

**Verify `☑ with narration` now appears once in the source**, not twice: `grep -c "with narration" src/main.ts src/ui/course.ts src/ui/share.ts`. The course copy goes in Task 10; expect 1 in `share.ts` and 1 still in `course.ts` at this point.

- [ ] **Step 8: Guard the translation trap**

`exportSequence` hands out the document's own spec objects. The YouTube path must keep translating into **fresh** playlists via `ytTranslations` rather than mutating `doc` — the reasoning is at `main.ts:3358–3365`. Move that map into `share.ts` unchanged.

- [ ] **Step 9: Run the whole suite and commit**

```bash
npm test
git add src/ui/share.ts src/store.ts src/main.ts tests/share-destinations.test.ts
git commit -m "One Share verb over four destinations"
git push origin main
```

---

### Task 7: ＋ Insert, and a portrait that lands where you put it

**Spec:** §3. The one behaviour change in the design.

**Files:**
- Create: `src/ui/insert.ts`
- Modify: `src/main.ts:2947–3030` (portrait handlers), `:805–823` (bar)
- Test: `tests/portrait-insert.test.ts` (create)

**Interfaces:**
- Consumes: `createMenu` (Task 3), `createModal` + `footer` (Task 4), `Playlist`/`Spec` types.
- Produces:
  ```ts
  export type PortraitSource = { of: string } | { url: string } | { strokes: string };
  export interface PortraitChoice { source: PortraitSource; part: number; cameo: boolean; afterStep: number }
  export function portraitInsert(playlist: Playlist, choice: PortraitChoice): Playlist;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/portrait-insert.test.ts
import { describe, expect, it } from "vitest";
import { parsePlaylistText, itemsOf } from "../src/playlist/playlist";
import { portraitInsert } from "../src/ui/insert";

const one = () => parsePlaylistText('{"elements": [], "commands": [{"draw": []}, {"pause": 1}]}');

describe("portraitInsert", () => {
  it("emits a draw command instead of leaving the element to the implicit\n     tail-draw that dumped it in a corner at the end", () => {
    const out = portraitInsert(one(), { source: { of: "David Ricardo" }, part: 0, cameo: true, afterStep: 1 });
    const spec = itemsOf(out)[0].spec;
    const drawn = (spec.commands ?? []).flatMap((c: any) => (typeof c.draw === "string" ? [c.draw] : (c.draw ?? [])));
    expect(drawn).toContain("portrait_1");
  });

  it("puts the draw at the chosen step, not at the end", () => {
    const out = portraitInsert(one(), { source: { of: "Keynes" }, part: 0, cameo: true, afterStep: 1 });
    const cmds = itemsOf(out)[0].spec.commands ?? [];
    expect(JSON.stringify(cmds[1])).toContain("portrait_1");
  });

  it("omits x/y/width in cameo mode — the schema says to", () => {
    const out = portraitInsert(one(), { source: { of: "Keynes" }, part: 0, cameo: true, afterStep: 0 });
    const el: any = (itemsOf(out)[0].spec.elements ?? [])[0];
    expect(el.cameo).toBe(true);
    expect(el.x).toBeUndefined();
    expect(el.width).toBeUndefined();
  });

  it("keeps the corner defaults when it is not a cameo", () => {
    const out = portraitInsert(one(), { source: { url: "https://x/y.jpg" }, part: 0, cameo: false, afterStep: 0 });
    const el: any = (itemsOf(out)[0].spec.elements ?? [])[0];
    expect([el.x, el.y, el.width]).toEqual([170, 550, 170]);
    expect(el.url).toBe("https://x/y.jpg");
  });

  it("numbers portraits per part", () => {
    let pl = portraitInsert(one(), { source: { of: "A" }, part: 0, cameo: true, afterStep: 0 });
    pl = portraitInsert(pl, { source: { of: "B" }, part: 0, cameo: true, afterStep: 0 });
    const ids = (itemsOf(pl)[0].spec.elements ?? []).map((e: any) => e.id);
    expect(ids).toEqual(["portrait_1", "portrait_2"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/portrait-insert.test.ts`
Expected: FAIL — cannot resolve `../src/ui/insert`.

- [ ] **Step 3: Implement the pure part**

```ts
// src/ui/insert.ts
// Inserting a portrait, properly. The old button dropped the element at a
// fixed x/y with NO draw command, so it surfaced through the implicit
// final-draw rule (render/plan.ts) as an extra step at the very end of the
// piece — and always into part 1, whichever part you were looking at.

import { itemsOf, type Playlist } from "../playlist/playlist";
import type { SpecElement } from "../spec/types";

export type PortraitSource = { of: string } | { url: string } | { strokes: string };

export interface PortraitChoice {
  source: PortraitSource;
  /** Index into itemsOf(playlist) — the part being viewed, not always 0. */
  part: number;
  /** Cameo: centered, larger, frameless; omits x/y/width per the schema. */
  cameo: boolean;
  /** Insert the draw command after this many existing commands. */
  afterStep: number;
}

export function portraitInsert(playlist: Playlist, choice: PortraitChoice): Playlist {
  const items = itemsOf(playlist);
  const spec = items[choice.part]?.spec;
  if (!spec) return playlist;
  spec.elements = spec.elements ?? [];
  spec.commands = spec.commands ?? [];
  const n = spec.elements.filter((e) => e.type === "portrait").length + 1;
  const id = `portrait_${n}`;
  const placement = choice.cameo ? { cameo: true } : { x: 170, y: 550, width: 170 };
  spec.elements.push({ id, type: "portrait", ...placement, ...choice.source } as SpecElement);
  const at = Math.max(0, Math.min(choice.afterStep, spec.commands.length));
  spec.commands.splice(at, 0, { draw: id } as never);
  return playlist;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/portrait-insert.test.ts`
Expected: PASS, 5 assertions.

- [ ] **Step 5: Build the dialog and the menu**

Add `openInsertPortrait(deps)` to `src/ui/insert.ts`: a `createModal("Insert portrait", { size: "s" })` with three radios (By name / Image URL / From file), a part `<select>` defaulting to the part being viewed, a Place select (Cameo / Corner), an after-step number, and `Insert` in `footer`.

Keep the **eager resolution** from `main.ts:2971–2985` — resolve before inserting so a misspelled name fails loudly now. Keep `traceFromBlob` for the file path (`main.ts:3016–3030`); it is the only path with no other entry point.

Replace `portraitBtn` in the spec bar with `createMenu("＋ Insert", [{ label: "Portrait…", onSelect: openInsertPortrait }])`. One item today, so per Task 3 it renders as a plain `＋ Insert Portrait…` button until `Source…` joins it.

The 222-character explanation currently in `portraitBtn`'s `title=` moves into the dialog as visible text — **that is the point**; touch never showed it.

- [ ] **Step 6: Verify the window.prompt is gone**

Append to `tests/shell-css.test.ts`:

```ts
it("no longer asks for a portrait through a raw browser prompt", async () => {
  const src = await read2(new URL("../src/main.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/window\.prompt\("Portrait/);
});
```

- [ ] **Step 7: Run the whole suite and commit**

```bash
npm test
git add src/ui/insert.ts src/main.ts tests/
git commit -m "Insert a portrait where you meant it to go"
git push origin main
```

---

### Task 8: Open ▾ and Save ▾

**Spec:** §4. Kills the `⬆`-means-two-things collision.

**Files:**
- Modify: `src/main.ts:555–577` (buttons), `:805–823` (bar)
- Test: `tests/shell-css.test.ts` (extend)

**Interfaces:**
- Consumes: `createMenu` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```ts
it("has no icon-only download/upload buttons left in the spec bar", async () => {
  const src = await read2(new URL("../src/main.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/class:\s*"icon-only"[^)]*"⬇"/);
  expect(src).not.toMatch(/class:\s*"icon-only"[^)]*"⬆"/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/shell-css.test.ts -t "icon-only download"`
Expected: FAIL — both still exist at `main.ts:555–557`.

- [ ] **Step 3: Replace with menus**

```ts
const openMenu = createMenu("Open", [
  { label: "From disk…", onSelect: () => importInput.click() },
  { label: "From Google Drive…", onSelect: () => void openFromDrive(), hidden: !pickerConfigured() },
], { title: "Open a drawcast" });

const saveMenu = createMenu("Save", [
  { label: "To disk…", onSelect: () => downloadSpec() },
  { label: "To Google Drive…", onSelect: () => void saveToDrive(), hidden: !googleConfigured() },
], { title: "Save this drawcast" });
```

`downloadSpec()` is the body of the old `exportBtn` handler, extracted as a named function. `importBtn` and `exportBtn` are deleted; `importInput` stays (it is the hidden file input).

- [ ] **Step 4: Assemble the bar in its three groups**

Replace the spec pane bar (`main.ts:805–823`):

```ts
      h(
        "div",
        { class: "pane-bar" },
        h("span", { class: "bar-group" }, formatSel, rerenderBtn),
        h("span", { class: "bar-group" }, insertMenu, pinPortraitsBtn),
        h("span", { class: "bar-group" }, openMenu, saveMenu),
        h("span", { class: "pane-spacer" }),
        shareBtn,
      ),
```

and add the group divider to `src/styles.css`:

```css
.bar-group { display: inline-flex; align-items: center; gap: 0.35rem; }
.bar-group + .bar-group {
  margin-left: 0.35rem;
  padding-left: 0.5rem;
  border-left: 1px solid var(--line);
}
```

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm test
git add src/main.ts src/styles.css tests/shell-css.test.ts
git commit -m "Open and Save are menus, so the up arrow means one thing"
git push origin main
```

---

### Task 9: Settings in four tabs

**Spec:** §9.

**Files:**
- Modify: `src/store.ts` (add `SETTINGS_TABS`), `src/main.ts:1103–1181`
- Test: `tests/settings-tabs.test.ts` (create)

**Interfaces:**
- Consumes: `createTabs` (`ui/modal.ts`), `createModal` with `size: "m"` (Task 5 already converted Settings).
- Produces: `export const SETTINGS_TABS: { id: string; label: string; fields: string[] }[]` from `src/store.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/settings-tabs.test.ts
import { describe, expect, it } from "vitest";
import { SETTINGS_TABS } from "../src/store";

const tabOf = (field: string) => SETTINGS_TABS.find((t) => t.fields.includes(field))?.id;

describe("SETTINGS_TABS", () => {
  it("has four tabs, keys first", () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual(["keys", "playback", "publishing", "advanced"]);
  });

  it("files skip-questions and burn-captions under playback, not under the\n     text-to-speech KEY they were nested beneath", () => {
    expect(tabOf("skipQuestions")).toBe("playback");
    expect(tabOf("burnCaptions")).toBe("playback");
    expect(tabOf("cloudPlayback")).toBe("playback");
  });

  it("keeps the two keys together", () => {
    expect(tabOf("apiKey")).toBe("keys");
    expect(tabOf("ttsKey")).toBe("keys");
  });

  it("puts the GitHub trio under publishing", () => {
    for (const f of ["githubRepo", "githubToken", "coursesDir"]) expect(tabOf(f)).toBe("publishing");
  });

  it("puts backup with developer mode under advanced", () => {
    expect(tabOf("backup")).toBe("advanced");
    expect(tabOf("developerMode")).toBe("advanced");
  });

  it("files every field exactly once", () => {
    const all = SETTINGS_TABS.flatMap((t) => t.fields);
    expect(new Set(all).size).toBe(all.length);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/settings-tabs.test.ts`
Expected: FAIL — `SETTINGS_TABS` is not exported.

- [ ] **Step 3: Implement**

Add to `src/store.ts`:

```ts
/**
 * Which settings field belongs on which tab. A list rather than a lookup so
 * the order is the reading order, and a test can pin that "skip questions" no
 * longer lives under the text-to-speech KEY it had been nested beneath.
 */
export const SETTINGS_TABS: { id: string; label: string; fields: string[] }[] = [
  { id: "keys", label: "Keys", fields: ["apiKey", "ttsKey"] },
  { id: "playback", label: "Playback", fields: ["style", "voice", "rate", "cloudPlayback", "skipQuestions", "burnCaptions"] },
  { id: "publishing", label: "Publishing", fields: ["githubRepo", "githubToken", "coursesDir"] },
  { id: "advanced", label: "Advanced", fields: ["contactEmail", "developerMode", "backup"] },
];
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/settings-tabs.test.ts`
Expected: PASS, 6 assertions.

- [ ] **Step 5: Rebuild the Settings body around the tabs**

Wrap each existing `.settings-field` block in a `Map<string, HTMLElement>` keyed by the ids above, then build `createTabs(SETTINGS_TABS.map(t => ({ id: t.id, label: t.label, panel: h("div", { class: "tab-panel" }, ...t.fields.map(f => blocks.get(f)!)) })))`.

Every `.settings-note` string is preserved **verbatim**. No setting changes meaning.

- [ ] **Step 6: Move Backup in**

`backupBtn` (`ui/course.ts:113`) becomes an Advanced-tab field. Its handler moves with it; the course modal loses the button in Task 10.

- [ ] **Step 7: Run the whole suite and commit**

```bash
npm test
git add src/store.ts src/main.ts src/ui/course.ts tests/settings-tabs.test.ts
git commit -m "Settings in four tabs, and skip-questions escapes the key field"
git push origin main
```

---

### Task 10: The course modal's four regions

**Spec:** §8. Twelve controls in one row become four regions.

**Files:**
- Modify: `src/ui/course.ts:71`, `:96–121`, `:824–842`
- Test: `tests/course-panel.test.ts` (extend)

**Interfaces:**
- Consumes: `createModal` with `footer` (Task 4), Share with `subject: "course"` (Task 6), Backup's new home (Task 9).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `tests/course-panel.test.ts`:

```ts
describe("the course modal's regions", () => {
  it("no longer runs twelve controls in one bar", async () => {
    const src = await readFile(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    const bar = /class:\s*"pane-bar"\s*\},([^)]*)\)/.exec(src)?.[1] ?? "";
    const controls = bar.split(",").map((s) => s.trim()).filter(Boolean);
    expect(controls.length).toBeLessThanOrEqual(5);
  });

  it("has no second copy of the publish checkbox — Share asks it once", async () => {
    const src = await readFile(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    expect(src).not.toContain("with narration");
    expect(src).not.toContain("course-bake");
  });

  it("no longer offers an app-global backup from inside one course", async () => {
    const src = await readFile(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/⬇ Backup/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/course-panel.test.ts`
Expected: FAIL on all three.

- [ ] **Step 3: Move the picker into the head**

`createModal` takes the course picker and `＋ New` as head content. Add an optional `head?: HTMLElement[]` to `ModalOptions`, appended inside `.dialog-head` between the title and the `✕`:

```ts
const modal = createModal("🎓 Course", { size: "l", class: "course-modal", head: [courseSel, newBtn] });
```

- [ ] **Step 4: Reduce the working bar to four verbs**

```ts
    h("div", { class: "pane-bar" }, planBtn, reviseBtn, runBtn, cancelBtn, h("span", { class: "pane-spacer" }), cost),
```

`cancelBtn.hidden = true` becomes `cancelBtn.disabled = true` — it keeps its slot so the row stops reflowing under the cursor while the author works. `syncBusy()` toggles `disabled` instead of `hidden`.

- [ ] **Step 5: Move the rest to the footer**

```ts
  modal.footer.append(
    h("span", { class: "footer-left" }, undoBtn, matchBtn),
    saveBtn,
    shareBtn,
  );
```

`shareBtn` opens Share with `subject: "course"`; `publishBtn`, `bakeCb`, `bakeLabel` and `backupBtn` are deleted from this file. `undoBtn` and `matchBtn` keep their conditional appearance, but on the left where a reflow moves nothing anyone is aiming at.

**Do not touch** `runCourse`, `reviseCourse`, `matchLibrary`, the `inFlight` set or the per-lecture rows. The buttons change place, not wiring.

- [ ] **Step 6: Run the whole suite and commit**

```bash
npm test
git add src/ui/course.ts src/ui/modal.ts tests/course-panel.test.ts
git commit -m "The course modal grows four regions instead of one long row"
git push origin main
```

---

### Task 11: The sidebar's four sections

**Spec:** §5.

**Files:**
- Create: `src/ui/sidebar.ts`
- Modify: `src/store.ts` (`sidebarSections`), `src/main.ts:837–897`, `:2504–2557` (course grouping moves out)
- Test: `tests/sidebar-sections.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export interface SectionInput { library: { title: string; courseId?: string }[]; courses: { id: string; title: string }[]; examples: { title: string }[]; templates: { id: string }[] }
  export interface SectionModel { id: string; label: string; shown: number; total: number; open: boolean }
  export function sidebarSections(input: SectionInput, filter: string, openState: Record<string, boolean>): SectionModel[];
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/sidebar-sections.test.ts
import { describe, expect, it } from "vitest";
import { sidebarSections, type SectionInput } from "../src/ui/sidebar";

const input: SectionInput = {
  library: [{ title: "Ricardo on trade" }, { title: "Lecture 1", courseId: "c1" }, { title: "Lecture 2", courseId: "c1" }],
  courses: [{ id: "c1", title: "Causal inference" }],
  examples: [{ title: "Supply and demand" }, { title: "Ricardo" }],
  templates: [{ id: "t1" }],
};

describe("sidebarSections", () => {
  it("lists four sections in reading order", () => {
    expect(sidebarSections(input, "", {}).map((s) => s.id)).toEqual(["library", "courses", "examples", "templates"]);
  });

  it("keeps lectures out of the library — a course is not also a loose item", () => {
    const lib = sidebarSections(input, "", {})[0];
    expect(lib.total).toBe(1);
  });

  it("defaults library and examples open, courses and templates closed", () => {
    const open = Object.fromEntries(sidebarSections(input, "", {}).map((s) => [s.id, s.open]));
    expect(open).toEqual({ library: true, courses: false, examples: true, templates: false });
  });

  it("honours a remembered state over the default", () => {
    const open = Object.fromEntries(sidebarSections(input, "", { courses: true, library: false }).map((s) => [s.id, s.open]));
    expect(open.courses).toBe(true);
    expect(open.library).toBe(false);
  });

  it("auto-expands a closed section that has matches — a hit inside a closed\n     section is a hit that does not exist", () => {
    const courses = sidebarSections(input, "causal", {}).find((s) => s.id === "courses")!;
    expect(courses.open).toBe(true);
    expect(courses.shown).toBe(1);
  });

  it("reports shown-of-total while filtering", () => {
    const ex = sidebarSections(input, "ricardo", {}).find((s) => s.id === "examples")!;
    expect([ex.shown, ex.total]).toEqual([1, 2]);
  });

  it("does not auto-expand a section with no matches", () => {
    expect(sidebarSections(input, "zzz", {}).find((s) => s.id === "courses")!.open).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/sidebar-sections.test.ts`
Expected: FAIL — cannot resolve `../src/ui/sidebar`.

- [ ] **Step 3: Implement the pure part**

```ts
// src/ui/sidebar.ts
// Four sections, all built the same way. Courses come out of the library —
// nesting them there made a course both a library item and not one — and every
// section can be closed, because a menu that only grows is a menu you scroll.

export interface SectionInput {
  library: { title: string; courseId?: string }[];
  courses: { id: string; title: string }[];
  examples: { title: string }[];
  templates: { id: string }[];
}

export interface SectionModel {
  id: string;
  label: string;
  /** Matching the filter. Equals `total` when there is no filter. */
  shown: number;
  total: number;
  open: boolean;
}

/** Library and Examples are what you reach for; four open lists is a tall menu. */
const DEFAULT_OPEN: Record<string, boolean> = { library: true, courses: false, examples: true, templates: false };

export function sidebarSections(input: SectionInput, filter: string, openState: Record<string, boolean>): SectionModel[] {
  const f = filter.trim().toLowerCase();
  const match = (t: string): boolean => f === "" || t.toLowerCase().includes(f);
  const specs: { id: string; label: string; titles: string[] }[] = [
    { id: "library", label: "📚 Library", titles: input.library.filter((i) => !i.courseId).map((i) => i.title) },
    { id: "courses", label: "🎓 Courses", titles: input.courses.map((c) => c.title) },
    { id: "examples", label: "✨ Examples", titles: input.examples.map((e) => e.title) },
    { id: "templates", label: "✦ Templates", titles: input.templates.map((t) => t.id) },
  ];
  return specs.map(({ id, label, titles }) => {
    const shown = titles.filter(match).length;
    const remembered = openState[id] ?? DEFAULT_OPEN[id];
    // A filter overrides the remembered state only upwards: it opens a closed
    // section that has hits, and never closes one the author opened.
    return { id, label, shown, total: titles.length, open: f !== "" && shown > 0 ? true : remembered };
  });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/sidebar-sections.test.ts`
Expected: PASS, 7 assertions.

- [ ] **Step 5: Add the setting**

In `src/store.ts`, add to `Settings` after `sidebarOpen`:

```ts
  /** Sidebar sections that are open, by id. Absent = that section's default. */
  sidebarSections: Record<string, boolean>;
```

and `sidebarSections: {},` to `DEFAULT_SETTINGS`.

- [ ] **Step 6: Build the sections**

Each section is a `<details>` whose `<summary>` carries the label, the count (`3 of 12` while filtering, `(12)` otherwise) and the caret. `toggle` writes `settings.sidebarSections[id]` and calls `persist()`.

- **Courses** is new: a row per `SavedCourse` (`store.ts:312–333`) opening the course panel, with the caret expanding that course's lectures inline — reuse the grouping logic being deleted from `refreshLibrary` (`main.ts:2530–2556`). A `＋ New course` row ends the section and replaces the old `🎓 Course` tool row.
- **Templates** lists `loadMyTemplates()` with a `Manage…` row into the existing four-tab modal, which is otherwise unchanged.
- The footer keeps Instructions, Data, Help, Sign in and Settings, with a quieter style:

```css
.sidebar-tools .sidebar-row { font-size: 0.85rem; color: var(--muted); }
.sidebar-tools .sidebar-row:hover { color: var(--ink); }
```

- [ ] **Step 7: Run the whole suite and commit**

```bash
npm test
git add src/ui/sidebar.ts src/store.ts src/main.ts src/styles.css tests/sidebar-sections.test.ts
git commit -m "Four sections in the menu, and courses get their own"
git push origin main
```

---

### Task 12: The phone — sheets, the folded player bar, preview first

**Spec:** §10.3 (third bullet), §10.4. Last because every piece of it is now CSS over structure that already exists.

**Files:**
- Modify: `src/styles.css`, `src/ui/controls.ts:730–743`
- Test: `tests/shell-css.test.ts` (extend)

**Interfaces:**
- Consumes: `createMenu` (Task 3), `.dialog-footer` (Task 4), the bar groups (Task 8).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

```ts
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
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/shell-css.test.ts -t "phone"`
Expected: FAIL on all three.

- [ ] **Step 3: Preview first**

Into the existing `@media (max-width: 940px)` block at `styles.css:292`:

```css
  /* The drawing is what you came to see; the spec textarea has a 320px
     min-height, so leaving it first buries the figure below the fold. */
  .editor-preview { order: -1; }
```

- [ ] **Step 4: Bottom sheets**

```css
/* Phones: a centred box with a 25px ✕ is the worst version of a dialog. A
   sheet pinned to the bottom puts the footer's primary action under the thumb
   that is already there. */
@media (max-width: 560px) {
  dialog {
    width: 100vw;
    max-width: 100vw;
    max-height: 88vh;
    margin-bottom: 0;
    margin-top: auto;
    border-radius: 12px 12px 0 0;
    border-bottom: none;
    padding: 1rem;
  }
  .modal-s .dialog-body, .modal-m .dialog-body, .modal-l .dialog-body { max-height: 66vh; }
  .share-split, .insert-split { grid-template-columns: 1fr; }
}
```

- [ ] **Step 5: Fold the player bar**

Give `theaterBtn` the class `cs-theater` (`ui/controls.ts:717`), then hide it and fold the secondary controls:

```css
@media (max-width: 780px) {
  .cs-theater { display: none; }
}
```

In `ui/controls.ts:730–743`, put `modeSel`, `speedSel`, the mute button and the CC button behind a `createMenu("⋯", …)` when `window.matchMedia("(max-width: 560px)").matches`, leaving **play · progress · fullscreen** inline. Build both arrangements from the same control instances so nothing is duplicated.

- [ ] **Step 6: Sweep the tooltip debt**

47 controls carry a `title=` that touch never shows. For every control that survives this plan with an icon-only label, either give it visible text or move its explanation into the dialog it opens. `📌` is the one permitted survivor:

```css
@media (hover: none) {
  .pin-btn::after { content: " Pin images"; font-size: 0.78rem; }
}
```

- [ ] **Step 7: Run the whole suite and commit**

```bash
npm test
git add src/styles.css src/ui/controls.ts tests/shell-css.test.ts
git commit -m "Sheets, a folded player bar, and the drawing above the fold"
git push origin main
```

- [ ] **Step 8: Check it on a real phone**

Open the deployed build on a phone and walk: play a drawcast, scrub, open `⋯`, go fullscreen, answer a question, then switch to the editor, open Share, open Settings. Nothing in the suite can catch a 44px target that is still too small in practice.

---

## Self-Review

**Spec coverage:**

| Spec § | Task |
|---|---|
| §1 the rule | enforced by Task 6 step 7 and Task 10 step 1 (`with narration` once) |
| §2 Share | 6 |
| §3 Insert / portrait | 7 |
| §4 Open / Save | 8 |
| §5 sidebar | 11 |
| §6 consistency pass | 2 (sizes, `--bar-h`), 8 (`.bar-group`) |
| §7 modal scale + anatomy | 4, 5 |
| §8 course modal | 10 |
| §9 Settings | 9 |
| §10.2 idle/gate | 1 |
| §10.3 player touch | 2, 12 |
| §10.4 editor touch | 2, 12 |

**Known gap, deliberate:** §7's "one panel treatment" for the two editor panes is folded into Task 2's CSS rather than given a step of its own — it is three declarations, not a deliverable.

**Type consistency:** `ShareTo` is declared in `store.ts` and imported by `share.ts` (Task 6 step 5), not the reverse — `store.ts` is imported by the standalone viewer and must not pull in UI code. `SectionModel.shown`/`total` are used with those names in Task 11 steps 1, 3 and 6. `shouldIdle` takes `{ playing, gateOpen }` in both Task 1 steps 2 and 6.
