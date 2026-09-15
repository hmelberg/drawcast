# Widget Keys and Examples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A widget body may declare `keys`; the host delivers `{type: "key", key, ms}` on key-up with the held duration; Morse works from the keyboard (Space short/long, Enter gap, Enter again sends); three more widget examples (xylophone, bubble sort, tic-tac-toe) join the pack; the two parked demo cosmetics are fixed.

**Architecture:** The event type union grows one member; the pure core (`stepWidget`, `runWidget`) already takes events as given, so only the type and the harness's click-string sugar change. The host gains window key listeners in the piano's free-play pattern, active only when the body declares keys. Everything else is template documents and examples.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), vitest in plain node (no jsdom), YAML template documents.

**Spec:** `docs/superpowers/specs/2026-09-14-widget-bodies-design.md` (§2.2 addendum 2026-09-15, §2.3, §5)

## Global Constraints

- A widget never draws; it patches declared params. `answer` means done (spec §2.2).
- The widget surface for clicks is the ringed top-level parts; keys are independent of geometry.
- Key listeners exist only for declared keys; undeclared keys pass through; typing in inputs/textareas/contenteditable is never captured; auto-repeat is ignored; while playing keys are ignored unless the open gate is the widget's own (`cs-widgetgate`).
- Nothing persists past play/step/scrub/Continue.
- Every new template: `status: ready`, `kit: 10`, an example in `src/examples.json` with `packs: ["widgets"]`, gate-clean (zero warnings, zero lint issues); demos must `patch` so the movie moves.
- Do not touch `src/ui/tray.ts`, `src/ui/tray-model.ts`, `src/layout/code.ts` or the code element (another branch owns them). Shared files (`examples.json`, `help.html`, `ROADMAP.md`, prompt pins) get small appends only.
- `npm test` + `npx tsc --noEmit` before each commit touching `src/`; attribution lines on every commit (copy from `git log -1 --format=%B`).
- Worktree `/Users/hom/Documents/GitHub/drawcast/.claude/worktrees/widgets-2`, branch `worktree-widgets-2`.

---

### Task 1: The `key` event — type, harness, host listeners, gate marker, author prompt

**Files:**
- Modify: `src/scenes/widget-types.ts` (WidgetEvent union; `WidgetBody.keys?`)
- Modify: `src/scenes/compile.ts` (accept `keys` on the probe: optional array of strings, else error)
- Modify: `src/scenes/widget-run.ts` (no logic change needed for events; add `keyEvent(key, ms)` sugar for tests)
- Modify: `src/ui/widget-host.ts` (`WidgetHost.keyPress(key, ms)`, window listeners in `attachWidgetHost`, `cs-widgetgate` on the gate)
- Modify: `src/llm/prompts/author-v1.md` (the widget section: the `key` event and `keys`)
- Test: `tests/widget-run.test.ts` (extend), `tests/widget-host.test.ts` (extend), `tests/widget-doc.test.ts` (extend)

**Interfaces:**
- Produces: `type WidgetEvent = { type: "click"; id; point; domain } | { type: "key"; key: string; ms: number }`; `WidgetBody.keys?: string[]`; `WidgetHost.keyPress(key: string, ms: number): boolean` (true when the body declares the key and ran); `keyEvent(key: string, ms: number): WidgetEvent` from `widget-run.ts`.

- [ ] **Step 1: Failing tests**

`tests/widget-doc.test.ts` — add:

```ts
  test("a body may declare keys; a non-array keys is a document error", () => {
    const ok = compileTemplateDoc({ ...base, widget: `return { init: () => 0, on: (e, s) => ({ state: s, effects: [] }), keys: [" ", "Enter"] };` } as TemplateDoc);
    expect(ok.errors).toEqual([]);
    expect(ok.module!.widget!().keys).toEqual([" ", "Enter"]);
    const bad = compileTemplateDoc({ ...base, widget: `return { init: () => 0, on: (e, s) => ({ state: s, effects: [] }), keys: "space" };` } as TemplateDoc);
    expect(bad.module).toBeUndefined();
    expect(bad.errors[0]).toMatch(/keys must be an array of strings/);
  });
```

`tests/widget-run.test.ts` — add a body that counts key presses by length and a test:

```ts
  test("a key event reaches on() with its held duration", () => {
    const keyed = compileTemplateDoc({ ...doc, widget: `
      const init = () => ({ s: "" });
      const on = (ev, st) => ev.type === "key" && ev.key === " " ? { state: { s: st.s + (ev.ms < 200 ? "." : "-") }, effects: [{ patch: { signal: st.s + (ev.ms < 200 ? "." : "-") } }] } : { state: st, effects: [] };
      return { init, on, keys: [" "] };` } as TemplateDoc).module!;
    const r = runWidget(keyed, {}, [keyEvent(" ", 80), keyEvent(" ", 300), "dot"]);
    expect(r.errors).toEqual([]);
    expect(r.states.at(-1)).toEqual({ s: ".-" });
    expect(r.params).toEqual({ signal: ".-" });
  });
```

`tests/widget-host.test.ts` — the fake doc gains `keys: [" "]` and a key branch (`" "` held < 200 → same as a dot click); add:

```ts
  test("keyPress delivers a key event to the body — mounting it if needed — and ignores undeclared keys", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd)!;
    expect(host.keyPress("x", 50)).toBe(false);
    expect(calls).toEqual([]);
    expect(host.keyPress(" ", 80)).toBe(true);
    expect(calls).toEqual(["beep 700 80", 'preview {"signal":"."}', "glow dot"]);
  });
```

Source pins (same file, the pins describe): the window `keydown`/`keyup` listeners exist and are installed only when `keys.length > 0`; keydown returns early on `e.repeat`; `preventDefault()` + `stopPropagation()` on a declared key; the typing guard `e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable)`; the playing guard reads `hd.timeline.state === "playing" && !stage.querySelector(".cs-widgetgate")`; self-cleaning `if (!stage.isConnected)`; the gate element carries `class: "cs-figgate cs-widgetgate"`.

- [ ] **Step 2: Run** — `npx vitest run tests/widget-doc.test.ts tests/widget-run.test.ts tests/widget-host.test.ts` — Expected: FAIL.

- [ ] **Step 3: Types and compile**

`widget-types.ts`:

```ts
export type WidgetEvent =
  | { type: "click"; id: string; point: Pt; domain: Pt | null }
  | { type: "key"; key: string; ms: number };
// WidgetBody:
  /** Keys the widget wants (DOM KeyboardEvent.key values); the host swallows
   *  them while paused and delivers one `key` event per release, with the held ms. */
  keys?: string[];
```

`compile.ts` probe: after the init/on check —

```ts
    const keys = (p as { keys?: unknown }).keys;
    if (keys !== undefined && (!Array.isArray(keys) || !keys.every((k) => typeof k === "string"))) {
      return { errors: [`template "${doc.template}" widget body: keys must be an array of strings`] };
    }
```

Update every `ev.id` / `ev.point` access in `src/` that assumed the click shape (grep `event.id`, `ev.id` in widget-run.ts / widget-host.ts) to narrow on `event.type === "click"`.

`widget-run.ts`: `export const keyEvent = (key: string, ms: number): WidgetEvent => ({ type: "key", key, ms });`

- [ ] **Step 4: Host**

In `widgetHostFor`: extract the mount-and-step code from `clickAt` into `const run = (sc: WidgetScene, ev: WidgetEvent): void` (mount if needed, `stepWidget`, warn errors, keep state, perform). `clickAt` becomes hit-test + `run(sc, {type: "click", …})`. Add:

```ts
    keyPress(key, ms) {
      if (!declaredKeys.includes(key)) return false;
      const sc = scene();
      if (!sc) return false;
      run(sc, { type: "key", key, ms });
      return true;
    },
```

with `const declaredKeys: string[] = (() => { try { return module.widget!().keys ?? []; } catch { return []; } })();` computed once at construction (a probe body, discarded). Expose `declaredKeys` as `host.keys: readonly string[]`.

In `attachWidgetHost`, after the click listener, only when `host.keys.length > 0`:

```ts
  const downAt = new Map<string, number>();
  const typing = (t: EventTarget | null): boolean =>
    t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
  const keysBlocked = (e: KeyboardEvent): boolean =>
    typing(e.target) ||
    (hd.timeline.state === "playing" && !stage.querySelector(".cs-widgetgate")) ||
    (gateIsOpen(stage) && !stage.querySelector(".cs-widgetgate"));
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!stage.isConnected) {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      return;
    }
    if (!host.keys.includes(e.key) || keysBlocked(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    downAt.set(e.key, performance.now());
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    const t0 = downAt.get(e.key);
    if (t0 === undefined) return;
    downAt.delete(e.key);
    if (keysBlocked(e)) return;
    e.preventDefault();
    host.keyPress(e.key, Math.max(1, Math.round(performance.now() - t0)));
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
```

`widgetGateFor`: the gate div gets `class: "cs-figgate cs-widgetgate"`.

- [ ] **Step 5: Author prompt** — in `author-v1.md`'s widget section add: the event list now has `{type: "key", key, ms}` delivered on release of a key the body declared in `keys: [" ", "Enter"]`, with `ms` the held time — use it for short/long presses; undeclared keys pass through; the pads must still work without a keyboard.

- [ ] **Step 6: Run + tsc** — the three test files, then `npx vitest run` and `npx tsc --noEmit`. Expected: PASS, clean.

- [ ] **Step 7: Commit** — `Widget bodies: the key event — a body declares keys, the host delivers one event per release with the held ms (piano's free-play pattern), the harness takes key events (Task 1)`

---

### Task 2: Morse from the keyboard; the two demo cosmetics

**Files:**
- Modify: `src/scenes/packs/widgets.yaml` (morse_key: `keys`, key branch, `hint` element; tower_of_hanoi demo; logic_gates demo), `src/examples.json` ("Sending SOS" narration + wrong line), `docs/superpowers/plans/2026-09-14-widget-bodies-smoke.md`, `public/help.html` (one clause)
- Test: `tests/widget-demo.test.ts` or `tests/examples.test.ts` (extend)

**Interfaces:** Consumes `keyEvent` (Task 1).

- [ ] **Step 1: Failing tests** — in the pack-driven describe of `tests/widget-demo.test.ts` (or a new `tests/widgets-pack.test.ts` that registers the pack via `ensureEnabledPacks(["widgets"])`):

```ts
  test("morse: space held short is a dot, long a dash; Enter ends the letter; Enter again sends", () => {
    const m = scenes["morse_key"];
    const r = runWidget(m, { word: "SOS" }, [
      keyEvent(" ", 80), keyEvent(" ", 80), keyEvent(" ", 80), keyEvent("Enter", 50),
      keyEvent(" ", 400), keyEvent(" ", 400), keyEvent(" ", 400), keyEvent("Enter", 50),
      keyEvent(" ", 80), keyEvent(" ", 80), keyEvent(" ", 80), keyEvent("Enter", 50),
      keyEvent("Enter", 50),
    ]);
    expect(r.errors).toEqual([]);
    expect(r.params.decoded).toBe("SOS");
    expect(r.answer).toBe("SOS");
    expect(r.effects.flat().filter((e) => e.answer !== undefined)).toHaveLength(1);
  });
  test("hanoi's demo ends on the solved tower whatever the disk count", () => {
    for (const disks of [3, 4, 5]) {
      const d = demoWidget(scenes["tower_of_hanoi"], { disks }, "solved");
      const last = [...d.effects].reverse().find((e) => e.patch)!;
      expect((last.patch as { pegs: string }).pegs.split("|")[2]).toHaveLength(disks);
    }
  });
  test("every gate's demo taps something and ends lit", () => {
    for (const gate of ["AND", "OR", "XOR", "NAND"]) {
      const d = demoWidget(scenes["logic_gates"], { gate }, "lit");
      expect(d.effects.some((e) => e.pointer)).toBe(true);
    }
  });
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Morse** — in `widgets.yaml` `morse_key`:
  - layout: add `push(kit.text("hint", [500, 88], "space: short = dot, long = dash · enter: end letter · enter again: send", { fontSize: 15, color: C.guide }))` (adjust y so it clears the pads and the subtitle band; it must pass the gate); `element_ids.hint`.
  - widget: `const DOT_MS = 200;` a shared `press(sym)` helper used by both the pads and the key branch; `on`: `if (ev.type === "key") { if (ev.key === " ") return press(ev.ms < DOT_MS ? "." : "-"); if (ev.key === "Enter") return st.letter === "" ? send() : gap(); return same(st); }` where `gap`/`send` are the existing pad branches refactored into helpers; `return { init, on, demo, judge, keys: [" ", "Enter"] };`.
  - description: mention the keyboard.
- [ ] **Step 4: Demos** — Hanoi: after the bounded taps, append `{ patch: { pegs: <solved encoding for n>, moves: 2 ** n - 1 } }` so the movie ends solved; keep the comment. Gates: for NAND (already lit at 0,0) tap A twice (`a` on, then off) with patches so the laser moves and it ends lit; keep the other gates' behaviour.
- [ ] **Step 5: Example, smoke, help** — "Sending SOS": the pads line adds "or hold the space bar: short for a dot, long for a dash; Enter ends a letter, Enter again sends"; `wrong` line unchanged. Smoke: new item "keyboard: send SOS with space and Enter only". Help: the widget row gains "A widget may also take keys (Morse: hold space)".
- [ ] **Step 6: Gate** — `npx vitest run tests/examples.test.ts tests/widget-demo.test.ts tests/prompt-size.test.ts` (re-pin if the description grew — the pack is not registered there, so expect no change), then the full suite + tsc.
- [ ] **Step 7: Commit** — `Widget bodies: Morse from the keyboard (space short/long, Enter gap, Enter again sends), Hanoi's demo ends solved, NAND's demo moves (Task 2)`

---

### Task 3: Three more widgets — xylophone, bubble sort, tic-tac-toe

**Files:**
- Modify: `src/scenes/packs/widgets.yaml` (three documents), `src/scenes/packs.ts` (pack description mentions them), `src/examples.json` (three entries), `docs/superpowers/plans/2026-09-14-widget-bodies-smoke.md`, `ROADMAP.md` (append to the widget-bodies section)
- Test: the examples gate; `tests/widgets-pack.test.ts` (behaviour per widget)

- [ ] **Step 1: Failing tests** (`tests/widgets-pack.test.ts`, pack registered in `beforeAll`):

```ts
  test("xylophone: bars sound their note and record it; Done answers the sequence; keys 1–8 play too", () => {
    const x = scenes["xylophone"];
    const r = runWidget(x, {}, ["bar_1", "bar_3", "bar_5", "key_done"]);
    expect(r.answer).toBe("C4 E4 G4");
    expect(r.effects[0].some((e) => e.sound && "notes" in e.sound)).toBe(true);
    const k = runWidget(x, {}, [keyEvent("1", 50), keyEvent("3", 50), keyEvent("5", 50), keyEvent("Enter", 50)]);
    expect(k.answer).toBe("C4 E4 G4");
  });
  test("bubble sort: two adjacent bars swap, non-adjacent is refused, the sorted state answers", () => {
    const b = scenes["bubble_sort"];
    const r = runWidget(b, { values: [2, 1] }, ["bar_0", "bar_1"]);
    expect(r.params.values).toEqual([1, 2]);
    expect(r.answer).toBe("sorted");
    const bad = runWidget(b, { values: [3, 2, 1] }, ["bar_0", "bar_2"]);
    expect(bad.params.values).toBeUndefined();
    expect(bad.effects.flat().some((e) => e.caption)).toBe(true);
  });
  test("tic-tac-toe: X plays, O answers deterministically, a finished game answers won/lost/draw", () => {
    const t = scenes["tictactoe"];
    const r = runWidget(t, {}, ["cell_4"]);
    const board = r.params.board as string;
    expect(board.split("").filter((c) => c === "x")).toHaveLength(1);
    expect(board.split("").filter((c) => c === "o")).toHaveLength(1);
    const again = runWidget(t, {}, ["cell_4"]);
    expect(again.params.board).toBe(board); // deterministic opponent
  });
```

- [ ] **Step 2: Run** — FAIL (templates missing).

- [ ] **Step 3: The documents** (each ready, kit 10, examples, gate-clean; every widget-set value a declared param "the widget sets this"; demos patch):
  - **xylophone**: params `played` (string, widget-set), `title`; eight bars `bar_1..bar_8` as pads of decreasing height (C4 D4 E4 F4 G4 A4 B4 C5, labels on the bars), a `key_done` pad; `on`: a bar → `sound: {notes: "<note>:q", tempo: 160}` + `patch: {played}`; `key_done` → `answer: played` (no-op if empty); keys `["1".."8", "Enter"]` map to bars/done; demo taps the bars of the answer ("C4 E4 G4") with sound and patches, then Done. Example "A xylophone you can play" with `ask … widget: xylophone, answer: "C4 E4 G4"`, `judge` compares trimmed/upper.
  - **bubble_sort**: params `values` (array of 4–8 integers; default `[5, 2, 8, 1, 9, 3]`, widget-set), `swaps` (integer, widget-set); bars `bar_<i>` as pads with heights ∝ value and the value as label; `on`: first click selects (glow), second click on an ADJACENT bar swaps (patch `values`, `swaps`+1), non-adjacent → caption "Bubble sort only swaps neighbours" + deselect; sorted ascending → glow all green + `answer: "sorted"`; demo performs bubble sort passes with a patch per swap, bounded to 12 swaps then a final patch to the sorted array. Example "Sort the bars like bubble sort" with `ask … answer: sorted`.
  - **tictactoe**: params `board` (9-char string of `x`, `o`, `.`; widget-set; default all dots), `title`; layout draws the grid (`grid`), nine cell pads `cell_0..cell_8` (empty label, X or O drawn as the pad label), a `status` text; `on`: click an empty cell → place `x`; if not over, the opponent places `o` by the fixed rule win → block → centre → first free corner → first free cell; patch `board`; caption "Your move" / "O played …"; game over → glow the line and `answer: "won" | "lost" | "draw"`; keys `["1".."9"]` map to cells; demo plays a fixed scripted game (patches per move) ending in a draw. Example "Tic-tac-toe against the computer" with `ask … answer: draw` and `judge` accepting `won` or `draw` (so a win also passes), `wrong: "The computer took that one — try again."`.
- [ ] **Step 4: Examples, roadmap, smoke, pack description** — append; the examples gate must pass: `npx vitest run tests/examples.test.ts tests/widgets-pack.test.ts`.
- [ ] **Step 5: Full suite + tsc.** Re-pin prompt-size only if it moves.
- [ ] **Step 6: Commit** — `Widget bodies: three more widgets — a xylophone (keys 1–8), bubble sort, tic-tac-toe against a built-in opponent (Task 3)`

---

### Task 4: Verify, merge main, push

- [ ] `git fetch origin && git merge origin/main` (resolve appends: examples.json, ROADMAP, help, pins re-measured — never pick a side on a pin).
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build`.
- [ ] Push the branch; report.
