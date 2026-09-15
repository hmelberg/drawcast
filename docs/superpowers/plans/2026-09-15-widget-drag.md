# Widget Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One pointer gesture on widget parts, read at release: a press that barely moved is a `click`, one that moved is a `drag` `{id, to, point, domain}`; while moving, the pressed part follows the pointer as a ghost through the renderer's offset transform; Hanoi (disks as parts) and bubble sort take drags, with click-click as the fallback.

**Architecture:** The host's gesture core is DOM-free (`press/move/release/cancel` on `WidgetHost`, driven by a fake `nudge` in tests); the stage listeners (pointerdown/move/up/cancel, capture phase) and the widget gate's overlay both forward to it. `Player.nudge(id, dx, dy)` wraps `RenderedElement.setOffset` on top of the boundary's own offset. The event union grows one member; the harness gains `dragEvent`.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), vitest in plain node (no jsdom), YAML template documents.

**Spec:** `docs/superpowers/specs/2026-09-14-widget-bodies-design.md` (§2.2 "Addendum 2026-09-15b — one gesture", §2.3, §5)

## Global Constraints

- `DRAG_MIN = 6` logical units separates click from drag; the decision is made at release.
- The ghost is cleared before the `drag` event is delivered; only the body's `patch` moves geometry for real. `pointercancel` clears the ghost and delivers nothing. `nudge` adds to the boundary's existing offset for that id and `nudge(id, 0, 0)` restores it.
- The host never listens for `click` any more; the synthesized click after a press that began on a part is swallowed in the capture phase. A press that began on a button, on blank paper (no part under it), while playing, or under another gate is not the widget's.
- Pointer capture on the stage for the press; `touch-action: none` on the stage only while a part is pressed, restored on release/cancel.
- No drop-target glow; no `drag` demo effect (the movie keeps tapping).
- `answer` means done; a widget never draws; nothing persists.
- Do not touch `src/ui/tray.ts`, `src/ui/tray-model.ts`, `src/layout/code.ts` or the code element. `examples.json`, `help.html`, `ROADMAP.md`, prompt pins: small appends only.
- `npm test` + `npx tsc --noEmit` before each commit touching `src/`; attribution lines on every commit (copy from `git log -1 --format=%B`). Worktree `/Users/hom/Documents/GitHub/drawcast/.claude/worktrees/widgets-3`, branch `worktree-widgets-3`.

---

### Task 1: The gesture — event type, harness, `Player.nudge`, host core, stage listeners, gate forwarding

**Files:**
- Modify: `src/scenes/widget-types.ts` (union member), `src/scenes/widget-run.ts` (`dragEvent`), `src/render/player.ts` (`nudge`), `src/ui/widget-host.ts` (core + listeners + gate), `src/llm/prompts/author-v1.md` (the event list)
- Test: `tests/widget-run.test.ts`, `tests/widget-host.test.ts`, `tests/widget-player-api.test.ts` (extend each)

**Interfaces:**
- Produces: `WidgetEvent |= { type: "drag"; id: string; to: string | null; point: Pt; domain: Pt | null }`; `dragEvent(id: string, to: string | null, point?: Pt): WidgetEvent`; `Player.nudge(id: string, dx: number, dy: number): void`; on `WidgetHost`: `press(p: Pt): boolean` (true when a part is under p and a gesture began), `move(p: Pt): void`, `release(p: Pt): "click" | "drag" | null`, `cancel(): void`; `WidgetHostDeps.nudge?: (id: string, dx: number, dy: number) => void` (default `hd.timeline.nudge`); `DRAG_MIN` exported from `widget-host.ts`.

- [ ] **Step 1: Failing tests**

`tests/widget-run.test.ts`:

```ts
  test("a drag event reaches on() with the part it was dropped on", () => {
    const dragged = compileTemplateDoc({ ...doc, widget: `
      const init = () => ({ last: "" });
      const on = (ev, st) => ev.type === "drag" ? { state: { last: ev.id + ">" + ev.to }, effects: [{ patch: { signal: ev.id + ">" + ev.to } }] } : { state: st, effects: [] };
      return { init, on };` } as TemplateDoc).module!;
    const r = runWidget(dragged, {}, [dragEvent("dot", "gap"), dragEvent("gap", null)]);
    expect(r.errors).toEqual([]);
    expect(r.states).toEqual([{ last: "dot>gap" }, { last: "gap>null" }]);
    expect(r.params).toEqual({ signal: "gap>null" });
  });
```

`tests/widget-host.test.ts` — the fake doc's `on` gains a drag branch: `if (ev.type === "drag") return { state: st, effects: [{ caption: ev.id + ">" + ev.to }] };` and the fake handle records `nudge` calls (`nudge: (id, dx, dy) => calls.push(\`nudge ${id} ${dx} ${dy}\`)` passed via deps). Tests:

```ts
  test("a press and release in place is a click", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd, { nudge: (id, dx, dy) => calls.push(`nudge ${id} ${dx} ${dy}`) })!;
    expect(host.press([300, 400])).toBe(true);
    host.move([302, 401]); // under DRAG_MIN: no ghost
    expect(host.release([302, 401])).toBe("click");
    expect(calls).toEqual(["beep 700 80", 'preview {"signal":"."}', "glow dot"]);
  });
  test("a press that moves is a ghost, then a drag on release — ghost cleared first", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd, { nudge: (id, dx, dy) => calls.push(`nudge ${id} ${dx} ${dy}`) })!;
    host.press([300, 400]);
    host.move([340, 410]);
    host.move([500, 400]);
    expect(host.release([500, 400])).toBe("drag");
    expect(calls).toEqual(["nudge dot 40 10", "nudge dot 200 0", "nudge dot 0 0", "caption dot>gap"]);
  });
  test("released on blank paper: to is null; cancel clears the ghost and delivers nothing", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd, { nudge: (id, dx, dy) => calls.push(`nudge ${id} ${dx} ${dy}`) })!;
    host.press([300, 400]);
    host.move([900, 700]);
    expect(host.release([900, 700])).toBe("drag");
    expect(calls.at(-1)).toBe("caption dot>null");
    calls.length = 0;
    host.press([300, 400]);
    host.move([400, 400]);
    host.cancel();
    expect(calls).toEqual(["nudge dot 100 0", "nudge dot 0 0"]);
    expect(host.release([400, 400])).toBeNull(); // nothing pressed
  });
  test("a press on nothing begins no gesture", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd)!;
    expect(host.press([900, 700])).toBe(false);
    expect(host.release([900, 700])).toBeNull();
    expect(calls).toEqual([]);
  });
```

Source pins (same file): the stage listens `pointerdown`/`pointermove`/`pointerup`/`pointercancel` in the capture phase and no longer `"click"` for hit-testing; `stage.setPointerCapture(e.pointerId)` inside try/catch; `stage.style.touchAction = "none"` on press and `""` on release/cancel; a capture-phase `click` listener that swallows the click after a press that began on a part (`if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); }`); the widget gate forwards `pointerdown`/`pointermove`/`pointerup`/`pointercancel` to `host.press/move/release/cancel` and no longer calls `host.clickAt` from its click listener.

`tests/widget-player-api.test.ts`: pin `nudge(id: string, dx: number, dy: number): void` exists and reads `this.stateAt(this.completed).offsets[id]` as the base.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Types, harness, Player**

`widget-types.ts`: add `| { type: "drag"; id: string; to: string | null; point: Pt; domain: Pt | null }` with a doc comment ("a press that moved ≥ DRAG_MIN before release; `to` is the part under the release point").

`widget-run.ts`: `export const dragEvent = (id: string, to: string | null, point: Pt = [0, 0]): WidgetEvent => ({ type: "drag", id, to, point, domain: null });`

`player.ts`, next to `dimElements`:

```ts
  /** Move a rendered part by (dx, dy) on top of whatever offset the current
   *  boundary already gave it — a widget's drag ghost. (0, 0) restores it. */
  nudge(id: string, dx: number, dy: number): void {
    const el = this.elements.get(id);
    if (!el?.setOffset) return;
    const base = this.stateAt(this.completed).offsets[id] ?? [0, 0];
    el.setOffset(base[0] + dx, base[1] + dy);
  }
```

(Confirm `stateAt`, `completed` and `offsets` are the names in scope — see `previewParams` and the `move` tween at ~line 445.)

- [ ] **Step 4: Host core**

In `widgetHostFor`: `const nudge = deps.nudge ?? ((id, dx, dy) => hd.timeline.nudge(id, dx, dy));` and a gesture record `let gesture: { id: string; start: Pt; moved: boolean } | null = null;`. Add:

```ts
    press(p) {
      const sc = scene();
      if (!sc) return false;
      const id = partAt(sc, p);
      if (id === null) return false;
      gesture = { id, start: p, moved: false };
      return true;
    },
    move(p) {
      if (!gesture) return;
      const dx = p[0] - gesture.start[0], dy = p[1] - gesture.start[1];
      if (!gesture.moved && Math.hypot(dx, dy) < DRAG_MIN) return;
      gesture.moved = true;
      nudge(gesture.id, dx, dy);
    },
    release(p) {
      if (!gesture) return null;
      const g = gesture;
      gesture = null;
      const sc = scene();
      if (!sc) return null;
      if (!g.moved) {
        run(sc, { type: "click", id: g.id, point: g.start, domain: sc.toDomain(g.start) });
        return "click";
      }
      nudge(g.id, 0, 0);
      run(sc, { type: "drag", id: g.id, to: partAt(sc, p), point: p, domain: sc.toDomain(p) });
      return "drag";
    },
    cancel() {
      if (!gesture) return;
      if (gesture.moved) nudge(gesture.id, 0, 0);
      gesture = null;
    },
```

`clickAt(p)` becomes `return this.press(p) && this.release(p) === "click";` (keep its contract: true when a part was hit). `reset()` also calls `cancel()`. Export `export const DRAG_MIN = 6;`.

- [ ] **Step 5: Stage listeners and the gate**

In `attachWidgetHost` replace the `click` listener with:

```ts
  let swallowClick = false;
  const blocked = (e: Event): boolean =>
    hd.timeline.state === "playing" ||
    (e.target instanceof Element && e.target.closest("button") !== null) ||
    gateIsOpen(stage);
  stage.addEventListener("pointerdown", (e) => {
    if (blocked(e)) return;
    const p = logicalPoint(stage, e);
    if (!p || !host.press(p)) return;
    swallowClick = true;
    stage.style.touchAction = "none";
    try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    e.preventDefault();
  }, true);
  stage.addEventListener("pointermove", (e) => {
    const p = logicalPoint(stage, e);
    if (p) host.move(p);
  }, true);
  const end = (e: PointerEvent, cancelled: boolean): void => {
    stage.style.touchAction = "";
    try { stage.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (cancelled) { host.cancel(); return; }
    const p = logicalPoint(stage, e);
    if (p) host.release(p); else host.cancel();
  };
  stage.addEventListener("pointerup", (e) => end(e, false), true);
  stage.addEventListener("pointercancel", (e) => end(e, true), true);
  // The click that follows a press which began on a part is the widget's
  // gesture already delivered — never the play/pause toggle (the piano's rule).
  stage.addEventListener("click", (e) => {
    if (swallowClick) {
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
```

`host.move` is a no-op without a gesture, so the pointermove listener costs nothing at rest (it must NOT call `over()`; the info card owns hover). In `widgetGateFor`, replace the `gate.addEventListener("click", …)` routing with pointerdown/move/up/cancel on the gate that call `host.press/move/release/cancel` with `logicalPoint(stage, e)` (skip when the target is inside a button; `e.stopPropagation()` on pointerdown as today).

- [ ] **Step 6: Author prompt** — the event list in `author-v1.md`'s widget section gains: `{type: "drag", id, to, point, domain}` — a press that moved before release; `to` is the part it was dropped on (or null); handle it beside `click` for "put this there" tasks, and keep the click path as the fallback.

- [ ] **Step 7: Run + tsc** — the three test files, then `npx vitest run`, `npx tsc --noEmit`. Expected: PASS, clean.

- [ ] **Step 8: Commit** — `Widget bodies: one gesture read at release — click or drag, the pressed part ghosts along on the renderer's offset, the gate forwards the same gesture (Task 1)`

---

### Task 2: Hanoi with disks as parts; bubble sort takes drags; smoke, help, roadmap

**Files:**
- Modify: `src/scenes/packs/widgets.yaml` (`tower_of_hanoi`, `bubble_sort`), `src/examples.json` (the two examples' narration mentions dragging), `docs/superpowers/plans/2026-09-14-widget-bodies-smoke.md`, `public/help.html` (one clause), `ROADMAP.md` (append to the widget-bodies section)
- Test: `tests/widgets-pack.test.ts` (extend)

**Interfaces:** Consumes `dragEvent` (Task 1).

- [ ] **Step 1: Failing tests** (`tests/widgets-pack.test.ts`):

```ts
  test("hanoi: a disk dragged onto a peg moves when legal, is refused when not, and click-click still works", () => {
    const h = scenes["tower_of_hanoi"];
    const r = runWidget(h, { disks: 3 }, [dragEvent("disk_1", "peg_2")]);
    expect(r.params.pegs).toBe("32||1");
    expect(r.params.moves).toBe(1);
    const bad = runWidget(h, { disks: 3 }, [dragEvent("disk_1", "peg_1"), dragEvent("disk_2", "peg_1")]);
    expect(bad.params.pegs).toBe("3|1|"); // the 2 may not go on the 1
    expect(bad.effects[1].some((e) => e.caption)).toBe(true);
    const onDisk = runWidget(h, { disks: 3 }, [dragEvent("disk_1", "peg_2"), dragEvent("disk_2", "disk_1")]); // dropped on a disk = its peg
    expect(onDisk.params.pegs).toBe("3||1");
    const cc = runWidget(h, { disks: 3 }, ["disk_1", "peg_2"]);
    expect(cc.params.pegs).toBe("32||1");
  });
  test("hanoi: every disk and every peg is on the hit surface", () => {
    const scene = buildWidgetScene(scenes["tower_of_hanoi"], { disks: 3 })!;
    for (const id of ["disk_1", "disk_2", "disk_3", "peg_0", "peg_1", "peg_2"]) {
      const b = scene.boxes.get(id)!;
      expect(partAt(scene, [b.x + b.w / 2, b.y + b.h / 2]), id).toBe(id);
    }
  });
  test("bubble sort: a bar dragged onto its neighbour swaps; onto a non-neighbour is refused", () => {
    const b = scenes["bubble_sort"];
    const r = runWidget(b, { values: [1, 3, 2, 4] }, [dragEvent("bar_1", "bar_2")]);
    expect(r.params.values).toEqual([1, 2, 3, 4]);
    const bad = runWidget(b, { values: [3, 2, 1, 4] }, [dragEvent("bar_0", "bar_2")]);
    expect(bad.params.values).toBeUndefined();
  });
```

(A disk stacked on top of another: the disk's own outline is the smaller ring, so `partAt` picks the disk; a click on the peg's pole or base still hits the peg zone. The "every disk on the hit surface" test guards the stacking geometry: the top disk's centre must resolve to that disk, not the one under it — arrange disks so their rings do not contain each other's centres, i.e. each disk's rect is its own row.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Hanoi rewrite** — layout: pegs `peg_0..2` are groups of zone + base + pole only (zone outline as today); every disk becomes a TOP-LEVEL closed stroke `disk_<d>` positioned on its peg and row from `pegs`; `element_ids` lists `disk_<d>` ("a disk, drag it onto a peg") and pegs; `order` puts pegs first, then disks bottom to top. Widget: `on` handles `drag` (`id` matches `/^disk_(\d)$/`; `to` resolves to a peg index — `peg_<p>` directly, or the peg holding `disk_<x>` when dropped on a disk, else no-op) and keeps the `click` path (click a disk = select the disk's peg's top disk if it is the top; click a peg = move there); only the TOP disk of its peg may be moved (a drag of a buried disk → caption "Only the top disk moves."); legality and `answer: "solved"` as today; demo unchanged (taps peg to peg — pegs remain parts). Description mentions dragging.
- [ ] **Step 4: Bubble sort** — `on` handles `drag` from `bar_i` to `bar_j`: adjacent → swap (same code as the click path's second click), else the refusal caption; click path unchanged. Description mentions dragging.
- [ ] **Step 5: Docs** — the two examples' explanatory line mentions "drag a disk / drag a bar (or click, then click)"; smoke items: "drag the small disk to the right peg — it follows the pointer and lands; drag a big disk onto a small one — it snaps back with the caption; release a disk on blank paper — it snaps back and playback does not resume; drag a bar onto its neighbour"; help: one clause on dragging; ROADMAP: two sentences (gesture, the two documents).
- [ ] **Step 6: Gate** — `npx vitest run tests/widgets-pack.test.ts tests/examples.test.ts tests/widget-demo.test.ts tests/prompt-size.test.ts` (re-pin only if the pack description grew), then the full suite + tsc.
- [ ] **Step 7: Commit** — `Widget bodies: Hanoi's disks are parts you drag onto a peg, bubble sort's bars drag onto a neighbour, click-click stays the fallback (Task 2)`

---

### Task 3: Verify, merge main, push

- [ ] `git fetch origin && git merge origin/main` (keep-both on appends; re-measure pins on conflict).
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build`.
- [ ] Push the branch; report.
