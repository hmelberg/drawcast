# Pane Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pane: controls` on a code element draws the script's controls in the code pane (knobs at their defaults, exported in the movie) and, while paused, mounts the tray's live controls group over that drawn panel; an `explore-invite` lint keeps every "slide it / press it" line inside an explore beat; four bundled examples become two-part playlists — a drawn theory part, then the interactive code part.

**Architecture:** One new pure layout module draws the panel rows from the default-rewritten script (same data the code pane uses, so a re-run moves the knob by relayout). The tray's inline controls-group builder is extracted into a shared function with two hosts: the tray and a new in-place card positioned over the pane exactly like the editor card. Lint and prompt learn `pane` and the invitation rule. Examples switch to playlists (multi-document YAML, `---` separated, a `playlist:` header).

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), vitest (no jsdom: pure tests + source pins), the existing code-pane layout, editor-card mount and tray. Netlify runs `npm test && npm run build`.

**Spec:** `docs/superpowers/specs/2026-09-14-pane-controls-design.md` (addendum to `2026-09-14-code-controls-design.md`)

## Global Constraints

- The movie rule (spec §2): drawables export, live controls never; the invitation lives only in an explore beat's `speak`; no element or line sniffs the mode.
- `pane` is `"code" | "controls"`, default `"code"`; meaningful only with `show: left | right | above | below | code`; with `show: output`/`none` it is a lint warning and ignored; `pane: controls` without a non-empty `controls` is a lint error; `lines`/`marks` with `pane: controls` warn and are ignored.
- Drawn panel ids: `<id>_ctl_<name>` per control (a group), `<id>_ctls` for the whole panel; no `<id>_line_N` in this mode; `ctx.panes[id]` is set to the pane rectangle.
- The in-place card hosts the SAME controls group as the tray (one builder, one state: `controlValues`, `runControls`, `takenOver`, `clearPreview`).
- Schema stays anyOf-free. Every prompt/schema change re-pins BOTH constants in `tests/prompt-size.test.ts` with a dated note.
- `npx tsc --noEmit` clean and `npm test` green before every commit; commit messages end with the session's attribution lines (see `git log`).

---

### Task 1: Spec surface — `pane`, its lint, the `explore-invite` lint, prompt, pins

**Files:**
- Modify: `src/spec/types.ts` (code element fields, after `autorun`)
- Modify: `src/spec/schema.ts` (properties after `autorun`; `case "code":` validator)
- Modify: `src/lint/lint.ts` (`LintIssue.rule` union; `lintCode`; `lintCommands`)
- Modify: `src/llm/prompts/compiler-v1-code.md` (the controls bullet), `src/llm/prompts/compiler-v1.md` (the `explore` verb line)
- Modify: `tests/prompt-size.test.ts` (re-pin), `tests/code-element.test.ts` (schema), `tests/examples-style.test.ts` (ratchet)
- Create: `tests/pane-lint.test.ts`, `tests/explore-invite-lint.test.ts`

**Interfaces:**
- Produces: `SpecElement.pane?: "code" | "controls"`; lint rules `"pane"` and `"explore-invite"`; `export const INVITE_RE: RegExp` and `export function isInvitation(text: string): boolean` in `src/lint/invite.ts` (new, dependency-free, reused by the examples-style ratchet).

- [ ] **Step 1: Failing tests**

`tests/pane-lint.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const spec = (el: object, commands: object[] = [{ draw: ["sim"] }]): Spec =>
  ({ elements: [{ id: "sim", type: "code", language: "python", code: "n = (1, 50)\nprint(n)", controls: ["n"], ...el }], commands }) as unknown as Spec;
const rules = (s: Spec) => lintCommands(s).filter((i) => i.rule === "pane");

describe("pane — schema", () => {
  test("code | controls accepted; junk rejected", () => {
    expect(validateSpec(spec({ show: "left", pane: "controls" })).ok).toBe(true);
    expect(validateSpec(spec({ show: "left", pane: "code" })).ok).toBe(true);
    expect(validateSpec(spec({ show: "left", pane: "knobs" })).ok).toBe(false);
  });
});

describe("pane — lint", () => {
  test("controls pane on a side is clean", () => {
    expect(rules(spec({ show: "left", pane: "controls" }))).toEqual([]);
  });
  test("pane with show output or none warns", () => {
    expect(rules(spec({ show: "output", pane: "controls" }))[0]).toMatchObject({ severity: "warn", ids: ["sim"] });
    expect(rules(spec({ show: "none", pane: "controls" }))[0]).toMatchObject({ severity: "warn" });
  });
  test("pane: controls without controls is an error", () => {
    expect(rules(spec({ show: "left", pane: "controls", controls: [] }))[0]).toMatchObject({ severity: "error" });
    expect(rules(spec({ show: "left", pane: "controls", controls: undefined }))[0]).toMatchObject({ severity: "error" });
  });
  test("lines or marks with pane: controls warn", () => {
    expect(rules(spec({ show: "left", pane: "controls", lines: 4 }))[0]).toMatchObject({ severity: "warn", message: expect.stringContaining("lines") });
    expect(rules(spec({ show: "left", pane: "controls", marks: ["n"] }))[0]).toMatchObject({ severity: "warn", message: expect.stringContaining("marks") });
  });
});
```

`tests/explore-invite-lint.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { isInvitation } from "../src/lint/invite";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";

const spec = (commands: object[]): Spec =>
  ({ elements: [{ id: "t", type: "text", text: "hi", x: 500, y: 375 }], commands }) as unknown as Spec;
const rules = (s: Spec) => lintCommands(s).filter((i) => i.rule === "explore-invite");

describe("isInvitation", () => {
  test("invitation words at a clause start trip", () => {
    for (const t of ["Slide the rate down.", "Now drag the knob.", "Press Draw again.", "Try it: click a square.", "Toggle the log scale.", "Set the rate to zero.", "Dra i glidebryteren.", "Trykk på knappen.", "Prøv selv."]) {
      expect(isInvitation(t), t).toBe(true);
    }
  });
  test("narration about the mechanism does not trip", () => {
    for (const t of ["Try to guess where the peak lands.", "The slide rule was invented in 1622.", "Pressure rises with depth.", "A landslide moves the mass.", "We set the seed once."]) {
      expect(isInvitation(t), t).toBe(false);
    }
  });
});

describe("explore-invite lint", () => {
  test("an ordinary speak that invites interaction warns", () => {
    const [i] = rules(spec([{ draw: ["t"], speak: "Now slide the rate down and watch." }]));
    expect(i).toMatchObject({ severity: "warn" });
    expect(i.message).toContain("explore");
  });
  test("the same line in an explore beat is fine", () => {
    expect(rules(spec([{ draw: ["t"] }, { explore: { params: ["x"] }, speak: "Now slide the rate down and watch." }]))).toEqual([]);
  });
  test("a standalone speak is checked too", () => {
    expect(rules(spec([{ draw: ["t"] }, { speak: "Press the button." }]))).toHaveLength(1);
  });
});
```

Append to `tests/code-element.test.ts` (schema describe): `pane: "controls"` accepted with `show: "left"`.

- [ ] **Step 2: Run** — `npx vitest run tests/pane-lint.test.ts tests/explore-invite-lint.test.ts` — FAIL.

- [ ] **Step 3: Types + schema**

`src/spec/types.ts`, after `autorun`:
```ts
  /** code: what the pane holds — code (default: the script's lines) or controls (the
   *  script's `controls` drawn as knobs and switches, live while paused; the movie
   *  shows them at their defaults). Use with show: left/right/above/below. */
  pane?: "code" | "controls";
```
`src/spec/schema.ts`, after `autorun`:
```ts
    pane: {
      type: "string",
      enum: ["code", "controls"],
      description:
        "code: what the pane holds — code (THE DEFAULT: the script's lines) or controls (the script's `controls` drawn as knobs and switches — a slider as a track with a knob, a choice as chips, a toggle as a switch — live while paused; the movie shows them at their defaults). Use with show: left/right/above/below when the viewer should see the knobs, not the code.",
    },
```
No validator change (ajv's enum covers it).

- [ ] **Step 4: `src/lint/invite.ts`**

```ts
// The invitation words: a narration line that tells the viewer to act. Such a
// line belongs in an explore beat's speak — the movie skips that beat whole
// (export/video.ts) — never in an ordinary speak, which the movie says too
// (design 2026-09-14-pane-controls §2 rule 3, §5). Whole words, at the start
// of a clause or after "now"/"try"/"then", English and Norwegian. Kept
// dependency-free so the lint and the examples-style ratchet share it.
const WORDS = [
  "slide", "drag", "press", "click", "toggle", "move the slider", "turn the (?:knob|dial)", "set the \\w+ to", "try it",
  "dra", "trykk", "klikk", "skyv", "prøv selv", "prøv å (?:dra|trykke|klikke|skyve)",
];
export const INVITE_RE = new RegExp(`(?:^|[.!?:;—-]\\s*|\\b(?:now|then|try)\\s+)(?:${WORDS.join("|")})\\b`, "i");

export function isInvitation(text: string): boolean {
  return INVITE_RE.test(text);
}
```
(Check the negative cases from the test: "Try to guess" — `try\s+to` is not in WORDS, and "guess" is not a word; "The slide rule" — "slide" follows "The", not a clause start; "Pressure" — `\b` after "press" fails; "landslide" — no clause start before "slide"; "We set the seed once." — "set the \w+ to" needs "to".)

- [ ] **Step 5: Lint rules**

`LintIssue.rule` gains `| "pane"` (doc: `/** pane: controls without controls, or a pane on show: output/none, or lines/marks on a controls pane */`) and `| "explore-invite"` (doc: `/** an ordinary speak that tells the viewer to slide/press/click — belongs in an explore beat */`).

In `lintCode(spec)`, after the controls block:
```ts
  for (const el of els) {
    if (el.pane === undefined) continue;
    const shown = el.show ?? "output";
    if (shown === "output" || shown === "none") {
      issues.push({ rule: "pane", ids: [el.id], message: `code "${el.id}": pane has no effect with show: "${shown}" — the pane sits on a side (left/right/above/below/code)`, severity: "warn" });
    }
    if (el.pane === "controls") {
      if (!el.controls || el.controls.length === 0) {
        issues.push({ rule: "pane", ids: [el.id], message: `code "${el.id}": pane: controls needs a non-empty controls list`, severity: "error" });
      }
      if (el.lines !== undefined) issues.push({ rule: "pane", ids: [el.id], message: `code "${el.id}": lines is ignored with pane: controls (there are no code lines to window)`, severity: "warn" });
      if (el.marks !== undefined) issues.push({ rule: "pane", ids: [el.id], message: `code "${el.id}": marks is ignored with pane: controls (there are no code lines to mark)`, severity: "warn" });
    }
  }
```
In `lintCommands(spec)`, in the loop that calls `flagVars(c.speak, …)` (search `flagVars(c.speak`), add:
```ts
    if (typeof c.speak === "string" && c.explore === undefined && isInvitation(c.speak)) {
      issues.push({
        rule: "explore-invite",
        ids: [],
        message: `commands[${i}].speak invites the viewer to interact ("${c.speak.slice(0, 40)}…") — the movie will say it too; put the invitation in an explore beat's speak`,
        severity: "warn",
      });
    }
```
Import `isInvitation` from `./invite`.

- [ ] **Step 6: Prompt**

`compiler-v1-code.md`, append to the controls bullet: ` When the viewer should see the knobs rather than the code, add \`"pane": "controls"\` (with show: left/right/above/below): the pane draws the controls at their defaults and they come alive while paused. Any line that tells the viewer to slide, press, drag or try something belongs in an \`explore\` beat's \`speak\` — the movie skips that beat whole — never in an ordinary speak.`
`compiler-v1.md`, on the `explore` verb line, append one clause: ` — and the ONLY place a line may tell the viewer to slide, press or try something (the movie skips the whole beat; an ordinary speak plays in the movie too).`

- [ ] **Step 7: Ratchet + pins**

`tests/examples-style.test.ts`: add a third ratchet mirroring the two existing ones: count, over every spec of every example, ordinary (non-explore) commands whose `speak` is an invitation (`isInvitation` from `../src/lint/invite`); `const INVITE_BASELINE = <measured>;` (expected 0 — if not, list the offenders in the failure message and fix them in Task 4, then pin 0). `tests/prompt-size.test.ts`: run, read the measured sizes, re-pin both constants with a dated note ("2026-09-14 pane-controls round: `pane` description +N on the schema and the system prompt; the explore clause +M on the system prompt only").

- [ ] **Step 8: Run** — `npx vitest run tests/pane-lint.test.ts tests/explore-invite-lint.test.ts tests/code-element.test.ts tests/prompt-size.test.ts tests/examples-style.test.ts tests/code-controls-lint.test.ts && npx tsc --noEmit` — PASS. Then `npm test`.

- [ ] **Step 9: Commit** — `git add -A src/spec src/lint src/llm/prompts tests && git commit -m "Pane controls: the pane field, its lint, the explore-invite lint, prompt sentences, pins (Task 1)"`

---

### Task 2: The drawn control panel

**Files:**
- Create: `src/layout/code-controls-pane.ts`
- Modify: `src/layout/code.ts` (the code-pane content block around `sourceLines`/`codeStack`/`codeContentH`, and the "code lines" drawable block)
- Test: `tests/code-pane-controls.test.ts`

**Interfaces:**
- Consumes: `parseControls`, `withControlDefaults`, `ControlSpec` from `src/code/controls.ts`; `Drawable`, `Pt` from `src/layout/model.ts`; `resolveStyle`/`resolveDrawOpts` as `chromeDrawables` uses them in `code.ts`.
- Produces:
  ```ts
  export interface ControlsPaneLayout { drawables: Drawable[]; order: string[]; height: number; anchors: Record<string, Pt> }
  /** Rows for `el.controls` parsed from `code` (default-rewritten), laid out in the pane box: x = left edge of the content area, top = y of its top edge (logical, y-up), w = content width. */
  export function controlsPane(id: string, language: string, code: string, names: string[], box: { x: number; top: number; w: number }, fontSize: number, style: SpecElement["style"], draw: SpecElement["draw"]): ControlsPaneLayout;
  export const CTL_ROW_H = 1.9; // × fontSize, a little airier than a code line
  ```

- [ ] **Step 1: Failing tests**

```ts
// tests/code-pane-controls.test.ts
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import { controlsPane, CTL_ROW_H } from "../src/layout/code-controls-pane";
import type { Spec } from "../src/spec/types";

const OK = JSON.stringify({ ok: true, stdout: "42", stderr: "", figures: [] });
const spec = (el: object): Spec =>
  ({ elements: [{ id: "sim", type: "code", language: "python", show: "left", width: 900, pane: "controls", code_result: OK, ...el }], commands: [{ draw: ["sim"] }] }) as unknown as Spec;
const ids = (s: Spec) => flattenDrawables(layoutSpec(s, heuristicMeasure).drawables).map((d) => d.id);

describe("controlsPane (pure)", () => {
  const code = "n = (1, 50)\nmodel = [\"SIR\", \"SEIR\"]\nlog = False\nname = \"x\"\nroll = Button(\"Roll\")";
  const names = ["n", "model", "log", "name", "roll"];
  test("one row per control, in order, with the panel id and per-control groups", () => {
    const p = controlsPane("sim", "python", code, names, { x: 100, top: 600, w: 400 }, 17, undefined, undefined);
    expect(p.order).toEqual(["sim_ctls", "sim_ctl_n", "sim_ctl_model", "sim_ctl_log", "sim_ctl_name", "sim_ctl_roll"]);
    expect(p.height).toBeCloseTo(5 * 17 * CTL_ROW_H, 5);
  });
  test("a slider's knob sits at the default's fraction of the track", () => {
    const p = controlsPane("sim", "python", "n = (0, 100)", ["n"], { x: 0, top: 0, w: 500 }, 20, undefined, undefined);
    const knob = flattenDrawables(p.drawables).find((d) => d.id === "sim_ctl_n__knob") as StrokeDrawable;
    const track = flattenDrawables(p.drawables).find((d) => d.id === "sim_ctl_n__track") as StrokeDrawable;
    const tx0 = Math.min(...track.pts.map((q) => q[0]));
    const tx1 = Math.max(...track.pts.map((q) => q[0]));
    const kx = knob.pts.reduce((a, q) => a + q[0], 0) / knob.pts.length;
    expect((kx - tx0) / (tx1 - tx0)).toBeCloseTo(0.5, 1); // default 50 of 0..100
    const val = flattenDrawables(p.drawables).find((d) => d.id === "sim_ctl_n__value") as TextDrawable;
    expect(val.text).toBe("50");
  });
  test("a rewritten value moves the knob", () => {
    const p = controlsPane("sim", "python", "n = 90", ["n"], { x: 0, top: 0, w: 500 }, 20, undefined, undefined);
    // a bare number is a number field — drawn as a boxed value, no track
    expect(flattenDrawables(p.drawables).some((d) => d.id === "sim_ctl_n__track")).toBe(false);
    expect((flattenDrawables(p.drawables).find((d) => d.id === "sim_ctl_n__value") as TextDrawable).text).toBe("90");
  });
  test("choice chips: the default is filled", () => {
    const p = controlsPane("sim", "python", "m = [\"a\", \"b\"]", ["m"], { x: 0, top: 0, w: 500 }, 20, undefined, undefined);
    const chips = flattenDrawables(p.drawables).filter((d) => d.id.startsWith("sim_ctl_m__chip_"));
    expect(chips.map((d) => d.id)).toEqual(["sim_ctl_m__chip_0", "sim_ctl_m__chip_1"]);
    expect(chips[0].kind).toBe("area"); // filled = chosen
    expect(chips[1].kind).toBe("stroke");
  });
});

describe("pane: controls in the panel layout", () => {
  test("mints _ctls and _ctl_<name>, no _line_N, and registers the pane box", () => {
    const s = spec({ controls: ["n", "log"], code: "n = (1, 50)\nlog = False\nprint(n)" });
    const all = ids(s);
    expect(all).toContain("sim_ctls");
    expect(all).toContain("sim_ctl_n");
    expect(all).toContain("sim_ctl_log");
    expect(all.some((i) => /^sim_line_\d+$/.test(i))).toBe(false);
    expect(all).toContain("sim_out");
    expect(layoutSpec(s, heuristicMeasure).panes?.sim).toBeDefined();
  });
  test("pane: code (or absent) still draws lines", () => {
    expect(ids(spec({ pane: "code", controls: ["n"], code: "n = (1, 50)\nprint(n)" }))).toContain("sim_line_1");
  });
});
```

- [ ] **Step 2: Run** — FAIL (module missing).

- [ ] **Step 3: The module**

`src/layout/code-controls-pane.ts` — rows from `parseControls(language, withControlDefaults(language, code, names), names)` — NOTE: parse the DEFAULT-REWRITTEN text (so after a run the knob follows), and treat the parse of the rewritten text as follows: a rewritten slider is a bare number (kind `number`) — so to draw a TRACK the row needs the ORIGINAL literal's min/max. Therefore parse twice: `orig = parseControls(language, code, names).controls` for kinds/ranges/options, and `cur = parseControls(language, withControlDefaults(language, code, names), names).controls` for the current value (`cur[i].default`). Match by name. Per row (y from `top`, stepping `fontSize * CTL_ROW_H` downward; label column width `labelW = Math.min(0.32 * w, 9 * fontSize * 0.6)`; content starts at `x + labelW + PAD`; PAD = 10):
- label: `TextDrawable` `${id}_ctl_${name}__label`, anchor "start", mono font as code lines (`fontFamily` as `code.ts` uses for lines).
- slider: `__track` stroke from `[cx, cy]` to `[cx + trackW, cy]` (trackW = `w - labelW - PAD - valueW - PAD`, valueW = `4 * fontSize * 0.6`), `__knob` a closed stroke circle (8 points, radius `0.28 * fontSize`) at `cx + trackW * (value - min) / (max - min)` with `shapeHint: {type: "circle"}` if the model has one (check `ShapeHint` in `model.ts`; else omit), `__value` text right-aligned (`anchor: "end"`) at `x + w`.
- choice: chips left to right: each `__chip_<k>` a rounded rect outline (stroke, closed, `shapeHint: rect`) with the option text `__chiptext_<k>` centred; the chosen one an `area` (filled, `precise: true`, low alpha via style) plus the same outline.
- toggle: `__pill` a closed stroke rect `2.2 * fontSize` wide, `__knob` a circle at the left (false) or right (true) end, `__value` text "off"/"on".
- text / number: `__box` a closed stroke rect around `__value` text (the value, for text in quotes).
- button: `__pill` closed rect with `__value` = caption, centred.
Each row's drawables go into a `GroupDrawable` (`kind: "group"`, id `${id}_ctl_${name}`, `children`) — copy the group shape `code.ts` uses for `<id>_out` (search `kind: "group"` there). The panel itself: `order` = `[`${id}_ctls`, ...rows]`, and `${id}_ctls` is a group of all rows (so `draw: [sim_ctls]` draws the panel at once, `draw: [sim_ctl_beta]` one row). Styles: `resolveStyle(style, {...})` for ink and `resolveDrawOpts(draw, { mode: "sketch", duration: SKETCH_MS.node })` as `chromeDrawables` does; text uses the code line style (copy from the `_line_` block). `anchors[`${id}_ctl_${name}`] = [x, cy]`.

- [ ] **Step 4: Wire into `code.ts`**

Where `showCode`/`sourceLines`/`codeStack` are computed: `const controlsPaneMode = el.pane === "controls" && show !== "output" && show !== "none" && (el.controls?.length ?? 0) > 0;`. If `controlsPaneMode`: `codeStack = { blocks: [], height: 0 }` and `codeContentH = pane.height` where `pane = controlsPane(el.id, el.language ?? "", el.code ?? "", el.controls!, { x: codeX + PAD, top: codeTop, w: codePaneW - 2 * PAD }, fontSize, el.style, el.draw)` — compute it AFTER `codeX`/`codeTop` are known (they depend on `codeContentH` for `show: below`: read how `codeTop` is derived; if it depends on `codeContentH`, compute the pane height first from the row count (`rows * fontSize * CTL_ROW_H`) and lay the rows out after `codeTop` is final — expose `controlsPaneHeight(count, fontSize)` from the module for that). In the "code lines" block: `if (showCode && !controlsPaneMode) { …existing… } else if (controlsPaneMode) { out.push(...pane.drawables); ctx.extraOrder.push(...pane.order); Object.assign(ctx.anchors, pane.anchors); }`. `ctx.panes[el.id]` is set exactly as for a code pane (`codeContentH` = panel height). `marks`/`lines` are ignored in this mode (the lint warns).

- [ ] **Step 5: Run** — `npx vitest run tests/code-pane-controls.test.ts tests/code-element.test.ts tests/examples.test.ts && npx tsc --noEmit` — PASS; then `npm test`.

- [ ] **Step 6: Commit** — "Pane controls: the drawn control panel — a row per control from the default-rewritten script, knobs that follow a re-run by relayout (Task 2)"

---

### Task 3: The in-place controls card and one shared group builder

**Files:**
- Create: `src/ui/controls-group.ts` (the builder extracted from `tray.ts`)
- Create: `src/ui/controls-card.ts` (the in-place host, modelled on `src/ui/code-editor.ts`'s `mountCodeEditor`)
- Modify: `src/ui/tray.ts` (use the builder; mount the card from the paused click, the one-click path and the explore gate when `el.pane === "controls"`; teardown)
- Test: `tests/tray-controls.test.ts` (pins), `tests/controls-group.test.ts` (pure parts)

**Interfaces:**
- Produces:
  ```ts
  // controls-group.ts
  export interface ControlsGroupDeps {
    el: SpecElement; authoredCode: string; controls: ControlSpec[];
    values: () => Record<string, ControlValue>;
    commit: (c: ControlSpec, raw: string | boolean, immediate: boolean) => void;   // the tray's commit (nextValues + runControls)
    run: () => void;                                                              // the group's Run ▶ for autorun: false (runControls(el, controls, true, true))
    quiet: boolean;                                                               // takenOver
  }
  export function buildControlsGroup(d: ControlsGroupDeps): HTMLElement;        // the exact DOM the tray builds today
  // controls-card.ts
  export function mountControlsCard(stage: HTMLElement, opts: { id: string; paneBox: () => BBox | null; group: HTMLElement; onClose: () => void; onContinue: () => void }): { reposition(): void; close(): void } | null;
  ```

- [ ] **Step 1: Failing pins** (append to `tests/tray-controls.test.ts`)
```ts
  test("one controls-group builder, two hosts (tray and in-place card)", () => {
    const group = readFileSync("src/ui/controls-group.ts", "utf8");
    expect(group).toMatch(/export function buildControlsGroup\(/);
    expect(src).toMatch(/buildControlsGroup\(/);              // the tray uses it
    expect(src).toMatch(/mountControlsCard\(/);               // and mounts it in place
    expect(src).not.toMatch(/class: "cs-tray-ctl cs-tray-ctl-/); // the inline builder is gone from tray.ts
  });
  test("a pane: controls panel opens its card, not the editor, on a paused click", () => {
    expect(src).toMatch(/el\.pane === "controls"[\s\S]{0,400}?mountControlsCard\(/);
  });
  test("the card is torn down with the preview", () => {
    expect(src).toMatch(/const clearPreview[\s\S]{0,800}?controlsCards/);
  });
```
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Extract the builder** — move the body of the controls-group loop (from `const group = h("div", { class: "cs-tray-controls" …` through the `autorun === false` Run row) into `buildControlsGroup(d)`, replacing closure references with `d.values()`, `d.commit`, `d.run`, `d.quiet`, `d.el`, `d.controls`; the tray's loop becomes: parse (authored), compute `commit` (unchanged: `if (takenOver.has(id)) return; controlValues.set(id, nextValues(…)); runControls(el, controls, immediate)`), `const group = buildControlsGroup({...}); controlGroups.set(id, group); tray.appendChild(group);`.
- [ ] **Step 4: The card** — `mountControlsCard` positions an absolutely placed `div.cs-ctlcard` over `paneBox()` using the same `clientPointFor`/reposition logic as `mountCodeEditor` (read `src/ui/code-editor.ts`; reuse its positioning helper if exported, else copy the ~20 lines and say so in a comment). The card holds the group plus a small footer with "Continue ▶" (calls `onContinue`) and ✕ (`onClose`). It stops click propagation; Escape closes.
- [ ] **Step 5: Wire** — in `tray.ts`: `const controlsCards = new Map<string, { reposition(): void; close(): void }>()`; `openControlsInPlace(el)`: if `!stage || !visibleNow(el.id)` return false; if a card exists, reposition; else `mountControlsCard(stage, { id, paneBox: () => paneBoxOf(id), group: buildControlsGroup({...same deps, quiet: takenOver.has(id)}), onClose: () => controlsCards.delete(id), onContinue: continueNow })`; freeze the stage as `openInPlace` does. Call it: (a) in the paused-click handler where `openInPlace(el)` is chosen — `if (el.pane === "controls") { if (openControlsInPlace(el)) return; }` before it; (b) in the one-click playback path (Task 9 of the previous round) — after `hd.timeline.pause()`, if `el.pane === "controls"` call `openControlsInPlace(el)` (and still `open({ onCode: id })`); (c) in the explore gate's code branch: when the named script has `pane === "controls"`, call `openControlsInPlace` as well as opening the tray. `clearPreview`: close every card (`for (const c of controlsCards.values()) c.close(); controlsCards.clear();`). Reposition cards on reflow where editor cards are repositioned. The card and the tray group share `controlValues`; after a run, the drawn panel relayouts under the card (the card is HTML over it).
- [ ] **Step 6: CSS** — `.cs-ctlcard { position: absolute; z-index: 25; background: var(--paper); border: 1.5px solid var(--ink); border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px; padding: 0.4rem 0.6rem; }` and a footer row style; dark mode inherits the tray's softened border rule pattern (add `.cs-ctlcard` beside `.cs-paramtray` in the two dark selectors).
- [ ] **Step 7: Run** — `npx vitest run tests/tray-controls.test.ts tests/controls-model.test.ts && npx tsc --noEmit && npm test` — PASS.
- [ ] **Step 8: Commit** — "Pane controls: one controls-group builder, an in-place card over the drawn panel, wired to the paused click, the one-click path and the explore beat (Task 3)"

---

### Task 4: Examples as two-part playlists, help, roadmap, smoke

**Files:**
- Modify: `src/examples.json` (replace the four entries: SIR, Markov cohort, CE plane, discounting — find by `spec.title`; each becomes `{request, playlist}`; the `spec` key is removed), `public/help.html` (controls row + a `pane` sentence), `ROADMAP.md` (a new "Pane controls" section after "Code controls"), `docs/superpowers/plans/2026-09-14-pane-controls-smoke.md` (new)

**Constraints for every playlist:** a `playlist:` header document with `title`; part 1 is a drawn theory item (a template or freehand figure, narrated, no code); part 2 is the code item with `show: left`, `pane: controls`, `width: 900`, the SAME script as today, `draw` beats naming `<id>_ctls` (or single `<id>_ctl_<name>` rows when the narration names one knob) and `<id>_out`, and an `explore: {code: <id>}` beat carrying the invitation. No ordinary `speak` may be an invitation (the ratchet from Task 1 is at 0). Requests stay questions. Each part opens with a draw.

- [ ] **Step 1: The four playlists**

Write them as YAML playlist text (the `playlist` string), following the two existing playlist examples' shape (`grep -n '"playlist"' src/examples.json` for the methane and logistic-growth ones). Theory parts:
- **SIR** — freehand: three `node`s "Susceptible", "Infected", "Recovered" in a row (`x` 200/500/800, `y` 400) with two `edge`s S→I and I→R labelled "β · S · I" and "γ · I"; narration: the two rates, why new infections need both S and I. Part 2: the existing SIR script (`sir`), `pane: controls`, rows `sir_ctl_beta`, `sir_ctl_gamma`, `sir_ctl_days` named in narration, then `sir_out`, then explore.
- **Markov cohort** — template `markov_model` with the three states and the two transitions the script uses (`Well→Sick` label "p_sick", `Sick→Dead` label "p_dead", self-loops Well and Sick); narration: shares moving between states each cycle. Part 2: the `mk` script with `pane: controls`.
- **CE plane** — template `cost_effectiveness_plane` with one emphasised point (effect 0.25, cost 12000) and `wtp_threshold: 50000`; narration: the quadrants, the threshold line, "one point hides the uncertainty". Part 2: the `ce` script with `pane: controls`; explore: slide WTP, press Draw again.
- **Discounting** — freehand: `axes` (x "years", y "value today", domain x 0..50, y 0..1) and a `curve` with `expr: "1/(1.04)^x"` plus a `label` "4 % a year"; narration: geometric shrinking. Part 2: the `dc` script with `pane: controls` (`dc_ctl_rate`, `dc_ctl_horizon`), explore: rate to zero, then ten percent. Model the axes+curve on the existing example that has `"expr": "51 + 0.4*x"` (`grep -n '"expr": "51' src/examples.json`) for the exact field names.

Replace each entry's `spec` with a `playlist` string textually (the file has its own compact formatting: do NOT rewrite the whole file with `json.dumps` — locate each entry by title, cut from its opening `{` to its closing `}` at the same indent, and splice the new entry serialised with `json.dumps(entry, indent=2, ensure_ascii=False)` re-indented by two spaces; check `git diff --stat` shows only the four hunks).

- [ ] **Step 2: Gates** — `npx vitest run tests/examples.test.ts tests/examples-style.test.ts tests/pane-lint.test.ts tests/explore-invite-lint.test.ts tests/code-controls-lint.test.ts` — PASS with zero warnings; fix any unknown id by reading the layout's minted ids (`sir_ctl_beta` etc.), never by padding.
- [ ] **Step 3: Help** — in the controls row add: ` With <code>pane: controls</code> the pane draws the knobs instead of the code; they come alive while paused, and the movie shows them at their defaults. A line that invites the viewer to slide or press belongs in an <code>explore</code> beat — the movie skips it.`
- [ ] **Step 4: ROADMAP** — after the "Code controls" section: `## Pane controls and the movie rule — done 2026-09-…` summarising §2's five rules, `pane: controls`, the in-place card, the `explore-invite` lint, the four playlists; Open: a performed sweep as the panel's movie form (not built), Norwegian invitation words are a short list.
- [ ] **Step 5: Smoke** — `docs/superpowers/plans/2026-09-14-pane-controls-smoke.md`: (1) SIR playlist: part 1 draws S→I→R; part 2 draws three knob rows in the left pane, the explore beat stops with the card live over them; slide beta, the drawn knob moves after the re-run; Continue restores; (2) the movie export of SIR shows the drawn knobs at defaults and never speaks the invitation; (3) Markov, CE plane, discounting likewise; (4) a paused click on a `pane: controls` panel opens the card, ✕ closes it, Escape closes it; (5) the tray still lists the same group and both stay in sync; (6) lint panel: an ordinary speak "Now slide…" shows the explore-invite warning.
- [ ] **Step 6: Run** — `npm test && npx tsc --noEmit` — PASS.
- [ ] **Step 7: Commit** — "Pane controls: SIR, the Markov cohort, the CE plane and discounting as two-part playlists — a drawn theory part, then the knobs; help, roadmap, smoke (Task 4)"

---

### Task 5: Verification and push

- [ ] `npm test 2>&1 | tail -6 && npx tsc --noEmit && npm run build 2>&1 | tail -3`
- [ ] `git log --oneline main..HEAD` — four task commits (plus fix rounds).
- [ ] Merge to main (fast-forward), `git push origin main`, then poll Netlify (`netlify api listSiteDeploys --data '{"site_id":"abb0e02f-a8f0-4779-8e32-39bb83668600","per_page":1}'`) until `ready`.

## Self-review

- Spec §2 rules → Task 1 (lint + prompt) and Task 4 (examples obey them). §3.1 drawn panel → Task 2. §3.2 in-place mount + one state → Task 3. §3.3 explore → Task 3 (c). §3.4 one-click/autorun → Task 3 (b), builder. §4 model → Task 1. §5 lint → Task 1. §6 tests → each task. §8 examples → Task 4. §9 order → tasks 1–4.
- Names: `controlsPane`, `CTL_ROW_H`, `buildControlsGroup`, `mountControlsCard`, `openControlsInPlace`, `controlsCards`, `isInvitation`, `INVITE_RE` used consistently.
