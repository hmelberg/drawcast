# Round 7 — Sort Feedback, Rank Reorder, Layouts, Bar Icons/Colours, Headline + Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sort judges each card as it is dropped (a wrong one glides to its right box, faded, a ✓/✗ counter keeps score); a rank slides into the true order with a faint "yours" row; cards stand above their boxes by default; bar charts get icons under the bars and colours decided from their labels; the question stands over the figure as a headline and the bottom bar becomes one family of pills.

**Architecture:** Each change is a field on an existing structure: the cards element gets `check` and new `arrange` values, the ask's `reveal_style` gets `"reorder"`, the bar_chart template gets `icons` and `bar_colors`. The pure parts (judging a drop, the counter, the reorder arcs, the label rule, the layouts) live in small modules with unit tests; the gate animates, the player reveals and restores through its existing `Beside` bookkeeping (a new `dim` list for corrected cards), and the headline is mounted by the shared gate dock.

**Tech Stack:** TypeScript, vitest (`npx vitest run <file>`), `npx tsc --noEmit`, the YAML pack templates (`src/scenes/packs/data.yaml`), the scene kit, the icon cache (`npm run icons`, needs network).

**Spec:** `docs/superpowers/specs/2026-10-02-sort-feedback-reorder-bar-icons-design.md`

## Global Constraints

- `check: "each" | "end"` is a CARDS ELEMENT field. **Default `"each"`** for sort (with `bins`), select (`select:`) and deck; `"end"` keeps today's behaviour exactly (sort everything, Answer, beside reveal with arrows). Other modes ignore `check`. Never confuse it with the ask-level market `check` ("direction" | "shape" | "size").
- Wrong drop: "a red ✗ flashes beside it in box k. After about 0.5 s the card glides to its right box (… about 0.6 s) and settles there faded to 45 %, with no mark."
- Counter: "`✓ 4 · ✗ 1` in small text (20, ink; ✓ green, ✗ red), centred just under the boxes (or above them in `rise`)". Colours: ✓ `#4a7c59`, ✗ `#b3412e`, yours `#3f6fb5`.
- Score under `"each"`: first-drop right count. `{f}` is that count, `{f.total}` the number of cards; `right` only when every first drop was right. Under `"end"` `{f}` stays "x of y".
- Movies (questions off) and demo: "no counter and nothing is faded".
- Rank: `reveal_style: "reorder"` is the default for rank cards; an explicit `"beside"` or `"morph"` wins. Verdicts ~0.8 s, "yours" row font 16 in the YOURS blue, slide ~0.9 s, arcs above/below by direction.
- `arrange`: `"drop"` (new default: cards on top, boxes below), `"side"` (cards a column in the left third; up to 8 cards, else lint warns and layout falls back to drop), `"rise"` (today's layout, exactly). Rank keeps `row` | `column`.
- Bars: `icons` one per bar, ≤ 12 bars, about 44 units square, picture look by default, under the bar between the axis and the label. `bar_colors: "each" | "same"`, decided from the labels when not given.
- Headline: the question, sketch font, about 1.3 rem, ink, at most two lines (ellipsis); the how line small and muted under it. Bottom bar: Skip left, Answer right, same pill shape/font/height/border; Answer filled guess blue; no shadows or pulsing; phone min-height 40 px.
- Norwegian: every new gate word goes in BOTH tables of `src/ui/gate-words.ts` (EN and NB) in the same commit.
- Short canvas text (a word or three); comments in the code's own terse voice.
- Never `git stash`, `git reset` or `git checkout` in the shared checkout; commit by explicit path. Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp
  ```
- Every task ends with `npx tsc --noEmit` clean and its listed tests green. Whenever a schema description, a template's params schema or a prompt file changes, `tests/prompt-size.test.ts` is re-pinned in the same task: set `BASELINE_SYSTEM_CHARS` / `BASELINE_SCHEMA_CHARS` to the actual value the failing test prints, with a dated comment above the constant in the style of the existing ones ("Re-pinned UP 2026-10-02 (round 7 Task N): … +X. -> NNN.").
- Browser checks are MUTED (narration and WebAudio), see Task 15.

## Review Focus

1. Two wrong drops less than 0.5 s apart (or a quick deck): both cards must end in their right boxes, faded, and the counter must read ✗ 2 — a shared timer must not cancel the first correction. Test: Task 2 ("two wrong drops inside the hold") and Task 4 (quick deck).
2. Scrub or pause while a corrected card is gliding: every card back at offset 0 and full opacity. Test: Task 2 ("an abort mid-glide …").
3. Seek forward past an answered each-sort, then back before it: forward shows the counter and the faded cards; back clears both (opacity 1). Test: Task 3 ("seek …").
4. An answer string with no `;first` part (check: end, or stored before round 7) on a sort that now defaults to `"each"`: it still decodes, scores by final boxes and gets the beside reveal. Tests: Task 1 ("old strings still decode"), Task 3 ("an answer without first keeps the beside reveal").
5. A Norwegian cast: Done, the each-hints and "yours" read in Norwegian; an icon keyword missing from the cache warns by name rather than drawing an empty slot. Tests: Task 5 (gate words tables), Task 6 (`yours`), Task 9 (missing keyword warning).

---

### Task 1: `check` on the cards element; first drops, `checkDrop`, scoring and encoding (spec §3.5, build order 1)

**Files:**
- Modify: `src/spec/cards.ts` — `CardsElementLike` (line 66), `CardsGeometry` (line 111), `base` in `cardsGeometryAt` (line 322), `deckGeometry`'s `base` parameter type (line 563), `CARRIED` (line 630)
- Modify: `src/spec/types.ts` — the cards element fields (lines 453-462, next to `deck`)
- Modify: `src/spec/schema.ts` — element property next to `deck` (line 646)
- Modify: `src/cards/model.ts` — `Arrangement` (line 14), `rightCards` sort case (line 192), `encodeArrangement` (line 238), `decodeArrangement` sort case (line 266); new `putIn`, `isPlaced`, `checkDrop`, `allChecked`, `checkTally`
- Modify: `tests/prompt-size.test.ts` (re-pin)
- Test: `tests/cards-check.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `CardsElementLike.check?: "each" | "end"`; carried through expansion (`CARRIED`), so `authoredCards()` and `cardsGeometryIn()` see it.
  - `CardsGeometry.each?: true` — set for mode `"sort"` (bins, select and deck) unless `check: "end"`.
  - `Arrangement.first?: (number | null)[]` — per card, the first box it was dropped in; `-1` = the tray (a select card left out on Done); `null` = not judged yet.
  - `putIn(a: Arrangement, card: number, box: number): Arrangement` — card moved to box `box` (`-1`: the tray), nothing judged.
  - `isPlaced(a: Arrangement, card: number): boolean` — `a.first?.[card]` is a number.
  - `checkDrop(g: CardsGeometry, a: Arrangement, card: number, box: number): { ok: boolean; arr: Arrangement }` — records `first[card] = box` if unset; `ok = first[card] === g.truthBin[card]`; `arr` has the card in its RIGHT box (select out-card: the tray).
  - `allChecked(g: CardsGeometry, a: Arrangement): boolean`; `checkTally(g: CardsGeometry, a: Arrangement): { right: number; wrong: number }`.
  - `rightCards` / `scoreCards` for sort read `first` when present, else final boxes.
  - Encoding for sort: `"<boxes>;<first>"`, e.g. `"0|;1,,"` (first values comma-joined, `null` as empty). No `;` part when `first` is absent.

- [ ] **Step 1: Write the failing test**

Create `tests/cards-check.test.ts`:

```ts
// check: each (round 7 §3.5): a sort, select or deck judges each card as it
// is dropped — the first drop is the answer, the card goes to its right box.
import { describe, expect, test } from "vitest";
import { authoredCards, cardsGeometry, type CardsElementLike } from "../src/spec/cards";
import { allChecked, checkDrop, checkTally, decodeArrangement, encodeArrangement, initialArrangement, isPlaced, positions, putIn, scoreCards } from "../src/cards/model";
import { expandSpec } from "../src/spec/expand";
import type { Spec } from "../src/spec/types";

const two: CardsElementLike = { id: "c", type: "cards", bins: ["Fixed", "Variable"], items: [{ text: "Rent", bin: "Fixed" }, { text: "Flour", bin: "Variable" }, { text: "Tax", bin: "Fixed" }] };
const zoo: CardsElementLike = { id: "z", type: "cards", select: "Mammals", items: [{ text: "Whale", in: true }, "Shark", { text: "Bat", in: true }] };

describe("check: each is the default for sort, select and deck", () => {
  test("geometry", () => {
    expect(cardsGeometry(two).each).toBe(true);
    expect(cardsGeometry(zoo).each).toBe(true);
    expect(cardsGeometry({ ...two, deck: true }).each).toBe(true);
    expect(cardsGeometry({ ...two, check: "end" }).each).toBeUndefined();
    expect(cardsGeometry({ id: "r", type: "cards", items: ["A", "B", "C"] }).each).toBeUndefined();
  });

  test("carried through the expansion", () => {
    const spec = expandSpec({ elements: [{ ...two, check: "end" } as never], commands: [] } as unknown as Spec);
    expect(authoredCards(spec)[0].check).toBe("end");
  });
});

describe("checkDrop", () => {
  const g = cardsGeometry(two);

  test("right: first recorded, the card in its box", () => {
    const r = checkDrop(g, initialArrangement(g), 1, 1);
    expect(r.ok).toBe(true);
    expect(r.arr.first).toEqual([null, 1, null]);
    expect(r.arr.boxes).toEqual([[], [1]]);
  });

  test("wrong: first is where it was dropped, the card goes to its right box", () => {
    const r = checkDrop(g, initialArrangement(g), 0, 1);
    expect(r.ok).toBe(false);
    expect(r.arr.first).toEqual([1, null, null]);
    expect(r.arr.boxes).toEqual([[0], []]);
  });

  test("a placed card is final: a second drop keeps its first box", () => {
    const a = checkDrop(g, initialArrangement(g), 0, 1).arr;
    const b = checkDrop(g, a, 0, 0);
    expect(b.arr.first![0]).toBe(1);
    expect(b.ok).toBe(false);
  });

  test("select: in → the box; out → back to the tray; Done judges the rest (-1)", () => {
    const z = cardsGeometry(zoo);
    expect(checkDrop(z, initialArrangement(z), 0, 0).ok).toBe(true);
    const out = checkDrop(z, initialArrangement(z), 1, 0);
    expect(out.ok).toBe(false);
    expect(out.arr.boxes).toEqual([[]]);
    expect(positions(z, out.arr)[1]).toEqual(z.home[1]);
    // A missed in-card: wrong, and it goes in; an untapped out-card: right where it stands.
    const missed = checkDrop(z, initialArrangement(z), 2, -1);
    expect(missed.ok).toBe(false);
    expect(missed.arr.boxes).toEqual([[2]]);
    expect(checkDrop(z, initialArrangement(z), 1, -1).ok).toBe(true);
  });

  test("the last card: allChecked once every card has a first box; the tally", () => {
    let a = initialArrangement(g);
    for (const [card, box] of [[0, 0], [1, 0], [2, 0]] as const) {
      expect(allChecked(g, a)).toBe(false);
      a = checkDrop(g, a, card, box).arr;
    }
    expect(allChecked(g, a)).toBe(true);
    expect(checkTally(g, a)).toEqual({ right: 2, wrong: 1 });
    expect(isPlaced(a, 1)).toBe(true);
  });

  test("putIn lands a card where it was dropped, nothing judged", () => {
    expect(putIn(initialArrangement(g), 0, 1).boxes).toEqual([[], [0]]);
    expect(putIn({ order: [], boxes: [[], [0]] }, 0, -1).boxes).toEqual([[], []]);
  });
});

describe("scoring and encoding", () => {
  const g = cardsGeometry(two);

  test("with first: the first drops count, not where the cards end", () => {
    let a = initialArrangement(g);
    a = checkDrop(g, a, 0, 1).arr;
    a = checkDrop(g, a, 1, 1).arr;
    a = checkDrop(g, a, 2, 0).arr;
    expect(scoreCards(g, a)).toEqual({ within: 2, count: 3, ok: false });
  });

  test("without first: the final boxes (check: end, older answers)", () => {
    expect(scoreCards(g, { order: [], boxes: [[0, 2], [1]] })).toEqual({ within: 3, count: 3, ok: true });
  });

  test("first round-trips; old strings still decode", () => {
    const a = checkDrop(g, initialArrangement(g), 0, 1).arr;
    const s = encodeArrangement(g, a);
    expect(s).toBe("0|;1,,");
    expect(decodeArrangement(g, s)).toEqual(a);
    expect(decodeArrangement(g, "0,2|1")).toEqual({ order: [], boxes: [[0, 2], [1]] });
    expect(decodeArrangement(g, "0|;5,,")).toBeNull();
    expect(decodeArrangement(g, "0|;1,")).toBeNull();
    expect(decodeArrangement(g, "0|;1,,;2")).toBeNull();
  });

  test("select: -1 (the tray) round-trips", () => {
    const z = cardsGeometry(zoo);
    const a = checkDrop(z, initialArrangement(z), 1, -1).arr;
    expect(decodeArrangement(z, encodeArrangement(z, a))).toEqual(a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cards-check.test.ts`
Expected: FAIL — `checkDrop` (and the others) are not exported; `check` is not a property of `CardsElementLike`.

- [ ] **Step 3: Add the field (spec/cards.ts, types.ts, schema.ts)**

In `src/spec/cards.ts`, `CardsElementLike`, after `deck?: boolean;`:

```ts
  /** sort, select, deck (round 7 §3): each (default) — every card is judged as it is dropped; end — all at Answer. */
  check?: "each" | "end";
```

In `CardsGeometry`, after `font?: number;`:

```ts
  /** check: each (round 7 §3) — a sort, select or deck judging every drop. */
  each?: true;
```

In `cardsGeometryAt`, replace the `base` line (line 322):

```ts
  const base = { id: el.id, mode, truthBin: [] as number[], bins: [] as string[], binBoxes: [] as CardBox[], binSlot: none, ...(mode === "sort" && el.check !== "end" ? { each: true as const } : {}) };
```

In `deckGeometry`'s signature, widen the `base` parameter type:

```ts
  base: Pick<CardsGeometry, "id" | "mode" | "truthBin" | "bins" | "binBoxes" | "binSlot" | "each">,
```

`CARRIED` (line 630) gets `"check"`:

```ts
const CARRIED = ["items", "bins", "ends", "arrange", "along", "compare", "pairs", "unit", "options", "then", "fill", "select", "deck", "check", "x", "y", "width"] as const;
```

In `src/spec/types.ts`, in the element interface after `deck?: boolean;` (line ~459). First run `grep -n "check?:" src/spec/types.ts` — the existing `check` at line ~996 is on the ASK interface; the element interface must not already have one.

```ts
  /** cards (sort, select, deck): judge each card as it is dropped (default) or all at the end. */
  check?: "each" | "end";
```

In `src/spec/schema.ts`, after the element property `deck: {…}` (line 646):

```ts
    check: { type: "string", enum: ["each", "end"], description: "cards (sort, select, deck): each (default) — every card is judged as it is dropped, a wrong one moved to its right box; end — sort freely, then Answer (a test-like question)." },
```

- [ ] **Step 4: Write the model (src/cards/model.ts)**

`Arrangement`, after `choice?: number;`:

```ts
  /** sort under check: each (round 7 §3.5): each card's first box (-1: the tray), null until judged. */
  first?: (number | null)[];
```

`rightCards`, the `case "sort":` becomes:

```ts
    case "sort":
      // check: each — the first drop is the answer (round 7 §3.1.8).
      if (a.first) return g.cards.map((_, i) => a.first![i] === g.truthBin[i]);
      // Where each card is (-1: still in the row) against where it belongs
      // (select: -1 for a card that stays out).
      return g.cards.map((_, i) => boxOf(a, i) === g.truthBin[i]);
```

After `tapCard` (line 159), add:

```ts
/** A card put in box `box` (-1: the tray), as dropped — nothing judged. */
export function putIn(a: Arrangement, card: number, box: number): Arrangement {
  const boxes = a.boxes.map((cs) => cs.filter((c) => c !== card));
  if (box >= 0 && box < boxes.length) boxes[box].push(card);
  return { ...a, boxes };
}

/** check: each — the card has been judged; it is final. */
export function isPlaced(a: Arrangement, card: number): boolean {
  const f = a.first?.[card];
  return f !== null && f !== undefined;
}

/**
 * A drop judged at once (round 7 §3.5): `box` (-1: the tray — a select's
 * card left out on Done) is kept as the card's first box, and the card goes
 * to its right box (a select's out card: the tray). The gate animates; this decides.
 */
export function checkDrop(g: CardsGeometry, a: Arrangement, card: number, box: number): { ok: boolean; arr: Arrangement } {
  const first = (a.first ?? g.cards.map(() => null)).slice();
  if (first[card] === null || first[card] === undefined) first[card] = box;
  const truth = g.truthBin[card];
  return { ok: first[card] === truth, arr: { ...putIn(a, card, truth), first } };
}

/** check: each — every card judged (the last one answers). */
export function allChecked(g: CardsGeometry, a: Arrangement): boolean {
  return g.cards.every((_, i) => isPlaced(a, i));
}

/** check: each — the counter's numbers: first drops right and wrong so far. */
export function checkTally(g: CardsGeometry, a: Arrangement): { right: number; wrong: number } {
  let right = 0;
  let wrong = 0;
  g.cards.forEach((_, i) => {
    if (!isPlaced(a, i)) return;
    if (a.first![i] === g.truthBin[i]) right++;
    else wrong++;
  });
  return { right, wrong };
}
```

`encodeArrangement`: split the shared `case "sort": case "fill":` into:

```ts
    case "sort": {
      const boxes = a.boxes.map((cards) => cards.join(",")).join("|");
      // check: each — the first drops after a ";" (null: empty).
      return a.first ? `${boxes};${a.first.map((v) => (v === null ? "" : String(v))).join(",")}` : boxes;
    }
    case "fill":
      return a.boxes.map((cards) => cards.join(",")).join("|");
```

`decodeArrangement`, the `case "sort":` becomes:

```ts
    case "sort": {
      const halves = s.split(";");
      if (halves.length > 2) return null;
      const parts = halves[0].split("|");
      if (parts.length !== g.bins.length) return null;
      const boxes = parts.map(nums);
      const all = boxes.flat();
      if (!all.every(ok) || new Set(all).size !== all.length) return null;
      if (halves.length === 1) return { order: [], boxes };
      const raw = halves[1].split(",");
      if (raw.length !== n) return null;
      const first = raw.map((t) => (t.trim() === "" ? null : Number(t)));
      if (first.some((v) => v !== null && (!Number.isInteger(v) || v < -1 || v >= g.bins.length))) return null;
      return { order: [], boxes, first };
    }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/cards-check.test.ts tests/cards.test.ts tests/cards-faster-sort.test.ts tests/cards-fill.test.ts tests/cards-gate-tap.test.ts tests/cards-beside.test.ts tests/cards-deck-player.test.ts`
Expected: PASS (the gate and player do not read `each` yet; old answers carry no `first`).

- [ ] **Step 6: Re-pin the prompt size and type-check**

Run: `npx vitest run tests/prompt-size.test.ts` — the schema grew by the `check` property. Set both baselines to the printed actual values with a comment, e.g. above `BASELINE_SYSTEM_CHARS`:

```ts
// Re-pinned UP 2026-10-02 (round 7 Task 1): cards `check` (each / end) — the schema's +NNN, carried into the prompt. -> NNNNNN.
```

(and the same above `BASELINE_SCHEMA_CHARS`). Then `npx vitest run tests/prompt-size.test.ts` PASS and `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add src/spec/cards.ts src/spec/types.ts src/spec/schema.ts src/cards/model.ts tests/cards-check.test.ts tests/prompt-size.test.ts
git commit -m "Round 7: cards check each/end; first drops, checkDrop, scoring and encoding

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

---

### Task 2: The sort gate under `check: "each"` — tap a box, drop judged, glide, fade, counter (spec §3.1, build order 1)

**Files:**
- Create: `src/cards/counter.ts`
- Modify: `src/spec/cards.ts` — `CardsGeometry.layout?`, new exported `COUNTER_ROOM` and `counterAt`
- Modify: `src/render/player.ts` — `CardsSession` (line 255) gets `fade?`; `cardsAsk` session literal (line 1987)
- Modify: `src/ui/gate-words.ts` — `cards.sortEach` in EN (line 78) and NB (line 119)
- Modify: `src/ui/cards-gate.ts`
- Modify: `tests/cards-gate-tap.test.ts`
- Test: `tests/cards-counter.test.ts` (new)

**Interfaces:**
- Consumes (Task 1): `checkDrop`, `putIn`, `isPlaced`, `allChecked`, `checkTally`, `Arrangement.first`, `CardsGeometry.each`.
- Produces:
  - `CardsGeometry.layout?: "drop" | "side" | "rise"` — absent means `"rise"` (today's layout; Task 7 sets it).
  - `src/spec/cards.ts`: `export const COUNTER_ROOM = 34;` and `export function counterAt(g: CardsGeometry): Pt` — centred over the boxes' span; rise: 22 above the highest box top (at most 736); drop/side: 22 under the lowest box bottom.
  - `src/cards/counter.ts`: `export const CORRECTED = 0.45;` `export const COUNTER_SIZE = 20;` `export function counterMarks(g: CardsGeometry, a: Arrangement, extra?: GuessMarkText[]): GuessMarks` — texts in this order: `"✓ n"` (RIGHT, anchor end), `"·"` (TRUTH, middle), `"✗ m"` (WRONG, start), all `size: 20, gap: true`, then `extra`.
  - `CardsSession.fade?(cardId: string, alpha: number): void` — player wires it to the element handle's `setOpacity`.
  - Gate word `words.cards.sortEach` (EN "Tap a box, or drag a card", NB "Trykk på en boks, eller dra et kort").
  - In `cards-gate.ts` (used by Tasks 4 and 5): constants `CHECK_HOLD_MS = 500`, `CORRECT_MS = 600`; locals `sortEach`, `counting` (true while a counter stands; Tasks 4/5 widen it), `timers`, `later(f, ms)`, `flashes: Map<number, GuessMarkText>`, `busyUntil`, `markNow()`, `trayOrder`, `nextPick()`, `judge(card, k)`; `settle(held = -1, ms = SETTLE_MS)`.
  - Test helpers added to `tests/cards-gate-tap.test.ts` (used by Tasks 4 and 5): `last(o)`, `counter(m)`, `trayOrder(g)`, `lastAt(o, g, i)`, `inBox(g, p, b)`; `open()` returns `fades: { id: string; a: number }[]`.

- [ ] **Step 1: Write the failing pure test**

Create `tests/cards-counter.test.ts`:

```ts
// The check-each counter (round 7 §3.1.6): ✓ n · ✗ m, green, ink, red,
// centred on the boxes, and faded with "yours" at the next command.
import { expect, test } from "vitest";
import { cardsGeometry, counterAt, type CardsElementLike } from "../src/spec/cards";
import { checkDrop, initialArrangement } from "../src/cards/model";
import { counterMarks } from "../src/cards/counter";
import { FADED, RIGHT, TRUTH, WRONG, fadeYours } from "../src/guess/reveal";

const two: CardsElementLike = { id: "c", type: "cards", bins: ["Fixed", "Variable"], items: [{ text: "Rent", bin: "Fixed" }, { text: "Flour", bin: "Variable" }, { text: "Tax", bin: "Fixed" }] };

test("✓ n · ✗ m, in green, ink and red, all fading at the next command", () => {
  const g = cardsGeometry(two);
  const a = checkDrop(g, initialArrangement(g), 0, 1).arr;
  const m = counterMarks(g, a);
  expect(m.texts.map((t) => t.text)).toEqual(["✓ 0", "·", "✗ 1"]);
  expect(m.texts.map((t) => t.color)).toEqual([RIGHT, TRUTH, WRONG]);
  expect(m.texts.every((t) => t.gap === true && t.size === 20)).toBe(true);
  expect(fadeYours(m, FADED).texts.every((t) => t.opacity === FADED)).toBe(true);
  // A flash rides along after the counter.
  expect(counterMarks(g, a, [{ at: [0, 0], text: "✗", anchor: "start" }]).texts).toHaveLength(4);
});

test("rise (today's layout): centred above the boxes, on the canvas", () => {
  const g = cardsGeometry(two);
  const [x, y] = counterAt(g);
  const top = Math.max(...g.binBoxes.map((b) => b.c[1] + b.h / 2));
  expect(y).toBeGreaterThan(top);
  expect(y).toBeLessThanOrEqual(736);
  const left = Math.min(...g.binBoxes.map((b) => b.c[0] - b.w / 2));
  const right = Math.max(...g.binBoxes.map((b) => b.c[0] + b.w / 2));
  expect(x).toBeCloseTo((left + right) / 2, 5);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/cards-counter.test.ts`
Expected: FAIL — `counterAt` and `../src/cards/counter` do not exist.

- [ ] **Step 3: `counterAt` and the counter module**

In `src/spec/cards.ts`, `CardsGeometry`, after `each?: true;`:

```ts
  /** sort, select, deck (round 7 §5): drop — the cards above the boxes; side — beside them; rise — below (absent: rise). */
  layout?: "drop" | "side" | "rise";
```

After `CARD_FLOOR` (line 296):

```ts
/** check: each (round 7 §3.1.6): the counter's row under the boxes (drop, side). */
export const COUNTER_ROOM = 34;

/** Where the counter stands: centred on the boxes — above them in rise, under them otherwise. */
export function counterAt(g: CardsGeometry): Pt {
  const bs = g.binBoxes;
  const x = (Math.min(...bs.map((b) => b.c[0] - b.w / 2)) + Math.max(...bs.map((b) => b.c[0] + b.w / 2))) / 2;
  if ((g.layout ?? "rise") === "rise") return [x, Math.min(736, Math.max(...bs.map((b) => b.c[1] + b.h / 2)) + 22)];
  return [x, Math.min(...bs.map((b) => b.c[1] - b.h / 2)) - 22];
}
```

Create `src/cards/counter.ts`:

```ts
// The check-each counter (round 7 §3.1.6): ✓ right · ✗ wrong so far, small,
// on the figure by the boxes. Its texts carry `gap`, so it fades with
// "yours" at the next command (guess/reveal.ts fadeYours). Pure.

import { counterAt, type CardsGeometry } from "../spec/cards";
import { GUESS_COLOR, type GuessMarks, type GuessMarkText } from "../guess/marks";
import { RIGHT, TRUTH, WRONG } from "../guess/reveal";
import { checkTally, type Arrangement } from "./model";

/** A card corrected for the viewer stands at this strength. */
export const CORRECTED = 0.45;
export const COUNTER_SIZE = 20;

/** The counter for this arrangement, then any flashes still standing (`extra`). */
export function counterMarks(g: CardsGeometry, a: Arrangement, extra: GuessMarkText[] = []): GuessMarks {
  const { right, wrong } = checkTally(g, a);
  const [x, y] = counterAt(g);
  const at = (dx: number): [number, number] => [x + dx, y];
  const texts: GuessMarkText[] = [
    { at: at(-10), text: `✓ ${right}`, anchor: "end", color: RIGHT, size: COUNTER_SIZE, gap: true },
    { at: at(0), text: "·", anchor: "middle", color: TRUTH, size: COUNTER_SIZE, gap: true },
    { at: at(10), text: `✗ ${wrong}`, anchor: "start", color: WRONG, size: COUNTER_SIZE, gap: true },
  ];
  return { color: GUESS_COLOR, lines: [], texts: [...texts, ...extra] };
}
```

Run: `npx vitest run tests/cards-counter.test.ts` → PASS.

- [ ] **Step 4: Write the failing gate tests**

In `tests/cards-gate-tap.test.ts`:

(a) In `open()`, record fades and return them — the session literal and the return become:

```ts
    const fades: { id: string; a: number }[] = [];
    const session: CardsSession = {
      geometry: g,
      start: initialArrangement(g),
      place: (id, dx, dy, scale = 1) => void placed.push({ id, dx, dy, scale }),
      show: () => {},
      mark: (m) => void marks.push(m),
      fade: (id, a) => void fades.push({ id, a }),
    };
```
```ts
    return { stage, gate, done, ac, placed, marks, fades, result: () => result, answer: () => stage.find("cs-guess-answer")! };
```

(b) After `const two: CardsElementLike = …` add:

```ts
/** check: end — today's sort: tap-to-cycle, Answer. */
const twoEnd: CardsElementLike = { ...two, check: "end" };
type Opened = Awaited<ReturnType<typeof open>>;
const last = (o: Opened) => o.marks[o.marks.length - 1];
/** The counter's numbers in a mark set. */
const counter = (m: GuessMarks | null | undefined) => {
  const t = m?.texts ?? [];
  const n = (re: RegExp) => Number(t.find((x) => re.test(x.text))?.text.replace(/\D/g, "") ?? NaN);
  return { right: n(/^✓ \d+$/), wrong: n(/^✗ \d+$/) };
};
/** The tray, top row first, left to right — the order the gate picks cards in. */
const trayOrder = (g: CardsGeometry) => g.cards.map((_, i) => i).sort((a, b) => g.home[b][1] - g.home[a][1] || g.home[a][0] - g.home[b][0]);
/** Where card i was last placed (logical). */
const lastAt = (o: Opened, g: CardsGeometry, i: number): [number, number] => {
  const p = o.placed.filter((q) => q.id === g.cards[i]).pop()!;
  return [g.home[i][0] + p.dx, g.home[i][1] + p.dy];
};
const inBox = (g: CardsGeometry, p: [number, number], b: number) => {
  const bx = g.binBoxes[b];
  return Math.abs(p[0] - bx.c[0]) <= bx.w / 2 && Math.abs(p[1] - bx.c[1]) <= bx.h / 2;
};
```

(c) The tap-to-cycle tests are `check: "end"` now: in the tests "sort: taps send a card row → box 1 …" (line 158), "a drag still works" (line 176) and "a second tap on the same spot …" (line 288) replace `cardsGeometry(two)` with `cardsGeometry(twoEnd)`.

(d) Add a new describe block at the end of the file:

```ts
describe("check: each (round 7 §3)", () => {
  test("no Answer; the counter from 0; a tap on a box sends the picked card, judged; a wrong one glides to its right box, faded", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    expect(o.answer().hidden).toBe(true);
    expect(counter(last(o))).toEqual({ right: 0, wrong: 0 });
    const [a, b, c] = trayOrder(g);
    tap(o.gate, g.binBoxes[g.truthBin[a]].c);
    expect(counter(last(o))).toEqual({ right: 1, wrong: 0 });
    expect(last(o)!.texts.some((t) => t.text === "✓")).toBe(true);
    tap(o.gate, g.binBoxes[1 - g.truthBin[b]].c);
    expect(counter(last(o))).toEqual({ right: 1, wrong: 1 });
    expect(last(o)!.texts.some((t) => t.text === "✗")).toBe(true);
    await wait(1300);
    expect(inBox(g, lastAt(o, g, b), g.truthBin[b])).toBe(true);
    expect(o.fades).toContainEqual({ id: g.cards[b], a: 0.45 });
    // Nothing red left on the figure but the counter.
    expect(last(o)!.texts.some((t) => t.text === "✗")).toBe(false);
    tap(o.gate, g.binBoxes[g.truthBin[c]].c);
    await o.done;
    const ans = decodeArrangement(g, o.result()!)!;
    expect(ans.first).toEqual(g.cards.map((_, i) => (i === b ? 1 - g.truthBin[b] : g.truthBin[i])));
    expect(ans.boxes.flat().sort()).toEqual([0, 1, 2]);
    // The counter stands after the answer.
    expect(counter(last(o))).toEqual({ right: 2, wrong: 1 });
  });

  test("a placed card stays put: pressing it is a tap on its box, never a drag", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const [a] = trayOrder(g);
    tap(o.gate, g.binBoxes[g.truthBin[a]].c);
    await wait(250);
    const where = lastAt(o, g, a);
    fire(o.gate, "pointerdown", at(where));
    fire(o.gate, "pointermove", at([where[0] + 200, where[1] - 200]));
    fire(o.gate, "pointerup", at([where[0] + 200, where[1] - 200]));
    key("0");
    await wait(250);
    expect(lastAt(o, g, a)[0]).toBeCloseTo(where[0], 0);
    expect(lastAt(o, g, a)[1]).toBeCloseTo(where[1], 0);
    o.ac.abort();
    await o.done;
  });

  test("two wrong drops inside the hold both end in their right boxes (Review Focus 1)", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const [a, b] = trayOrder(g);
    tap(o.gate, g.binBoxes[1 - g.truthBin[a]].c);
    await wait(100);
    tap(o.gate, g.binBoxes[1 - g.truthBin[b]].c);
    await wait(1400);
    expect(inBox(g, lastAt(o, g, a), g.truthBin[a])).toBe(true);
    expect(inBox(g, lastAt(o, g, b), g.truthBin[b])).toBe(true);
    expect(counter(last(o))).toEqual({ right: 0, wrong: 2 });
    o.ac.abort();
    await o.done;
  });

  test("a drag is judged on release in a box; let go off the boxes it goes back unjudged", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const c = trayOrder(g)[2];
    fire(o.gate, "pointerdown", at(g.home[c]));
    fire(o.gate, "pointermove", at([g.home[c][0], 5]));
    fire(o.gate, "pointerup", at([g.home[c][0], 5]));
    await wait(250);
    expect(counter(last(o))).toEqual({ right: 0, wrong: 0 });
    fire(o.gate, "pointerdown", at(g.home[c]));
    fire(o.gate, "pointermove", at(g.binBoxes[g.truthBin[c]].c));
    fire(o.gate, "pointerup", at(g.binBoxes[g.truthBin[c]].c));
    expect(counter(last(o))).toEqual({ right: 1, wrong: 0 });
    o.ac.abort();
    await o.done;
  });

  test("keys 1/2 send the picked card", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const [a] = trayOrder(g);
    key(String(g.truthBin[a] + 1));
    expect(counter(last(o))).toEqual({ right: 1, wrong: 0 });
    o.ac.abort();
    await o.done;
  });

  test("an abort mid-glide puts every card back, unfaded (Review Focus 2)", async () => {
    const g = cardsGeometry(two);
    const o = await open(g);
    const [a] = trayOrder(g);
    tap(o.gate, g.binBoxes[1 - g.truthBin[a]].c);
    await wait(700);
    o.ac.abort();
    await o.done;
    expect(o.result()).toBe(null);
    for (const id of g.cards) {
      const p = o.placed.filter((q) => q.id === id).pop();
      if (p) expect([p.dx, p.dy]).toEqual([0, 0]);
      const f = o.fades.filter((q) => q.id === id).pop();
      if (f) expect(f.a).toBe(1);
    }
  });
});
```

- [ ] **Step 5: Run to verify they fail**

Run: `npx vitest run tests/cards-gate-tap.test.ts`
Expected: the new "check: each" tests FAIL (the Answer button shows; no counter mark); the `twoEnd` tests pass.

- [ ] **Step 6: Words, the session's `fade`, the player wiring**

`src/ui/gate-words.ts`, EN `cards` (after `sort:`):

```ts
    sortEach: "Tap a box, or drag a card",
```

NB `cards` (after `sort:`):

```ts
    sortEach: "Trykk på en boks, eller dra et kort",
```

`src/render/player.ts`, `CardsSession`, after `mark(…)`:

```ts
  /** Fade a card (check: each — a corrected card, round 7 §3.1); 1 restores it. */
  fade?(cardId: string, alpha: number): void;
```

In `cardsAsk`, after the `mark` arrow (line ~1975):

```ts
    const fade = (id: string, a: number): void => this.elements.get(id)?.setOpacity?.(a);
```

and the session literal at line 1987 becomes `{ geometry: g, start, place, show, mark, fade } satisfies CardsSession`.

- [ ] **Step 7: The gate (src/ui/cards-gate.ts)**

Imports: extend the model import with `allChecked, checkDrop, isPlaced, putIn`; add

```ts
import { CORRECTED, counterMarks } from "../cards/counter";
import { tick } from "../guess/reveal";
import { GUESS_COLOR, type GuessMarkText } from "../guess/marks";
```

(replacing the existing `import { GUESS_COLOR } from "../guess/marks";`).

Header comment, the `sort` line becomes:

```ts
//   sort     check: each (default, round 7 §3) — the next card is picked;
//            tap a box (or drag a card there): it is judged at once, a
//            wrong one glides to its right box, faded; a counter keeps the
//            score; the last card answers. check: end — a tap sends a card
//            round the boxes and back (row → 1 → 2 → … → row) → Answer.
```

Constants, after `WRONG_COLOR`:

```ts
/** check: each (round 7 §3.1): a wrong card's ✗ stands in the box it was dropped in this long, */
const CHECK_HOLD_MS = 500;
/** then it glides to its right box over this. */
const CORRECT_MS = 600;
```

Replace `const needsAnswer = …` (line 86) with:

```ts
      // check: each — a plain sort judges every drop (round 7 §3.1): no Answer.
      const sortEach = mode === "sort" && g.each === true && !deck && g.select !== true;
      /** A counter stands while the cards are judged. */
      const counting = sortEach;
      const needsAnswer = mode !== "compare" && mode !== "decide" && !deck && !sortEach;
```

`hintKey` (line 92):

```ts
      const hintKey = deck ? "deck" : g.select ? "select" : sortEach ? "sortEach" : mode;
```

`settle` takes a duration: its first line becomes `const settle = (held = -1, ms = SETTLE_MS): void => {` and `/ SETTLE_MS` inside it becomes `/ ms`.

After `const binAt = …` (line 207), add:

```ts
      // —— check: each (round 7 §3) ——
      /** Timers that must not outlive the gate (a ✓ going, a glide to the right box). */
      const timers: number[] = [];
      const later = (f: () => void, ms: number): void => void timers.push(window.setTimeout(() => !settled && f(), ms));
      /** Each card's ✓ or ✗ while it stands — one map, so a quick next drop never wipes the last. */
      const flashes = new Map<number, GuessMarkText>();
      /** Until when a card still lands or glides: the last answers after. */
      let busyUntil = 0;
      const markNow = (): void => session.mark(counterMarks(g, arr, [...flashes.values()]));
      /** The tray, top row first, left to right: the order cards are picked in. */
      const trayOrder = g.cards.map((_, i) => i).sort((a, b) => g.home[b][1] - g.home[a][1] || g.home[a][0] - g.home[b][0]);
      const nextPick = (): number => trayOrder.find((c) => !isPlaced(arr, c)) ?? -1;
      /** Card dropped in box k (-1: the tray): it lands there, ✓ or ✗; a wrong one then glides to its right box, faded. */
      const judge = (card: number, k: number): void => {
        const { ok, arr: judged } = checkDrop(g, arr, card, k);
        arr = putIn({ ...arr, first: judged.first }, card, k);
        settle();
        const at = positions(g, arr)[card];
        flashes.set(card, tick([at[0] + g.w / 2 + 2, at[1]], ok, "start", 24));
        markNow();
        const now = performance.now();
        if (ok) {
          later(() => {
            flashes.delete(card);
            markNow();
          }, FLASH_MS);
          busyUntil = Math.max(busyUntil, now + SETTLE_MS);
        } else {
          later(() => {
            flashes.delete(card);
            arr = putIn(arr, card, g.truthBin[card]);
            settle(-1, CORRECT_MS);
            session.fade?.(g.cards[card], CORRECTED);
            markNow();
          }, CHECK_HOLD_MS);
          busyUntil = Math.max(busyUntil, now + CHECK_HOLD_MS + CORRECT_MS);
        }
        focus = nextPick();
        placeRing();
        if (allChecked(g, arr)) later(() => finish(encodeArrangement(g, arr)), Math.max(0, busyUntil - now) + LAST_MS);
      };
```

`finish` (line 209): after `window.clearTimeout(flashTimer);` add

```ts
        for (const t of timers) window.clearTimeout(t);
        // The counter stands after the answer, its flashes gone.
        if (counting && result !== null) {
          flashes.clear();
          session.mark(counterMarks(g, arr));
        }
```

`onAbort` becomes:

```ts
      const onAbort = (): void => {
        // Back to where they were drawn, unfaded: the plan owns the cards again.
        g.cards.forEach((id) => session.place(id, 0, 0));
        g.cards.forEach((id) => session.fade?.(id, 1));
        session.mark(null);
        finish(null);
      };
```

and the Skip click handler's body becomes:

```ts
          e.stopPropagation();
          g.cards.forEach((id) => session.place(id, 0, 0));
          g.cards.forEach((id) => session.fade?.(id, 1));
          session.mark(null);
          finish(null);
```

`pointerdown`, after the `if (deck) { … return; }` block:

```ts
        if (sortEach) {
          // Tap the box, not the card (round 7 §3.1.5): a tap on a box — or on
          // a card already in one — sends the picked card there; a tray card
          // is picked, or dragged.
          const hit = cardAt(g, shown, p);
          if (hit < 0 || isPlaced(arr, hit)) {
            const k = binAt(p);
            if (k >= 0 && focus >= 0 && !isPlaced(arr, focus)) judge(focus, k);
            return;
          }
        }
```

and the lastTap rescue line gets `!counting &&`:

```ts
        if (card < 0 && !counting && lastTap && performance.now() - lastTap.t < TAP_AGAIN_MS && Math.abs(p[0] - lastTap.at[0]) <= g.w / 2 && Math.abs(p[1] - lastTap.at[1]) <= g.h / 2) card = lastTap.card;
```

`endDrag`, as the first thing inside `if (e.type === "pointerup") {`:

```ts
          if (sortEach) {
            if (!moved) {
              // A tap on a tray card picks it; the next tap on a box sends it.
              focus = card;
              placeRing();
              return;
            }
            const k = binAt(shown[card]);
            if (k >= 0) {
              judge(card, k);
              return;
            }
            // Let go off the boxes: back to the tray, unjudged.
          }
```

(the fall-through then reaches `arr = drop(…)` — guard it: change `arr = drop(g, arr, card, mode === "fill" ? at : shown[card]);` to `if (!sortEach) arr = drop(g, arr, card, mode === "fill" ? at : shown[card]);` so the final `settle()` glides the card home.)

`onKey`: in the Tab branch, first thing after `e.preventDefault();`:

```ts
          if (counting) {
            // Only the cards still in the tray: a placed card is final.
            const open = trayOrder.filter((c) => !isPlaced(arr, c));
            if (open.length === 0) return;
            const i = open.indexOf(focus);
            focus = open[((i < 0 ? -1 : i) + (e.shiftKey ? open.length - 1 : 1) + open.length) % open.length];
            placeRing();
            return;
          }
```

After `if (focus < 0) return;` (line 445):

```ts
        if (sortEach) {
          // 1–4 send the picked card; 0 means nothing (a placed card is final).
          const d = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
          if (d < 0 || d >= g.bins.length || isPlaced(arr, focus)) return;
          e.preventDefault();
          judge(focus, d);
          return;
        }
```

At mount, after `dock.relayout();` (line 494):

```ts
      // check: each — the first tray card is picked (a deck has no tray to
      // pick from); the counter starts at 0.
      if (counting) {
        if (!deck) {
          focus = nextPick();
          placeRing();
        }
        markNow();
      }
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/cards-gate-tap.test.ts tests/cards-counter.test.ts tests/cards-check.test.ts tests/guess-gate-field.test.ts`
Expected: PASS. Then `npx tsc --noEmit` clean.

- [ ] **Step 9: Commit**

```bash
git add src/cards/counter.ts src/spec/cards.ts src/render/player.ts src/ui/gate-words.ts src/ui/cards-gate.ts tests/cards-gate-tap.test.ts tests/cards-counter.test.ts
git commit -m "Round 7: sort judged on each drop — tap a box, glide to the right box, faded, counter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

---

### Task 3: The player under `check: "each"` — score vars, nothing to reveal, faded cards and counter that survive seeks (spec §3.1.7–8, §3.3–3.4, build order 1)

**Files:**
- Modify: `src/render/player.ts` — `interface Beside` (line 147), `baseOpacity` (line 1197), new `besideDim`, `fadeBesides` (line 3091), `dropBeside` (line 2814), `cardsAsk` (lines 2062-2190); imports (line 50)
- Test: `tests/cards-check-player.test.ts` (new)

**Interfaces:**
- Consumes: `counterMarks`, `CORRECTED` (Task 2, `src/cards/counter.ts`); `Arrangement.first`, `CardsGeometry.each` (Task 1).
- Produces:
  - `Beside.dim?: string[]` — card ids drawn at `CORRECTED` (0.45) while the reveal stands, `FADED` (0.35) once it has faded.
  - In `cardsAsk`: `const checked = answered && g.each === true && arrangement.first !== undefined;` (Task 6 builds on it). Under `checked`: `{store}` = first-drop right count, the beside reveal is skipped, cards glide into their truth slots (the existing `moves` glide), the counter becomes the beside's marks.
  - `{store}.total` is set for every cards ask (`String(score.count)`).

- [ ] **Step 1: Write the failing test**

Create `tests/cards-check-player.test.ts`:

```ts
// check: each in the player (round 7 §3): the first drops are the score,
// nothing is left to reveal, the corrected cards stay faded and the counter
// stands — through a seek forward, gone on a seek back; a movie has neither.
import { describe, expect, test } from "vitest";
import { Player, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { cardsGeometry, type CardsElementLike, type CardsGeometry } from "../src/spec/cards";
import { cardsTruth, checkDrop, encodeArrangement, initialArrangement, type Arrangement } from "../src/cards/model";
import type { GuessMarks } from "../src/guess/marks";
import { FADED } from "../src/guess/reveal";
import type { Command } from "../src/spec/types";
import type { Pt } from "../src/layout/model";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 2) as unknown as number) as typeof requestAnimationFrame;

class QuietSpeech extends SpeechManager {
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return Promise.resolve(); }
  override cancel(): void {}
}

const sort = cardsGeometry({ id: "s", type: "cards", bins: ["Odd", "Even"], items: [{ text: "1", bin: "Odd" }, { text: "2", bin: "Even" }, { text: "3", bin: "Odd" }] } as CardsElementLike);

function makePlayer(geom: CardsGeometry, ask: Record<string, unknown>) {
  const nudges: { id: string; dx: number; dy: number }[] = [];
  const marks = new Map<string, GuessMarks | null>();
  const history: { at: number; m: GuessMarks | null }[] = [];
  const base: Record<string, unknown> = {
    setOffset: (id: string, dx: number, dy: number) => nudges.push({ id, dx, dy }),
    setGuessMarks: (owner: string, m: GuessMarks | null) => {
      marks.set(owner, m);
      history.push({ at: performance.now(), m });
    },
  };
  const effects = new Proxy(base, { get: (t, k: string) => t[k] ?? (() => {}) }) as unknown as BackendEffects;
  const commands: Command[] = [{ draw: [geom.id] } as Command, { ask: { question: "Which box does each number go in? Sort every card.", on: geom.id, store: "s", ...ask } } as Command, { speak: "Next." } as Command];
  const truthOffsets: Record<string, Pt> = {};
  geom.cards.forEach((c, i) => (truthOffsets[c] = [geom.truth[i][0] - geom.home[i][0], geom.truth[i][1] - geom.home[i][1]]));
  const plan = planCommands(commands, [geom.id, ...geom.cards], { cardsFor: (id) => (id === geom.id ? { cards: geom.cards, offsets: truthOffsets } : null) });
  const placed = new Map<string, Pt>();
  const opacity = new Map<string, number>();
  const elements = new Map(
    geom.cards.map((id) => [
      id,
      { setOffset: (dx: number, dy: number) => placed.set(id, [dx, dy]), finish: () => {}, hide: () => {}, setOpacity: (a: number) => opacity.set(id, a), setPoints: () => {}, setText: () => {} },
    ]),
  );
  const player = new Player(plan, elements as never, new QuietSpeech(), null, { mode: "narrated", effects });
  const rp: Reprojector = { frame: () => {}, commit: () => elements as never, committed: () => null };
  player.reprojector = rp;
  const runtime: GuessRuntime = { setup: () => ({ handles: [], pin: {}, warnings: [] }), patch: () => ({ params: {} }), cards: (id) => (id === geom.id ? geom : null) };
  player.guess = runtime;
  return { player, nudges, marks, placed, history, opacity };
}

/** Card 0 first dropped in Even (wrong), the rest right. */
function answered(): Arrangement {
  let a = initialArrangement(sort);
  for (const [c, b] of [[0, 1], [1, 1], [2, 0]] as const) a = checkDrop(sort, a, c, b).arr;
  return a;
}
const counterText = (m: GuessMarks | null | undefined) => (m?.texts ?? []).map((t) => t.text);

describe("check: each in the player", () => {
  test("{s} is the first-drop count, {s.total} the number of cards; wrong when any first drop was", async () => {
    const { player } = makePlayer(sort, {});
    player.askGate = async () => encodeArrangement(sort, answered());
    await player.play();
    expect(player.vars.get("s")).toBe("2");
    expect(player.vars.get("s.total")).toBe("3");
    expect(player.vars.get("s.ok")).toBe("false");
  });

  test("nothing left to reveal: the counter is the marks, no arrows; the corrected card stays faded; every card at its truth", async () => {
    const { player, marks, placed, history, opacity } = makePlayer(sort, {});
    player.askGate = async () => encodeArrangement(sort, answered());
    await player.play();
    const full = history.filter((h) => h.m !== null && counterText(h.m).join(" ") === "✓ 2 · ✗ 1");
    expect(full.length).toBeGreaterThan(0);
    expect(full[0].m!.lines).toHaveLength(0);
    expect(full[0].m!.texts.every((t) => t.opacity === undefined)).toBe(true);
    // After "Next." the counter and the corrected card fade with yours.
    expect(marks.get("cards_1")!.texts.every((t) => t.opacity === FADED)).toBe(true);
    expect(opacity.get(sort.cards[0])).toBe(FADED);
    sort.cards.forEach((id, i) => expect(placed.get(id)).toEqual([sort.truth[i][0] - sort.home[i][0], sort.truth[i][1] - sort.home[i][1]]));
  });

  test("seek: forward past the ask restores the counter and the faded card; back before it clears both (Review Focus 3)", async () => {
    const { player, marks, opacity } = makePlayer(sort, {});
    player.askGate = async () => encodeArrangement(sort, answered());
    await player.play();
    player.renderUpTo(1);
    expect(marks.get("cards_1") ?? null).toBeNull();
    expect(opacity.get(sort.cards[0])).toBe(1);
    player.renderUpTo(2);
    expect(counterText(marks.get("cards_1"))).toEqual(["✓ 2", "·", "✗ 1"]);
    expect(opacity.get(sort.cards[0])).toBe(0.45);
    expect(opacity.get(sort.cards[1])).toBe(1);
    player.renderUpTo(3);
    expect(opacity.get(sort.cards[0])).toBe(FADED);
  });

  test("the movie: no counter, nothing faded", async () => {
    const { player, marks, opacity } = makePlayer(sort, {});
    await player.play();
    expect(marks.get("cards_1") ?? null).toBeNull();
    expect([...opacity.values()].every((a) => a === 1)).toBe(true);
  });

  test("an answer without first (check: end, or older) keeps the beside reveal (Review Focus 4)", async () => {
    const { player, history } = makePlayer(sort, {});
    player.askGate = async () => encodeArrangement(sort, cardsTruth(sort));
    await player.play();
    const ms = history.filter((h) => h.m !== null).map((h) => h.m!);
    expect(ms.some((m) => m.texts.some((t) => t.text === "✓"))).toBe(true);
    expect(ms.some((m) => m.texts.some((t) => /^✓ \d+$/.test(t.text)))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cards-check-player.test.ts`
Expected: FAIL — `{s}` reads "2 of 3", `s.total` is undefined, the marks are the beside ✓/✗ with arrows.

- [ ] **Step 3: `Beside.dim` and the opacity rules**

`interface Beside` (line 147), after `styles?: …;`:

```ts
  /** check: each (round 7 §3): the cards corrected for the viewer — drawn at CORRECTED, at FADED once the reveal fades. */
  dim?: string[];
```

Imports: add `import { CORRECTED, counterMarks } from "../cards/counter";`.

`baseOpacity` (line 1197) becomes:

```ts
  /** An element's own opacity at a scene: a kept tile of a faded beside reveal stays faded; a corrected card stays dimmed. */
  private baseOpacity(id: string, scene: SceneState): number {
    if (this.besideFadedShown(id)) return FADED;
    return this.besideDim(id) ?? (scene.opacities[id] ?? 1);
  }

  /** A corrected card's strength (check: each), or null. */
  private besideDim(id: string): number | null {
    for (const b of this.besides.values()) if (b.dim?.includes(id)) return b.faded ? FADED : CORRECTED;
    return null;
  }
```

`dropBeside` (line 2814), the `room` line becomes:

```ts
    const room = b.params !== undefined || b.offsets !== undefined || b.shown !== undefined || b.styles !== undefined || b.dim !== undefined;
```

`fadeBesides` (line 3091), after the tiles line:

```ts
      // Cards corrected for the viewer are yours too.
      for (const el of this.els(b.dim ?? [])) el.setOpacity?.(FADED);
```

- [ ] **Step 4: `cardsAsk`**

After `const ok = answered && score.ok;` (line 2064):

```ts
    // check: each (round 7 §3): judged as dropped — the first drops are the
    // score, and there is nothing left to reveal.
    const checked = answered && g.each === true && arrangement.first !== undefined;
```

The `text` line (line 2071): the last alternative becomes `checked ? String(score.within) : `${score.within} of ${score.count}``:

```ts
    const text = g.mode === "decide" ? (choice >= 0 ? g.texts[choice] : "") : formula && formula.blanks.length === 1 ? (tileIn[0] ?? "") : checked ? String(score.within) : `${score.within} of ${score.count}`;
```

After `this.vars.set(`${base}.count`, String(score.count));`:

```ts
      this.vars.set(`${base}.total`, String(score.count));
```

The `beside` line (line 2118):

```ts
    const beside = !checked && step.revealStyle !== "morph" && answered;
```

(`moves` stays as it is: under `checked` the cards glide from their drop-order slots into their truth slots, which is what the plan's state after the ask holds.)

Before `this.applyKey(this.planned(index));` (line 2172):

```ts
    if (checked) {
      // The corrected cards stay faded and the counter is the marks — through
      // the commit below and a seek forward (besidesAt needs the marks).
      const dim = g.cards.filter((_, i) => arrangement.first![i] !== g.truthBin[i]);
      this.putBeside(owner, { index, marks: null, faded: false, ...(dim.length > 0 ? { dim } : {}) });
    }
```

The marks branch after `applyScene` — between the `if (beside) { … }` block and `else if (answered) mark(cardsMarks(g, arrangement));` insert:

```ts
    } else if (checked) {
      const marks = counterMarks(g, arrangement);
      mark(marks);
      const b = this.besides.get(owner);
      if (b) b.marks = marks;
```

so the chain reads `if (beside) {…} else if (checked) {…} else if (answered) mark(cardsMarks(g, arrangement));`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/cards-check-player.test.ts tests/cards-beside.test.ts tests/cards-deck-player.test.ts tests/ask-stage.test.ts tests/score-tally.test.ts`
Expected: PASS. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/render/player.ts tests/cards-check-player.test.ts
git commit -m "Round 7: player — first-drop score, {f.total}, faded corrected cards and the counter restored on seek

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

---

### Task 4: The deck under `check: "each"` (spec §3.1, build order 2)

**Files:**
- Modify: `src/ui/cards-gate.ts` — `counting`, `dealTo` (line 186), `finish` (line 215)
- Modify: `tests/cards-gate-tap.test.ts` — the deck describe (line 210)

**Interfaces:**
- Consumes (Task 2, in `cards-gate.ts`): `later`, `flashes`, `markNow`, `busyUntil`, `CHECK_HOLD_MS`, `CORRECT_MS`, `CORRECTED`, `counting`; the deck's own `fly(card, to, s1, ms)`, `FLY_MS`, `FLASH_MS`, `LAST_MS`. Model: `checkDrop`, `putIn`, `isPlaced`.
- Consumes (test file, Task 2): `last(o)`, `counter(m)`, `lastAt(o, g, i)`, `inBox(g, p, b)`, `o.fades`.
- Produces: `deckEach` local; `counting = sortEach || deckEach`.

- [ ] **Step 1: Write the failing test**

In `tests/cards-gate-tap.test.ts`, the deck fixture stays; add `const deckEnd: CardsElementLike = { ...deck, check: "end" };` after it, and in the first deck test ("the top card grows; …") use `cardsGeometry(deckEnd)` (its assertions are today's behaviour). Add to the deck describe:

```ts
  test("check: each — a wrong card flies on to its right box, faded; the counter keeps score; the last answers", async () => {
    const g = cardsGeometry({ ...deck, items: (deck.items as object[]).slice(0, 4) } as CardsElementLike);
    const o = await open(g);
    expect(counter(last(o))).toEqual({ right: 0, wrong: 0 });
    // Dealt quickly: the second wrong, the rest right (Review Focus 1 for a deck).
    g.deal!.forEach((card, s) => key(String(s === 1 ? 2 - g.truthBin[card] : g.truthBin[card] + 1)));
    await o.done;
    const a = decodeArrangement(g, o.result()!)!;
    const wrong = g.deal![1];
    expect(a.boxes[g.truthBin[wrong]]).toContain(wrong);
    expect(a.first![wrong]).toBe(1 - g.truthBin[wrong]);
    expect(o.fades).toContainEqual({ id: g.cards[wrong], a: 0.45 });
    expect(counter(last(o))).toEqual({ right: 3, wrong: 1 });
    expect(inBox(g, lastAt(o, g, wrong), g.truthBin[wrong])).toBe(true);
    // Every card ends inside its right box.
    g.cards.forEach((_, i) => expect(inBox(g, lastAt(o, g, i), g.truthBin[i])).toBe(true));
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cards-gate-tap.test.ts -t "check: each — a wrong card flies"`
Expected: FAIL — no counter; the wrong card stays in the wrong box; no `first`.

- [ ] **Step 3: Implement**

In `src/ui/cards-gate.ts`, change the `counting` line to:

```ts
      /** A deck judging each card (round 7 §3.1): a wrong one flies on to its right box. */
      const deckEach = deck && g.each === true;
      /** A counter stands while the cards are judged. */
      const counting = sortEach || deckEach;
```

(`deckEach` must be declared after `deck`; put both lines right after the `sortEach` line.)

In `dealTo`, replace everything from `arr = { ...arr, boxes: … }` through the closing `}, FLY_MS);` of the flash timer with:

```ts
        if (deckEach) {
          // check: each — it flies to box k with ✓ or ✗; a wrong one then flies on to its right box, faded.
          const { ok, arr: judged } = checkDrop(g, arr, card, k);
          arr = putIn({ ...arr, first: judged.first }, card, k);
          const to = positions(g, arr)[card];
          fly(card, to, 1, FLY_MS);
          const now = performance.now();
          later(() => {
            flashes.set(card, tick([to[0] + g.w / 2 + 2, to[1]], ok, "start", 24));
            markNow();
          }, FLY_MS);
          if (ok) {
            later(() => {
              flashes.delete(card);
              markNow();
            }, FLY_MS + FLASH_MS);
            busyUntil = Math.max(busyUntil, now + FLY_MS);
          } else {
            later(() => {
              flashes.delete(card);
              const before = positions(g, arr);
              arr = putIn(arr, card, g.truthBin[card]);
              const after = positions(g, arr);
              // The cards dealt after it into that box move up a slot.
              g.cards.forEach((_, c) => {
                if (c !== card && isPlaced(arr, c) && (before[c][0] !== after[c][0] || before[c][1] !== after[c][1])) fly(c, after[c], 1, SETTLE_MS);
              });
              fly(card, after[card], 1, CORRECT_MS);
              session.fade?.(g.cards[card], CORRECTED);
              markNow();
            }, FLY_MS + CHECK_HOLD_MS);
            busyUntil = Math.max(busyUntil, now + FLY_MS + CHECK_HOLD_MS + CORRECT_MS);
          }
        } else {
          arr = { ...arr, boxes: arr.boxes.map((b, j) => (j === k ? [...b, card] : b)) };
          const to = positions(g, arr)[card];
          fly(card, to, 1, FLY_MS);
          const ok = rightCards(g, arr)[card];
          window.clearTimeout(flashTimer);
          flashTimer = window.setTimeout(() => {
            if (settled) return;
            session.mark({ color: ok ? RIGHT_COLOR : WRONG_COLOR, lines: [], texts: [{ at: [to[0] + g.w / 2 + 2, to[1]], text: ok ? "✓" : "✗", anchor: "start" }] });
            flashTimer = window.setTimeout(() => !settled && session.mark(null), FLASH_MS);
          }, FLY_MS);
        }
```

The end of `dealTo` becomes:

```ts
        if (dealt < g.deal!.length) {
          session.show([g.cards[g.deal![dealt]]]);
          fly(g.deal![dealt], g.home[g.deal![0]], big, GROW_MS);
        } else if (deckEach) later(() => finish(encodeArrangement(g, arr)), Math.max(0, busyUntil - performance.now()) + LAST_MS);
        else window.setTimeout(() => !settled && finish(encodeArrangement(g, arr)), FLY_MS + LAST_MS);
```

(`later`, `flashes`, `markNow` and `busyUntil` are declared after `dealTo` in the file; `dealTo` only runs after mount, so the closure reads them initialised.)

In `finish`, `if (deck) session.mark(null);` becomes `if (deck && !deckEach) session.mark(null);`. Header comment, the `deck` line gets: `check: each — a wrong card then flies on to its right box, faded; a counter keeps the score`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/cards-gate-tap.test.ts tests/cards-deck-player.test.ts tests/cards-check-player.test.ts`
Expected: PASS (the deck movie still flies every card to its truth, no counter). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/cards-gate.ts tests/cards-gate-tap.test.ts
git commit -m "Round 7: deck judged on each card — a wrong one flies on to its box, faded; counter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

---

### Task 5: Select ("tap all the …") under `check: "each"` — tap judged, Done sweeps the missed cards (spec §3.2, build order 3)

**Files:**
- Modify: `src/ui/gate-words.ts` — `GateWords.done`; EN/NB `done`, `cards.selectEach`
- Modify: `src/ui/cards-gate.ts`
- Modify: `tests/cards-gate-tap.test.ts`
- Test: `tests/gate-words-round7.test.ts` (new)

**Interfaces:**
- Consumes (Task 2/4, `cards-gate.ts`): `judge(card, k)`, `later`, `markNow`, `busyUntil`, `trayOrder`, `counting`, `CORRECT_MS`, `CORRECTED`, `settle(held, ms)`. Model: `checkDrop`, `isPlaced`.
- Produces: `GateWords.done: string` (EN "Done ▸", NB "Ferdig ▸"), `words.cards.selectEach`; `selectEach` local; `sweep()`; `SWEEP_MS = 150`. The Answer button of a select under each reads Done.

- [ ] **Step 1: Write the failing tests**

Create `tests/gate-words-round7.test.ts`:

```ts
// Round 7's gate words come in both tongues (Review Focus 5): a Norwegian
// cast never shows an English Done or hint.
import { expect, test } from "vitest";
import { gateWords } from "../src/ui/gate-words";

test("every cards hint has a Norwegian twin, and the new words exist in both", () => {
  const en = gateWords("en"), nb = gateWords("nb");
  expect(Object.keys(nb.cards).sort()).toEqual(Object.keys(en.cards).sort());
  for (const k of ["sortEach", "selectEach"]) {
    expect(en.cards[k]).toBeTruthy();
    expect(nb.cards[k]).toBeTruthy();
    expect(nb.cards[k]).not.toBe(en.cards[k]);
  }
  expect(en.done).toBe("Done ▸");
  expect(nb.done).toBe("Ferdig ▸");
});
```

In `tests/cards-gate-tap.test.ts`: the select test "select: tap the cards that belong in; a second tap takes one out" (line 187) uses `check: "end"` — its geometry becomes `cardsGeometry({ id: "z", type: "cards", select: "Mammals", check: "end", items: [{ text: "Whale", in: true }, "Shark", { text: "Bat", in: true }] })`. Add to the "check: each" describe:

```ts
  test("select: a tap judges; a wrong one goes back to the tray, faded; Done sweeps the missed in as ✗", async () => {
    const z = cardsGeometry({ id: "z", type: "cards", select: "Mammals", items: [{ text: "Whale", in: true }, "Shark", { text: "Bat", in: true }, "Trout"] });
    const o = await open(z);
    expect(o.stage.find("cs-figgate-hint")!.textContent).toMatch(/then Done/);
    expect(o.answer().hidden).toBe(false);
    expect(o.answer().textContent).toBe("Done ▸");
    tap(o.gate, z.home[0]); // Whale: ✓
    tap(o.gate, z.home[1]); // Shark: ✗, back to the tray, faded
    await wait(1300);
    expect(lastAt(o, z, 1)[0]).toBeCloseTo(z.home[1][0], 0);
    expect(lastAt(o, z, 1)[1]).toBeCloseTo(z.home[1][1], 0);
    expect(o.fades).toContainEqual({ id: z.cards[1], a: 0.45 });
    tap(o.gate, z.home[1]); // final: nothing
    expect(counter(last(o))).toEqual({ right: 1, wrong: 1 });
    o.answer().click(); // Bat missed (✗, goes in, faded); Trout stays out (✓)
    await o.done;
    const a = decodeArrangement(z, o.result()!)!;
    expect(a.first).toEqual([0, 0, -1, -1]);
    expect(a.boxes).toEqual([[0, 2]]);
    expect(o.fades).toContainEqual({ id: z.cards[2], a: 0.45 });
    expect(counter(last(o))).toEqual({ right: 2, wrong: 2 });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/gate-words-round7.test.ts tests/cards-gate-tap.test.ts`
Expected: FAIL — `done` and `selectEach` missing; the select taps cycle in and out unjudged.

- [ ] **Step 3: Words**

`src/ui/gate-words.ts`: in `interface GateWords` after `skip: string;`:

```ts
  /** A select's Answer under check: each (round 7 §3.2), and connect's. */
  done: string;
```

EN: `done: "Done ▸",` after `skip`; `cards.selectEach: "Tap the cards that belong, then Done",` after `select`.
NB: `done: "Ferdig ▸",` after `skip`; `cards.selectEach: "Trykk på kortene som hører hjemme, og trykk Ferdig",` after `select`.

- [ ] **Step 4: The gate**

In `src/ui/cards-gate.ts`, after the `deckEach` line:

```ts
      /** A select judging each tap (round 7 §3.2): Done judges the rest. */
      const selectEach = mode === "sort" && g.select === true && g.each === true;
```

and `counting` becomes `sortEach || deckEach || selectEach`. `hintKey`:

```ts
      const hintKey = deck ? "deck" : g.select ? (selectEach ? "selectEach" : "select") : sortEach ? "sortEach" : mode;
```

The Answer button label: `h("button", { class: "cs-cardgate-pill cs-guess-answer", type: "button" }, selectEach ? words.done : words.answer)`.

`pointerdown`, after the `if (sortEach) { … }` block:

```ts
        // select: a card already judged is final.
        if (selectEach) {
          const hit = cardAt(g, shown, p);
          if (hit < 0 || isPlaced(arr, hit)) return;
        }
```

`endDrag`, after the `if (sortEach) { … }` block:

```ts
          if (selectEach) {
            // A tap — or a drag into the box — puts it in, judged; a drag let go elsewhere goes back.
            if (!moved || binAt(shown[card]) >= 0) {
              judge(card, 0);
              return;
            }
          }
```

and the guard on the `drop` call becomes `if (!sortEach && !selectEach) arr = drop(…);`.

Keys: the `if (sortEach) { … digits … }` block's condition becomes `if (sortEach || selectEach)` (a select has one box, so only `1` sends). The `Enter` branch's `else if (needsAnswer) finish(encodeArrangement(g, arr));` becomes:

```ts
          else if (needsAnswer) {
            if (selectEach) sweep();
            else finish(encodeArrangement(g, arr));
          }
```

After `judge` (Task 2's block), add:

```ts
      /** select, Done (round 7 §3.2): the cards left out are judged — a missed one glides into the box, faded, ✗, one by one; one that stays out is ✓. */
      const SWEEP_MS = 150;
      let swept = false;
      const sweep = (): void => {
        if (swept) return;
        swept = true;
        answer.disabled = true;
        const rest = trayOrder.filter((c) => !isPlaced(arr, c));
        for (const c of rest) if (g.truthBin[c] < 0) arr = checkDrop(g, arr, c, -1).arr;
        markNow();
        const missed = rest.filter((c) => g.truthBin[c] >= 0);
        missed.forEach((c, k) =>
          later(() => {
            arr = checkDrop(g, arr, c, -1).arr;
            settle(-1, CORRECT_MS);
            session.fade?.(g.cards[c], CORRECTED);
            markNow();
          }, (k + 1) * SWEEP_MS),
        );
        const wait = Math.max(busyUntil - performance.now(), missed.length * SWEEP_MS + CORRECT_MS);
        later(() => finish(encodeArrangement(g, arr)), Math.max(0, wait) + LAST_MS);
      };
```

The answer click handler:

```ts
      answer.addEventListener("click", (e) => {
        e.stopPropagation();
        if (selectEach) sweep();
        else finish(encodeArrangement(g, arr));
      });
```

`needsAnswer` stays true for a select (Done is its Answer). Header comment, the `select` line: `select (one box): check: each — a tap puts a card in, judged (a wrong one goes back, faded); Done judges the rest. check: end — a tap moves it in or out`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/gate-words-round7.test.ts tests/cards-gate-tap.test.ts tests/cards-check-player.test.ts tests/guess-gate-field.test.ts`
Expected: PASS. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/gate-words.ts src/ui/cards-gate.ts tests/cards-gate-tap.test.ts tests/gate-words-round7.test.ts
git commit -m "Round 7: select judged on each tap; Done sweeps the missed cards in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

---
### Task 6: Rank — `reveal_style: "reorder"`, the default: the cards slide into the true order (spec §4, build order 4)

**Files:**
- Create: `src/cards/reorder.ts`
- Modify: `src/spec/types.ts:1003-1007` (`reveal_style` union + doc), `src/spec/schema.ts:963` (enum + description), `src/guess/reveal.ts:39` (`RevealStyle`)
- Modify: `src/render/plan.ts:142-145` (`revealStyle` type) and `:1716` (pass any explicit `reveal_style` through)
- Modify: `src/ui/gate-words.ts` (`yours`)
- Modify: `src/render/player.ts` — `cardsAsk` (the `beside`/`moves` lines and the marks chain); imports
- Modify: `src/lint/lint.ts` — `lintGuess` (line ~1238): `reorder` off rank cards warns; import `cardsMode`
- Modify: `tests/cards-beside.test.ts` (lines 112 and 143), `tests/gate-words-round7.test.ts`, `tests/prompt-size.test.ts`
- Test: `tests/cards-reorder.test.ts` (new)

**Interfaces:**
- Consumes: `checked` in `cardsAsk` (Task 3); `positions`, `rightCards`, `Arrangement` (model); `tick`, `YOURS` (`src/guess/reveal.ts`); `GuessMarks`, `GuessMarkText`, `GuessMarkLine` (`src/guess/marks.ts`).
- Produces (`src/cards/reorder.ts`):
  - `VERDICT_MS = 800`, `REORDER_MS = 900`
  - `isColumn(g: CardsGeometry): boolean`
  - `reorderSide(g: CardsGeometry, from: Pt, to: Pt): 1 | -1` — row: rightward +1 (above), leftward −1 (below); column: downward +1 (right), upward −1 (left)
  - `reorderAt(g: CardsGeometry, from: Pt, to: Pt, t: number): Pt`
  - `rankVerdicts(g: CardsGeometry, a: Arrangement): GuessMarks` — ✓/✗ on every card where the viewer left it
  - `yoursRow(g: CardsGeometry, a: Arrangement, word: string): GuessMarkText[]` — YOURS, size 16, wrong cards only, the word first
  - `reorderLanded(g: CardsGeometry, a: Arrangement, word: string): GuessMarks` — the row, ✓ on unmoved cards at their truth, a YOURS connector (width 1.5) per moved card
- `PlanStep` ask `revealStyle?: "beside" | "morph" | "reorder"` (an explicit `"beside"` now reaches the player).
- `GateWords.yours: string` (EN "yours", NB "din").

- [ ] **Step 1: Write the failing tests**

Create `tests/cards-reorder.test.ts`:

```ts
// Rank revealed by reordering (round 7 §4): verdicts where the viewer left
// the cards, a faint "yours" row, the cards slide into the true order on
// arcs (opposite directions on opposite sides), blue connectors after.
import { describe, expect, test } from "vitest";
import { Player, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { cardsGeometry, type CardsElementLike, type CardsGeometry } from "../src/spec/cards";
import { encodeArrangement, positions, type Arrangement } from "../src/cards/model";
import { reorderAt, reorderLanded, reorderSide, yoursRow } from "../src/cards/reorder";
import type { GuessMarks } from "../src/guess/marks";
import { YOURS } from "../src/guess/reveal";
import { lintCommands } from "../src/lint/lint";
import type { Command, Spec } from "../src/spec/types";
import type { Pt } from "../src/layout/model";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 2) as unknown as number) as typeof requestAnimationFrame;

class QuietSpeech extends SpeechManager {
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return Promise.resolve(); }
  override cancel(): void {}
}

const rankOf = (n: number, extra: Partial<CardsElementLike> = {}) =>
  cardsGeometry({ id: "c", type: "cards", items: Array.from({ length: n }, (_, i) => `Card ${i + 1}`), ...extra } as CardsElementLike);
const rank = cardsGeometry({ id: "c", type: "cards", items: ["Ant", "Bee", "Cat", "Dog"] } as CardsElementLike);
const wrong: Arrangement = { order: [1, 0, 2, 3], boxes: [] };

function perms(n: number): number[][] {
  if (n === 1) return [[0]];
  return perms(n - 1).flatMap((p) => Array.from({ length: n }, (_, k) => [...p.slice(0, k), n - 1, ...p.slice(k)]));
}
/** A fixed sample of shuffles (n of 7 and 8: every permutation is too many). */
function sample(n: number, count: number): number[][] {
  let s = 12345;
  const rand = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  return Array.from({ length: count }, () => {
    const p = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return p;
  });
}

describe("the slide, pure", () => {
  test("sides: a row's rightward card above, leftward below; a column's downward right, upward left", () => {
    const g = rankOf(4);
    expect(reorderSide(g, g.slots[0], g.slots[3])).toBe(1);
    expect(reorderSide(g, g.slots[3], g.slots[0])).toBe(-1);
    const c = rankOf(4, { arrange: "column" });
    expect(reorderSide(c, c.slots[0], c.slots[3])).toBe(1);
    expect(reorderSide(c, c.slots[3], c.slots[0])).toBe(-1);
    // Ends where it should, starts where it was.
    expect(reorderAt(g, g.slots[0], g.slots[3], 0)).toEqual(g.slots[0]);
    expect(reorderAt(g, g.slots[0], g.slots[3], 1)).toEqual(g.slots[3]);
  });

  for (const column of [false, true])
    for (let n = 2; n <= 8; n++) {
      test(`${column ? "column" : "row"} of ${n}: no card passes through one moving the other way, or one standing still`, () => {
        const g = rankOf(n, column ? { arrange: "column" } : {});
        for (const order of n <= 6 ? perms(n) : sample(n, 300)) {
          const from = positions(g, { order, boxes: [] });
          const moves = g.cards.map((_, i) => Math.hypot(from[i][0] - g.truth[i][0], from[i][1] - g.truth[i][1]) > 0.5);
          const sides = g.cards.map((_, i) => reorderSide(g, from[i], g.truth[i]));
          for (let k = 0; k <= 100; k++) {
            const at = g.cards.map((_, i) => reorderAt(g, from[i], g.truth[i], k / 100));
            for (let i = 0; i < n; i++)
              for (let j = i + 1; j < n; j++) {
                if (moves[i] && moves[j] && sides[i] === sides[j]) continue;
                const hit = Math.abs(at[i][0] - at[j][0]) < g.w - 0.5 && Math.abs(at[i][1] - at[j][1]) < g.h - 0.5;
                if (hit) throw new Error(`order ${order.join(",")}: cards ${i} and ${j} cross at t=${k / 100}`);
              }
          }
        }
      });
    }

  test("the yours row: only the cards the viewer had wrong, the word first, blue, size 16, on the canvas", () => {
    const row = yoursRow(rank, wrong, "yours");
    expect(row.map((t) => t.text)).toEqual(["yours", "Bee", "Ant"]);
    expect(row.every((t) => t.color === YOURS && t.size === 16)).toBe(true);
    const high = rankOf(4, { y: 700 });
    for (const t of yoursRow(high, wrong, "yours")) expect(t.at[1]).toBeLessThanOrEqual(740);
    const col = rankOf(8, { arrange: "column" });
    for (const t of yoursRow(col, { order: [7, 1, 2, 3, 4, 5, 6, 0], boxes: [] }, "yours")) {
      expect(t.at[0]).toBeGreaterThan(0);
      expect(t.at[1]).toBeLessThanOrEqual(740);
    }
  });

  test("landed: ✓ on the cards that never moved, a blue connector for each that did, no ✗", () => {
    const m = reorderLanded(rank, wrong, "yours");
    expect(m.texts.filter((t) => t.text === "✓")).toHaveLength(2);
    expect(m.texts.filter((t) => t.text === "✗")).toHaveLength(0);
    expect(m.lines).toHaveLength(2);
    expect(m.lines.every((l) => l.color === YOURS)).toBe(true);
  });
});

function makePlayer(geom: CardsGeometry, ask: Record<string, unknown>) {
  const nudges: { id: string; dx: number; dy: number }[] = [];
  const marks = new Map<string, GuessMarks | null>();
  const history: { at: number; m: GuessMarks | null }[] = [];
  const base: Record<string, unknown> = {
    setOffset: (id: string, dx: number, dy: number) => nudges.push({ id, dx, dy }),
    setGuessMarks: (owner: string, m: GuessMarks | null) => {
      marks.set(owner, m);
      history.push({ at: performance.now(), m });
    },
  };
  const effects = new Proxy(base, { get: (t, k: string) => t[k] ?? (() => {}) }) as unknown as BackendEffects;
  const commands: Command[] = [{ draw: [geom.id] } as Command, { ask: { question: "Which kills the most people a year? Put them in order.", on: geom.id, store: "r", ...ask } } as Command, { speak: "Next." } as Command];
  const truthOffsets: Record<string, Pt> = {};
  geom.cards.forEach((c, i) => (truthOffsets[c] = [geom.truth[i][0] - geom.home[i][0], geom.truth[i][1] - geom.home[i][1]]));
  const plan = planCommands(commands, [geom.id, ...geom.cards], { cardsFor: (id) => (id === geom.id ? { cards: geom.cards, offsets: truthOffsets } : null) });
  const placed = new Map<string, Pt>();
  const elements = new Map(
    geom.cards.map((id) => [id, { setOffset: (dx: number, dy: number) => placed.set(id, [dx, dy]), finish: () => {}, hide: () => {}, setOpacity: () => {}, setPoints: () => {}, setText: () => {} }]),
  );
  const player = new Player(plan, elements as never, new QuietSpeech(), null, { mode: "narrated", effects });
  const rp: Reprojector = { frame: () => {}, commit: () => elements as never, committed: () => null };
  player.reprojector = rp;
  const runtime: GuessRuntime = { setup: () => ({ handles: [], pin: {}, warnings: [] }), patch: () => ({ params: {} }), cards: (id) => (id === geom.id ? geom : null) };
  player.guess = runtime;
  return { player, nudges, marks, placed, history };
}

const ticks = (m: GuessMarks) => m.texts.filter((t) => t.text === "✓" || t.text === "✗");

describe("reorder in the player (the default for rank)", () => {
  test("verdicts on all four first, then the slide off the row; every card ends at the truth, no nudge left", async () => {
    const { player, nudges, history, placed } = makePlayer(rank, {});
    player.askGate = async () => encodeArrangement(rank, wrong);
    await player.play();
    expect(history.some((h) => h.m !== null && ticks(h.m).length === 4)).toBe(true);
    expect(nudges.some((n) => Math.abs(n.dy) > 1)).toBe(true);
    for (const id of rank.cards) {
      const l = nudges.filter((n) => n.id === id).pop()!;
      expect([l.dx, l.dy]).toEqual([0, 0]);
    }
    rank.cards.forEach((id, i) => expect(placed.get(id)).toEqual([rank.truth[i][0] - rank.home[i][0], rank.truth[i][1] - rank.home[i][1]]));
  });

  test("landed: the yours row, blue connectors, ✓ on the unmoved cards; restored on a seek forward, gone on a seek back", async () => {
    const { player, marks, history } = makePlayer(rank, {});
    player.askGate = async () => encodeArrangement(rank, wrong);
    await player.play();
    const landed = history.filter((h) => h.m !== null && h.m.lines.length > 0)[0].m!;
    expect(landed.lines).toHaveLength(2);
    expect(landed.texts.filter((t) => t.text === "✓")).toHaveLength(2);
    expect(landed.texts.some((t) => t.text === "yours" && t.color === YOURS)).toBe(true);
    player.renderUpTo(2);
    expect(marks.get("cards_1")!.lines).toHaveLength(2);
    player.renderUpTo(1);
    expect(marks.get("cards_1") ?? null).toBeNull();
  });

  test("the movie slides the same way, with no marks", async () => {
    const { player, nudges, marks } = makePlayer(rank, {});
    await player.play();
    expect(nudges.some((n) => Math.abs(n.dy) > 1)).toBe(true);
    expect(marks.get("cards_1") ?? null).toBeNull();
  });

  test("an explicit beside still wins: the cards stay where the viewer left them", async () => {
    const { player, nudges } = makePlayer(rank, { reveal_style: "beside" });
    player.askGate = async () => encodeArrangement(rank, wrong);
    await player.play();
    expect(nudges.every((n) => n.dx === 0 && n.dy === 0)).toBe(true);
  });
});

test("lint: reorder on anything but rank cards warns", () => {
  const spec = (el: object) =>
    ({ elements: [el], commands: [{ draw: ["c"] }, { ask: { question: "Which box does each card go in? Sort them all.", on: "c", reveal_style: "reorder" } }] }) as unknown as Spec;
  const sortEl = { id: "c", type: "cards", bins: ["A", "B"], items: [{ text: "x", bin: "A" }, { text: "y", bin: "B" }] };
  const rankEl = { id: "c", type: "cards", items: ["x", "y", "z"] };
  expect(lintCommands(spec(sortEl)).filter((i) => /reorder/.test(i.message))).toHaveLength(1);
  expect(lintCommands(spec(rankEl)).filter((i) => /reorder/.test(i.message))).toHaveLength(0);
});
```

In `tests/gate-words-round7.test.ts` add:

```ts
test("the reorder's yours row, in both tongues", () => {
  expect(gateWords("en").yours).toBe("yours");
  expect(gateWords("nb").yours).toBe("din");
});
```

In `tests/cards-beside.test.ts`: the test "beside: the cards stay where the viewer left them …" (line 112) uses `makePlayer(rank, { reveal_style: "beside" })`; the test "reveal_order each: the verdicts come card by card" (line 143) uses `makePlayer(rank, { reveal_style: "beside", reveal_order: "each" })`. (The others hold: the replay test's `renderUpTo(3)` finds the landed marks; a skip still glides.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/cards-reorder.test.ts tests/gate-words-round7.test.ts`
Expected: FAIL — `src/cards/reorder.ts` does not exist; `yours` missing.

- [ ] **Step 3: The pure module**

Create `src/cards/reorder.ts`:

```ts
// Rank revealed by reordering (round 7 §4): ✓/✗ where the viewer left each
// card, a faint "yours" row of their order, the cards slide into the true
// order — those moving one way over the row, the other way under it — and
// thin blue connectors show how far each moved. Pure; render/player.ts plays it.

import type { Pt } from "../layout/model";
import type { CardsGeometry } from "../spec/cards";
import type { GuessMarkLine, GuessMarks, GuessMarkText } from "../guess/marks";
import { tick, YOURS } from "../guess/reveal";
import { positions, rightCards, type Arrangement } from "./model";

/** The verdicts stand this long before the cards move. */
export const VERDICT_MS = 800;
/** The slide into the true order. */
export const REORDER_MS = 900;
const LABEL_SIZE = 16;
const LABEL_CHARS = 14;
const CANVAS_W = 1000;
const CANVAS_H = 750;

const ease = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};
const short = (t: string): string => (t.length > LABEL_CHARS ? `${t.slice(0, LABEL_CHARS - 1)}…` : t);

export function isColumn(g: CardsGeometry): boolean {
  return g.slots.length > 1 && Math.abs(g.slots[0][0] - g.slots[1][0]) < 1;
}

/** Which side a card passes on: a row's rightward card above (+1), leftward below; a column's downward card right, upward left. */
export function reorderSide(g: CardsGeometry, from: Pt, to: Pt): 1 | -1 {
  if (isColumn(g)) return to[1] < from[1] ? 1 : -1;
  return to[0] > from[0] ? 1 : -1;
}

/**
 * Where a card stands at t (0..1) on its way from `from` to `to`: lifted
 * clear of the row first (a card and a little more — longer moves ride
 * higher, over the shorter), along, set down. Never off the canvas.
 */
export function reorderAt(g: CardsGeometry, from: Pt, to: Pt, t: number): Pt {
  const moved = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (moved < 0.5) return from;
  const column = isColumn(g);
  const pitch = g.slots.length > 1 ? Math.hypot(g.slots[1][0] - g.slots[0][0], g.slots[1][1] - g.slots[0][1]) : moved;
  const along = ease((t - 0.15) / 0.7);
  const x = from[0] + (to[0] - from[0]) * along;
  const y = from[1] + (to[1] - from[1]) * along;
  const side = reorderSide(g, from, to);
  const size = column ? g.w : g.h;
  let lift = size + 6 + 10 * Math.max(0, Math.round(moved / pitch) - 1);
  // The canvas edge caps it.
  if (column) lift = Math.min(lift, side > 0 ? CANVAS_W - g.w / 2 - x : x - g.w / 2);
  else lift = Math.min(lift, side > 0 ? CANVAS_H - g.h / 2 - y : y - g.h / 2);
  const up = Math.max(0, lift) * ease(Math.min(t, 1 - t) / 0.2);
  return column ? [x + side * up, y] : [x, y + side * up];
}

/** ✓/✗ on each card where the viewer left it. */
export function rankVerdicts(g: CardsGeometry, a: Arrangement): GuessMarks {
  const right = rightCards(g, a);
  const at = positions(g, a);
  return { color: YOURS, lines: [], texts: g.cards.map((_, i) => tick([at[i][0] + g.w / 2 - 2, at[i][1] + g.h / 2 - 2], right[i], "middle", 24)) };
}

/** Where slot s's label stands: just above the row, or just left of a column. */
function labelAt(g: CardsGeometry, s: number): Pt {
  const p = g.slots[s];
  return isColumn(g) ? [p[0] - g.w / 2 - 14, p[1]] : [p[0], Math.min(740, p[1] + g.h / 2 + 18)];
}

/** The viewer's order, faint: a short label at each slot whose card was wrong (the right ones leave a gap), the word at its start. */
export function yoursRow(g: CardsGeometry, a: Arrangement, word: string): GuessMarkText[] {
  const right = rightCards(g, a);
  const column = isColumn(g);
  const out: GuessMarkText[] = [];
  a.order.forEach((card, s) => {
    if (right[card]) return;
    out.push({ at: labelAt(g, s), text: short(g.texts[card]), anchor: column ? "end" : "middle", color: YOURS, size: LABEL_SIZE });
  });
  if (out.length === 0) return out;
  const s0 = g.slots[0];
  const wordAt: Pt = column ? [s0[0] - g.w / 2 - 14, Math.min(740, s0[1] + g.h / 2 + 16)] : [Math.max(48, s0[0] - g.w / 2 - 8), labelAt(g, 0)[1]];
  return [{ at: wordAt, text: word, anchor: "end", color: YOURS, size: LABEL_SIZE }, ...out];
}

/** Once landed: the yours row, a connector from each moved card's label to where it now stands, ✓ on the cards that never moved. */
export function reorderLanded(g: CardsGeometry, a: Arrangement, word: string): GuessMarks {
  const right = rightCards(g, a);
  const column = isColumn(g);
  const lines: GuessMarkLine[] = [];
  const texts: GuessMarkText[] = [...yoursRow(g, a, word)];
  a.order.forEach((card, s) => {
    const t = g.truth[card];
    if (right[card]) {
      texts.push(tick([t[0] + g.w / 2 - 2, t[1] + g.h / 2 - 2], true, "middle", 24));
      return;
    }
    const l = labelAt(g, s);
    const from: Pt = column ? [l[0] + 4, l[1]] : [l[0], l[1] - 9];
    const to: Pt = column ? [t[0] - g.w / 2 - 2, t[1]] : [t[0], t[1] + g.h / 2 + 2];
    lines.push({ pts: [from, to], color: YOURS, width: 1.5 });
  });
  return { color: YOURS, lines, texts };
}
```

- [ ] **Step 4: The field (types, schema, plan, reveal type, words)**

`src/spec/types.ts` (ask, line 1003-1007):

```ts
  /** A guess, cards, tree or formula reveal (spec 2026-10-03-round6 §3):
   *  "beside" (default) — the viewer's answer stays where they put it and
   *  the truth is drawn beside or over it; "morph" — the answer glides into
   *  the truth (rounds 1–5); "reorder" (round 7 §4, the default for rank
   *  cards) — the cards slide into the true order, a faint "yours" row behind. */
  reveal_style?: "beside" | "morph" | "reorder";
```

`src/spec/schema.ts:963`:

```ts
        reveal_style: { enum: ["beside", "morph", "reorder"], description: "Reveal of a guess, cards, tree or formula: beside (default; the answer stays, the truth is drawn beside it), morph (the answer glides into the truth) or reorder (default for rank cards: they slide into the true order, a faint yours row behind)." },
```

`src/guess/reveal.ts:39`: `export type RevealStyle = "beside" | "morph" | "reorder";`

`src/render/plan.ts`, the PlanStep ask fields (line 142):

```ts
      /** A reveal (spec 2026-10-03-round6 §3, round 7 §4): as written — absent
       *  means the form's own default (beside; reorder for rank cards). */
      revealStyle?: "beside" | "morph" | "reorder";
```

and line 1716:

```ts
        ...(cmd.ask.reveal_style !== undefined ? { revealStyle: cmd.ask.reveal_style } : {}),
```

(Every other reader compares `=== "morph"` / `!== "morph"`, so guesses, trees and formulas treat `"beside"` and `"reorder"` as beside. Run `grep -rn "revealStyle" tests/` — a plan test that pinned the absence of `revealStyle` for an explicit `"beside"` must now expect `revealStyle: "beside"`.)

`src/ui/gate-words.ts`: `GateWords` gets `/** The reorder's row of the viewer's own order (round 7 §4). */ yours: string;`; EN `yours: "yours",`; NB `yours: "din",`.

- [ ] **Step 5: The player**

Imports in `src/render/player.ts`: add

```ts
import { REORDER_MS, VERDICT_MS, reorderAt, reorderLanded, rankVerdicts, yoursRow } from "../cards/reorder";
```

and add `YOURS` to the `../guess/reveal` import (line 47).

Replace the `beside` and `moves` lines (as left by Task 3) with:

```ts
    // Rank slides into the true order by default (round 7 §4); an explicit beside or morph wins.
    const reorder = g.mode === "rank" && (step.revealStyle ?? "reorder") === "reorder";
    const beside = !checked && !reorder && step.revealStyle !== "morph" && answered;
```

and in the `moves` line add `!reorder &&` after `!beside &&`.

Right after the `if (moves) { … }` block:

```ts
    if (reorder) {
      // ✓/✗ where the viewer left each card, then their order, faint, as the
      // cards slide; a movie (or a skip) only slides, from the shuffle.
      if (answered) {
        mark(rankVerdicts(g, arrangement));
        await this.waitScaled(VERDICT_MS, signal);
        if (!signal.aborted) mark({ color: YOURS, lines: [], texts: yoursRow(g, arrangement, gateWords(gateLang(this.sourceLang)).yours) });
      }
      if (!signal.aborted) {
        await this.progress(REORDER_MS, signal, (t) => {
          g.cards.forEach((id, i) => {
            const p = reorderAt(g, from[i], g.truth[i], t);
            place(id, p[0] - g.home[i][0], p[1] - g.home[i][1]);
          });
        });
      }
      // The gate's nudges go (an abort too): the plan puts the cards at the truth.
      for (const id of g.cards) place(id, 0, 0);
      if (signal.aborted) {
        this.endGuessMarks(true);
        return;
      }
    }
```

In the marks chain after `applyScene`, before the final `else if (answered) mark(cardsMarks(g, arrangement));`:

```ts
    } else if (reorder && answered) {
      const landed = reorderLanded(g, arrangement, gateWords(gateLang(this.sourceLang)).yours);
      mark(landed);
      // Marks only (the cards stand at the plan's truth): a seek forward restores them.
      this.putBeside(owner, { index, marks: landed, faded: false });
```

- [ ] **Step 6: The lint**

In `src/lint/lint.ts`, import `cardsMode` from `../spec/cards` (line 14). In `lintGuess`, after `const cardSets = …` (line 1231):

```ts
  const rawCards = new Map((spec.elements ?? []).filter((e) => e.type === "cards").map((e) => [e.id, e as unknown as CardsElementLike]));
```

and inside `commands.forEach`, after the existing reveal_style block:

```ts
    // reorder (round 7 §4) slides rank cards into order; anything else reveals beside.
    if (c.ask?.reveal_style === "reorder") {
      const on = typeof c.ask.on === "string" ? c.ask.on : null;
      const cs = on !== null ? (cardSets.get(on) ?? rawCards.get(on)) : undefined;
      if (!cs || cardsMode(cs) !== "rank") issues.push({ rule: "guess", ids: [], message: `ask reveal_style: "reorder" slides rank cards into the true order — on anything else it acts as beside`, severity: "warn" });
    }
```

- [ ] **Step 7: Run the tests, re-pin, type-check**

Run: `npx vitest run tests/cards-reorder.test.ts tests/cards-beside.test.ts tests/gate-words-round7.test.ts tests/ask-stage.test.ts tests/guess-lint.test.ts tests/cards.test.ts tests/cards-look.test.ts`
Expected: PASS. Then `npx vitest run tests/prompt-size.test.ts`, re-pin both baselines ("Re-pinned UP 2026-10-02 (round 7 Task 6): ask reveal_style \"reorder\" …"), and `npx tsc --noEmit` clean. Run the whole plan/guess suite once: `npx vitest run tests/ask-plan.test.ts tests/guess-beside-player.test.ts tests/guess-keep-player.test.ts tests/tree-ask-player.test.ts` (whichever exist; `ls tests | grep -E "plan|beside|keep"`).

- [ ] **Step 8: Commit**

```bash
git add src/cards/reorder.ts src/spec/types.ts src/spec/schema.ts src/guess/reveal.ts src/render/plan.ts src/ui/gate-words.ts src/render/player.ts src/lint/lint.ts tests/cards-reorder.test.ts tests/cards-beside.test.ts tests/gate-words-round7.test.ts tests/prompt-size.test.ts
git commit -m "Round 7: rank reveal reorder — verdicts, yours row, cards slide into the true order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

---

### Task 7: Cards above the boxes — `arrange: "drop"` (default), `"side"`, `"rise"` (spec §5, build order 5)

**Files:**
- Modify: `src/spec/cards.ts` — `CardsElementLike.arrange` (line 73), new `sortLayout`, `lowestOf` (line 299), the select branch (lines 478-504), the sort branch (lines 506-547), `deckGeometry` (lines 561-627) and its call (line 456)
- Modify: `src/spec/types.ts:464` (`arrange`), `src/spec/schema.ts:634` (`arrange` enum + description)
- Modify: `src/cards/beside.ts:251-258` (an unrouted line under a low box goes above it)
- Modify: `src/lint/lint.ts` — rule union (line ~178) `"cards-side"`; `lintFeedback` (after the deck-text loop, line ~1737)
- Modify: `tests/cards-box-capacity.test.ts:58`, `tests/cards-faster-sort.test.ts:142-150`, `tests/cards-counter.test.ts`, `tests/prompt-size.test.ts`
- Modify (only if Step 6 finds a break): `src/examples.json`
- Test: `tests/cards-arrange.test.ts` (new)

**Interfaces:**
- Consumes: `CardsGeometry.layout`, `counterAt`, `COUNTER_ROOM` (Task 2); `CardsGeometry.each` (Task 1).
- Produces:
  - `CardsElementLike.arrange?: "row" | "column" | "drop" | "side" | "rise"` (rank reads row/column only).
  - `export function sortLayout(el: Pick<CardsElementLike, "arrange">, n: number): "drop" | "side" | "rise"` — rise when asked; side when asked and `n <= 8`; else drop.
  - Sort, select and deck geometries carry `layout`. `el.y` under drop/side is the top of the whole block (the tray's top; a deck: the dealt card's band top); under rise it is the boxes' top, as before.
  - Lint rule `"cards-side"`.

- [ ] **Step 1: Write the failing tests**

Create `tests/cards-arrange.test.ts`:

```ts
// Cards above the boxes (round 7 §5): drop by default (the cards on top,
// the boxes below), side (a column of cards on the left), rise (as before) —
// every layout on the canvas, the counter's row included.
import { describe, expect, test } from "vitest";
import { cardsGeometry, counterAt, sortLayout, type CardsElementLike, type CardsGeometry } from "../src/spec/cards";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";

type P = [number, number];
const items = (n: number, bins: string[]) => Array.from({ length: n }, (_, i) => ({ text: `Card ${i + 1}`, bin: bins[i % bins.length] }));
const BINS = [["Fruit", "Not"], ["A", "B", "C"], ["A", "B", "C", "D"]];
const onCanvas = (p: P, w: number, h: number) => p[0] - w / 2 >= -0.5 && p[0] + w / 2 <= 1000.5 && p[1] - h / 2 >= -0.5 && p[1] + h / 2 <= 750.5;
const boxTop = (g: CardsGeometry) => Math.max(...g.binBoxes.map((b) => b.c[1] + b.h / 2));
const boxBottom = (g: CardsGeometry) => Math.min(...g.binBoxes.map((b) => b.c[1] - b.h / 2));
const boxLeft = (g: CardsGeometry) => Math.min(...g.binBoxes.map((b) => b.c[0] - b.w / 2));
const inside = (g: CardsGeometry, b: number, p: P) => {
  const box = g.binBoxes[b];
  return Math.abs(p[0] - box.c[0]) + g.w / 2 <= box.w / 2 + 0.5 && Math.abs(p[1] - box.c[1]) + g.h / 2 <= box.h / 2 + 0.5;
};
const allOnCanvas = (g: CardsGeometry) => {
  for (const bx of g.binBoxes) expect(onCanvas(bx.c as P, bx.w, bx.h)).toBe(true);
  for (const p of [...g.home, ...g.truth]) expect(onCanvas(p as P, g.w, g.h)).toBe(true);
  expect(counterAt(g)[1] - 12).toBeGreaterThanOrEqual(0);
};

describe("drop (the default): the cards above the boxes", () => {
  for (const bins of BINS)
    for (let n = 4; n <= 8; n++) {
      test(`sort: ${n} cards, ${bins.length} boxes`, () => {
        const g = cardsGeometry({ id: "s", type: "cards", bins, items: items(n, bins) } as CardsElementLike);
        expect(g.layout).toBe("drop");
        expect(Math.min(...g.home.map((p) => p[1] - g.h / 2))).toBeGreaterThan(boxTop(g));
        allOnCanvas(g);
        for (let b = 0; b < bins.length; b++) for (let j = 0; j < n; j++) expect(inside(g, b, g.binSlot(b, j, n) as P)).toBe(true);
      });
    }
  for (const bins of [["Fruit", "Not"], ["A", "B", "C", "D"]])
    for (const n of [12, 14, 30]) {
      test(`deck: ${n} cards, ${bins.length} boxes — the dealt card over the boxes`, () => {
        const g = cardsGeometry({ id: "d", type: "cards", deck: true, bins, items: items(n, bins) } as CardsElementLike);
        const s = g.deckScale!;
        const [, cy] = g.home[0];
        expect(cy - (g.h * s) / 2).toBeGreaterThan(boxTop(g));
        expect(cy + (g.h * s) / 2).toBeLessThanOrEqual(750);
        allOnCanvas(g);
      });
    }
  test("select: the cards above the one box", () => {
    const g = cardsGeometry({ id: "z", type: "cards", select: "Mammals", items: [{ text: "Whale", in: true }, "Shark", { text: "Bat", in: true }, "Trout", "Eel", "Crab"] } as CardsElementLike);
    expect(g.layout).toBe("drop");
    expect(Math.min(...g.home.map((p) => p[1] - g.h / 2))).toBeGreaterThan(boxTop(g));
    allOnCanvas(g);
  });
});

describe("side: the cards a column on the left, the boxes on the right", () => {
  for (const bins of BINS)
    for (const n of [4, 8]) {
      test(`sort: ${n} cards, ${bins.length} boxes`, () => {
        const g = cardsGeometry({ id: "s", type: "cards", arrange: "side", bins, items: items(n, bins) } as CardsElementLike);
        expect(g.layout).toBe("side");
        expect(Math.max(...g.home.map((p) => p[0] + g.w / 2))).toBeLessThan(boxLeft(g));
        allOnCanvas(g);
      });
    }
  test("a deck of 8: the dealt card on the left of the boxes", () => {
    const g = cardsGeometry({ id: "d", type: "cards", deck: true, arrange: "side", bins: ["A", "B"], items: items(8, ["A", "B"]) } as CardsElementLike);
    expect(g.layout).toBe("side");
    expect(g.home[0][0] + (g.w * g.deckScale!) / 2).toBeLessThan(boxLeft(g));
    allOnCanvas(g);
  });
  test("more than 8 cards fall back to drop; lint says so", () => {
    expect(sortLayout({ arrange: "side" }, 12)).toBe("drop");
    const el = { id: "d", type: "cards", deck: true, arrange: "side", bins: ["A", "B"], items: items(12, ["A", "B"]) };
    expect(cardsGeometry(el as CardsElementLike).layout).toBe("drop");
    const spec = { elements: [el], commands: [] } as unknown as Spec;
    expect(lintCommands(spec).filter((i) => i.rule === "cards-side")).toHaveLength(1);
  });
});

describe("rise: the boxes on top, as before", () => {
  test("sort: the boxes' top at 660, the cards below them", () => {
    const g = cardsGeometry({ id: "s", type: "cards", arrange: "rise", bins: ["A", "B"], items: items(6, ["A", "B"]) } as CardsElementLike);
    expect(g.layout).toBe("rise");
    expect(boxTop(g)).toBeCloseTo(660, 5);
    expect(Math.max(...g.home.map((p) => p[1] + g.h / 2))).toBeLessThan(boxBottom(g));
  });
  test("rank keeps row and column", () => {
    const col = cardsGeometry({ id: "r", type: "cards", arrange: "column", items: ["A", "B", "C"] } as CardsElementLike);
    expect(col.slots[0][0]).toBeCloseTo(col.slots[1][0], 5);
    expect(col.layout).toBeUndefined();
  });
});
```

`tests/cards-counter.test.ts`: the second test becomes the rise case and a drop case is added:

```ts
test("rise: centred above the boxes, on the canvas", () => {
  const g = cardsGeometry({ ...two, arrange: "rise" });
  // (body unchanged)
});

test("drop (the default): centred under the boxes, above the floor", () => {
  const g = cardsGeometry(two);
  const [, y] = counterAt(g);
  expect(y).toBeLessThan(Math.min(...g.binBoxes.map((b) => b.c[1] - b.h / 2)));
  expect(y - 12).toBeGreaterThanOrEqual(0);
});
```

`tests/cards-box-capacity.test.ts:58` — the deck's "boxes stay above the dealt card" becomes (drop):

```ts
      // The dealt card stands over the boxes (round 7 §5: drop).
      expect(g.binBoxes.every((box) => box.c[1] + box.h / 2 < g.home[0][1] - (g.h * (g.deckScale ?? 1)) / 2)).toBe(true);
```

`tests/cards-faster-sort.test.ts:142` — the test becomes:

```ts
  test("large when dealt, and it stands over the boxes, under the top (round 7 §5: drop)", () => {
    const s = g.deckScale!;
    expect(s * g.w).toBeGreaterThanOrEqual(240);
    expect(s * g.w).toBeLessThanOrEqual(400);
    const [, cy] = g.home[g.deal![0]];
    const boxTop = Math.max(...g.binBoxes.map((b) => b.c[1] + b.h / 2));
    expect(cy - (s * g.h) / 2).toBeGreaterThan(boxTop);
    expect(cy + (s * g.h) / 2).toBeLessThanOrEqual(750);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/cards-arrange.test.ts tests/cards-counter.test.ts`
Expected: FAIL — `sortLayout` is not exported, `layout` is undefined, boxes are on top.

- [ ] **Step 3: The field and `sortLayout`**

`src/spec/cards.ts`, `CardsElementLike`:

```ts
  /** rank: a row (default) or a column of cards; sort, select, deck (round 7 §5): drop (default — the cards above the boxes), side (a column on the left, up to 8), rise (the boxes on top). */
  arrange?: "row" | "column" | "drop" | "side" | "rise";
```

After `counterAt`:

```ts
/** sort, select, deck (round 7 §5): where the cards stand against the boxes — drop unless asked; side only up to 8 cards. */
export function sortLayout(el: Pick<CardsElementLike, "arrange">, n: number): "drop" | "side" | "rise" {
  if (el.arrange === "rise") return "rise";
  return el.arrange === "side" && n <= 8 ? "side" : "drop";
}
```

`lowestOf`, before `return`:

```ts
  // check: each under drop or side — the counter's row under the boxes.
  if (g.each && g.layout !== undefined && g.layout !== "rise" && g.binBoxes.length > 0) ys.push(counterAt(g)[1] - 12);
```

`src/spec/types.ts:464`: `arrange?: "row" | "column" | "drop" | "side" | "rise";` with the doc `/** cards: rank — a row (default) or a column; sort, select, deck — drop (default), side or rise. */`.

`src/spec/schema.ts:634`:

```ts
    arrange: { type: "string", enum: ["row", "column", "drop", "side", "rise"], description: "cards: rank — a row (default) or a column (longer names); sort, select, deck — drop (default: the cards above the boxes), side (the cards a column on the left, the boxes right; up to 8 cards) or rise (the boxes above the cards)." },
```

- [ ] **Step 4: Select and sort**

Replace the select branch (from `if (select) {` through its `return`) with:

```ts
  if (select) {
    // One wide box; the cards it holds stand side by side in it (rows of as
    // many as fit), so every card can go in. drop (round 7 §5): the cards
    // above the box; side: a column on the left, the box on the right;
    // rise: the box above the cards, as before.
    const layout = sortLayout(el, n);
    const side = layout === "side";
    const perRow = side ? 1 : n > 5 ? Math.ceil(n / 2) : n;
    const slotW = side ? width / 3 : width / perRow;
    const bx0 = side ? x0 + width / 3 + GAP : x0;
    const bWidth = x1 - bx0;
    const binW = bWidth - 2 * GAP;
    const w = Math.min(180, slotW - GAP, binW - 20);
    const cols = Math.max(1, Math.floor((binW - 12) / (w + 10)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const topY = isNum(el.y) ? el.y : 660;
    const trayRows = Math.ceil(n / perRow);
    const binH = 44 + rows * (CH + 8) + 8;
    const boxTop = layout === "drop" ? topY - trayRows * (CH + GAP) + GAP - 40 : topY;
    const binBoxes: CardBox[] = [{ c: [bx0 + bWidth / 2, boxTop - binH / 2] as Pt, w: binW, h: binH }];
    const trayTop = layout === "rise" ? topY - binH - 40 : topY;
    const tray: Pt[] = items.map((_, s) =>
      (side ? [x0 + width / 6, trayTop - CH / 2 - s * (CH + GAP)] : [x0 + slotW * ((s % perRow) + 0.5), trayTop - CH / 2 - Math.floor(s / perRow) * (CH + GAP)]) as Pt,
    );
    const home: Pt[] = new Array(n);
    perm.forEach((card, s) => (home[card] = tray[s]));
    const binSlot = (_b: number, j: number): Pt => {
      const row = Math.floor(j / cols), col = j % cols;
      const inRow = Math.min(cols, n - row * cols);
      const box = binBoxes[0];
      return [box.c[0] + (col - (inRow - 1) / 2) * (w + 10), box.c[1] + box.h / 2 - 44 - CH / 2 - row * (CH + 8)];
    };
    let seen = 0;
    const truth = truthBin.map((b, i) => (b === 0 ? binSlot(0, seen++) : home[i]));
    // Tap all: the cards are read where they stand, on a phone too (≥ ~10 px at 390 px).
    return { ...base, mode, cards, texts, truthBin, bins, w, h: CH, home, slots: tray, binBoxes, binSlot, truth, select: true, font: icons ? 22 : 26, layout };
  }
```

(Under rise every number is today's: `bx0 = x0`, `bWidth = width`, `binW - 20 > 180`.)

Replace the sort branch (from `// Sort: the boxes across the top…` to its `return`) with:

```ts
  // Sort (round 7 §5): drop — the cards in a row (two when many) on top,
  // the boxes below; side — the cards a column on the left, the boxes on the
  // right; rise — the boxes on top, as before.
  const layout = sortLayout(el, n);
  const side = layout === "side";
  const k = bins.length;
  const bx0 = side ? x0 + width / 3 + GAP : x0;
  const bWidth = x1 - bx0;
  const binW = bWidth / k - 2 * GAP;
  const perBin = bins.map((_, b) => truthBin.filter((t) => t === b).length);
  const perRow = side ? 1 : n > 5 ? Math.ceil(n / 2) : n;
  const slotW = side ? width / 3 : width / perRow;
  let w = Math.min(180, slotW - GAP, binW - 20);
  // Any box may get every card (final fix wave E): its grid holds all n in
  // the old number of rows — more columns (the cards narrower, never under
  // 56) — and when even that is too many rows, shorter cards (fix round 2):
  // the boxes and the cards stay on the canvas.
  const room = Math.max(2, ...perBin, Math.ceil(n / 2));
  let cols = 1;
  while (Math.ceil(n / cols) > room && (binW - 12) / (cols + 1) - 10 >= 56) {
    cols++;
    w = Math.min(w, (binW - 12) / cols - 10);
  }
  const rows = Math.max(room, Math.ceil(n / cols));
  const topY = isNum(el.y) ? el.y : 660;
  const trayRows = Math.ceil(n / perRow);
  const boxH = (h: number): number => 52 + rows * (h + 8);
  const trayH = (h: number): number => trayRows * (h + GAP) - GAP;
  // The lowest the cards or the boxes reach; drop and side keep the counter's row too.
  const lowest = (h: number): number => (side ? Math.min(topY - boxH(h), topY - trayH(h)) : topY - boxH(h) - 40 - trayH(h));
  const floor = CARD_FLOOR + (layout === "rise" ? 0 : COUNTER_ROOM);
  let ch = CH;
  while (ch > 28 && lowest(ch) < floor) ch -= 2;
  const binH = 44 + rows * (ch + 8) + 8;
  const boxTop = layout === "drop" ? topY - trayH(ch) - 40 : topY;
  const binBoxes: CardBox[] = bins.map((_, b) => ({ c: [bx0 + (bWidth / k) * (b + 0.5), boxTop - binH / 2] as Pt, w: binW, h: binH }));
  const trayTop = layout === "rise" ? topY - binH - 40 : topY;
  const tray: Pt[] = items.map((_, s) =>
    (side ? [x0 + width / 6, trayTop - ch / 2 - s * (ch + GAP)] : [x0 + slotW * ((s % perRow) + 0.5), trayTop - ch / 2 - Math.floor(s / perRow) * (ch + GAP)]) as Pt,
  );
  const home: Pt[] = new Array(n);
  perm.forEach((card, s) => (home[card] = tray[s]));
  // Down the first column, then the next: a box holding no more than a
  // column's worth shows one centred column, as it always did.
  const binSlot = (b: number, j: number, count = 0): Pt => {
    const box = binBoxes[b];
    const col = Math.floor(j / rows), row = j % rows;
    const used = Math.max(1, Math.min(cols, Math.ceil(Math.max(count, j + 1) / rows)));
    return [box.c[0] + (col - (used - 1) / 2) * (w + 10), box.c[1] + box.h / 2 - 44 - ch / 2 - row * (ch + 8)];
  };
  const seen = bins.map(() => 0);
  const truth = truthBin.map((b) => binSlot(b, seen[b]++, perBin[b]));
  // Shorter cards, smaller text (narrow ones too); else the mode's own size.
  const font = ch < CH || w < 90 ? Math.round(Math.min(20 * (ch / CH), w < 90 ? 16 : 20)) : undefined;
  return { ...base, mode, cards, texts, truthBin, bins, w, h: ch, home, slots: tray, binBoxes, binSlot, truth, layout, ...(font !== undefined && !icons ? { font } : {}) };
```

(Under rise: `lowest` is today's `binTop - (52 + rows*(h+8)) - 40 - trayRows*(h+GAP) + GAP`, `floor` is `CARD_FLOOR`, the boxes' top is `topY`.)

- [ ] **Step 5: The deck**

The call (line 456): `if (deck) return deckGeometry(el, base, items.map((it) => it.text), truthBin, bins, perm, icons, x0, width, sortLayout(el, n));`

`deckGeometry` gets a last parameter `layout: "drop" | "side" | "rise"` and its doc comment's first line becomes `deck (round 6 §7, round 7 §5): the boxes hold the cards small, in a grid each …; the dealt card stands over the boxes (drop, default), on their left (side) or under them (rise), drawn deckScale times larger.` Its body, from `const n = texts.length;` through `const binH = heightFor(cols, h);` becomes:

```ts
  const n = texts.length;
  const k = Math.max(1, bins.length);
  const side = layout === "side";
  // side: the boxes across the right two-thirds, the dealt card in the left third.
  const bx0 = side ? x0 + width / 3 + GAP : x0;
  const bWidth = x0 + width - bx0;
  const binW = bWidth / k - 2 * GAP;
  const topY = isNum(el.y) ? el.y : 720;
  const h0 = icons ? CARD_H : 32;
  const PAD = 8, GX = 8, GY = 6, TITLE = 40;
  // The counter's row under the boxes (drop, side).
  const floor = CARD_FLOOR + COUNTER_ROOM;
  // Room for the boxes: rise — the dealt card needs about 150 under them;
  // drop — about 150 over them and the counter under them; side — all of it.
  const maxH = layout === "rise" ? topY - 170 : layout === "drop" ? topY - 170 - floor : topY - floor;
```

— the lines from `// Any box may get every card` through `const binH = heightFor(cols, h);` stay as they are — then from `const binBoxes: CardBox[] = …` to `const home: Pt[] = …` becomes:

```ts
  // drop: the boxes stand on the floor, the dealt card over them.
  const binTop = layout === "drop" ? floor + binH : topY;
  const binBoxes: CardBox[] = bins.map((_, b) => ({ c: [bx0 + (bWidth / k) * (b + 0.5), binTop - binH / 2] as Pt, w: binW, h: binH }));
  const binSlot = (b: number, j: number): Pt => {
    const box = binBoxes[b];
    if (!box) return [0, 0];
    // Past the grid, cards pile on the first slots, a little offset.
    const layer = Math.floor(j / (rows * cols));
    const q = j % (rows * cols);
    const row = Math.floor(q / cols), col = q % cols;
    const left = box.c[0] - ((cols - 1) * (w + GX)) / 2;
    return [left + col * (w + GX) + layer * 5, box.c[1] + box.h / 2 - TITLE - h / 2 - row * (h + GY) - layer * 5];
  };
  const boxBottom = binTop - binH;
  // The dealt card by the canvas, not by the small card (final fix wave E):
  // about 600 wide — on a 390 px phone its text is ~17 px — as tall as its room allows.
  let deckScale: number;
  let cx: number;
  let cy: number;
  if (layout === "rise") {
    deckScale = Math.max(1, Math.min(600 / w, (icons ? 160 : 110) / h, (boxBottom - 40) / h));
    const bigH = h * deckScale;
    cx = x0 + width / 2;
    cy = Math.max(bigH / 2 + 12, Math.min(boxBottom - bigH / 2 - 24, boxBottom / 2));
  } else if (layout === "drop") {
    // Over the boxes: the dealt card flies down into one.
    deckScale = Math.max(1, Math.min(600 / w, (icons ? 160 : 110) / h, (topY - binTop - 40) / h));
    const bigH = h * deckScale;
    cx = x0 + width / 2;
    cy = Math.min(topY - bigH / 2 - 12, Math.max(binTop + bigH / 2 + 24, (topY + binTop) / 2));
  } else {
    // side: in the left third, level with the boxes.
    deckScale = Math.max(1, Math.min((width / 3 - GAP) / w, (icons ? 160 : 110) / h, (topY - floor) / h));
    cx = x0 + width / 6;
    cy = (topY + floor) / 2;
  }
  // Every card waits in the middle; only the top one is drawn (cardsElements:
  // the others are not the group's members — the deal shows each in turn).
  const home: Pt[] = deal.map(() => [cx, cy] as Pt);
```

and the `return` adds `layout`: `return { ...base, cards, texts, truthBin, bins, w, h, home, slots: home.slice(), binBoxes, binSlot, truth, deck: true, deal, deckScale, font, layout };`.

- [ ] **Step 6: The unrouted line, the lint, the examples**

`src/cards/beside.ts`, in the unrouted loop (line ~257), replace the `texts.push(…)` with:

```ts
    // Under its box — above it when the box stands on the floor (drop).
    const under = bx.c[1] - bx.h / 2 - 16 - k * 20;
    const y = under >= 12 ? under : bx.c[1] + bx.h / 2 + 16 + k * 20;
    texts.push({ at: [bx.c[0], y], text: `${names} → ${u.to >= 0 ? short(g.bins[u.to], 16) : "out"}`, anchor: "middle", color: WRONG, size: 16 });
```

`src/lint/lint.ts`: add to the rule union, after `| "deck-text"`:

```ts
    /** cards arrange: "side" with more than 8 cards — laid out as drop (round 7 §5) — warns */
    | "cards-side"
```

and in `lintFeedback` after the deck-text loop:

```ts
  // arrange: side (round 7 §5) holds up to 8 cards in its column; more are laid out as drop.
  const sides = [...(spec.elements ?? []).filter((e) => e.type === "cards"), ...authoredCards(spec)].filter((e) => (e as { arrange?: unknown }).arrange === "side") as CardsElementLike[];
  for (const el of sides) {
    const n = (el.items ?? []).length;
    if (n > 8) warn("cards-side", [el.id], `${el.id}: arrange "side" holds up to 8 cards in its column (${n} here) — it is laid out as drop`);
  }
```

Then run the bundled examples: `npx vitest run tests/examples.test.ts tests/cards-look.test.ts tests/round6-prompt.test.ts`. If an example's layout lint now fails because of the drop layout (the one with explicit geometry is index 386 "The deadliest animal", cards `kind` with `x: 485, width: 505`), give that cards element `arrange: "rise"`:

```bash
node -e 'const fs=require("fs");const p="src/examples.json";const e=JSON.parse(fs.readFileSync(p,"utf8"));const el=e[386].spec.elements.find(x=>x.id==="kind");el.arrange="rise";fs.writeFileSync(p,JSON.stringify(e,null,2)+"\n")'
```

(and likewise for any other example the run names), then re-run.

- [ ] **Step 7: Run everything this touches, re-pin, type-check**

Run: `npx vitest run tests/cards-arrange.test.ts tests/cards-counter.test.ts tests/cards-box-capacity.test.ts tests/cards-faster-sort.test.ts tests/cards.test.ts tests/cards-look.test.ts tests/cards-beside.test.ts tests/cards-gate-tap.test.ts tests/cards-deck-player.test.ts tests/cards-check-player.test.ts tests/examples.test.ts`
Expected: PASS. Then re-pin `tests/prompt-size.test.ts` ("round 7 Task 7: cards arrange drop / side / rise") and `npx tsc --noEmit`.

- [ ] **Step 8: Commit**

```bash
git add src/spec/cards.ts src/spec/types.ts src/spec/schema.ts src/cards/beside.ts src/lint/lint.ts tests/cards-arrange.test.ts tests/cards-counter.test.ts tests/cards-box-capacity.test.ts tests/cards-faster-sort.test.ts tests/prompt-size.test.ts
git add src/examples.json   # only if Step 6 changed it
git commit -m "Round 7: cards above the boxes by default (drop); side and rise layouts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

---

### Task 8: Bar colours — `bar_colors`, decided from the labels (spec §7, build order 6)

**Files:**
- Create: `src/scenes/bar-colors.ts`
- Modify: `src/scenes/kit.ts` — `KIT_VERSION` 13 (line 45), `SceneKit.barColorsFor`, `kit.barColorsFor`
- Modify: `src/scenes/packs/data.yaml` — bar_chart `kit: 13` (line 8), param `bar_colors`, the layout body (after `const m = series.length;` and line 313)
- Modify: `src/spec/expand.ts` — new `markBarGuess`, applied last in `expandSpec`
- Modify: `tests/scene-kit.test.ts:166-167`, `tests/prompt-size.test.ts`
- Test: `tests/bar-colors.test.ts` (new)

**Interfaces:**
- Produces:
  - `src/scenes/bar-colors.ts`: `export type BarColors = "each" | "same";` `export function barColorsFor(labels: readonly string[]): BarColors`.
  - `kit.barColorsFor(labels: readonly string[]): "each" | "same"` (kit v13).
  - bar_chart param `bar_colors: "each" | "same"`; run-time param `bar_guess: true` set by `markBarGuess(spec: Spec): Spec` (`src/spec/expand.ts`) when an ask's `on` names `bar_k` or `"all"` on a bar_chart. While it is on, the per-bar cycle skips `COLORS.series[1]` (the blue next to the guess's own).

- [ ] **Step 1: Write the failing test**

Create `tests/bar-colors.test.ts`:

```ts
// A bar chart's colours from its labels (round 7 §7): different things,
// a colour each; one quantity over ordered levels, one colour.
import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { COLORS, flattenDrawables, type AreaDrawable } from "../src/layout/model";
import { barColorsFor } from "../src/scenes/bar-colors";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  expect(registerPack("data", dataYaml).errors).toEqual([]);
});
const fill = (l: ReturnType<typeof layoutSpec>, id: string) => (flattenDrawables(l.drawables).find((d) => d.id === id) as AreaDrawable).style.fill;
const fills = (spec: Spec, n: number) => {
  const l = layoutSpec(spec);
  return Array.from({ length: n }, (_, i) => fill(l, `bar_${i + 1}__f0`));
};
const S = COLORS.series;

describe("the label rule", () => {
  test("names of things: each", () => expect(barColorsFor(["Shark", "Hippo", "Dog"])).toBe("each"));
  test("numbers and years: same", () => {
    expect(barColorsFor(["2015", "2016", "2017"])).toBe("same");
    expect(barColorsFor(["1", "2", "3"])).toBe("same");
    expect(barColorsFor(["1 200", "3.5", "1990s"])).toBe("same");
  });
  test("ranges and bins: same", () => {
    expect(barColorsFor(["0–9", "10-19", "20–29"])).toBe("same");
    expect(barColorsFor(["<5", "5-14", "65+"])).toBe("same");
  });
  test("months and weekdays, English and Norwegian, long and short: same", () => {
    expect(barColorsFor(["Jan", "Feb", "Mar"])).toBe("same");
    expect(barColorsFor(["januar", "februar", "mars"])).toBe("same");
    expect(barColorsFor(["mai", "jun.", "des"])).toBe("same");
    expect(barColorsFor(["Monday", "Tuesday"])).toBe("same");
    expect(barColorsFor(["man", "tir", "ons", "lørdag", "søndag"])).toBe("same");
  });
  test("mixed: each; no labels (a token): same", () => {
    expect(barColorsFor(["2019", "Norway"])).toBe("each");
    expect(barColorsFor([])).toBe("same");
  });
});

describe("the chart", () => {
  const chart = (params: object, commands: object[] = []) => ({ template: "bar_chart", params, commands }) as unknown as Spec;
  test("names: each bar its own colour", () => {
    expect(fills(chart({ labels: ["Shark", "Dog", "Snake"], values: [1, 2, 3] }), 3)).toEqual([S[0], S[1], S[2]]);
  });
  test("years: one colour", () => {
    expect(fills(chart({ labels: ["2015", "2016", "2017"], values: [1, 2, 3] }), 3)).toEqual([S[0], S[0], S[0]]);
  });
  test("bar_colors wins over the labels", () => {
    expect(fills(chart({ labels: ["Shark", "Dog"], values: [1, 2], bar_colors: "same" }), 2)).toEqual([S[0], S[0]]);
    expect(fills(chart({ labels: ["2015", "2016"], values: [1, 2], bar_colors: "each" }), 2)).toEqual([S[0], S[1]]);
  });
  test("grouped series keep one colour per series", () => {
    const l = layoutSpec(chart({ labels: ["a", "b"], series: [{ name: "x", values: [1, 2] }, { name: "y", values: [3, 4] }] }));
    expect(fill(l, "bar_2__f0")).toBe(S[0]);
    expect(fill(l, "bar_2__f1")).toBe(S[1]);
  });
  test("a guess on the chart skips the blue next to yours", () => {
    const spec = expandSpec(chart({ labels: ["Shark", "Dog", "Snake"], values: [1, 2, 3] }, [{ ask: { question: "How many people does the dog kill each year? Drag its bar.", on: "bar_2" } }]));
    expect(spec.params!.bar_guess).toBe(true);
    expect(fills(spec, 3)).toEqual([S[0], S[2], S[3]]);
  });
});
```

Run: `npx vitest run tests/bar-colors.test.ts` — Expected: FAIL (`../src/scenes/bar-colors` missing).

- [ ] **Step 2: The rule**

Create `src/scenes/bar-colors.ts`:

```ts
// A bar chart's colours from its labels (round 7 §7): bars that count one
// quantity over ordered levels — numbers, years, ranges or bins, months,
// weekdays — share one colour; bars that are different things get one each.
// The labels may be Norwegian (a translated cast). Pure; the kit carries it
// to the bar_chart body.

export type BarColors = "each" | "same";

const CALENDAR = new Set([
  // months — English, Norwegian; long and short
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "januar", "februar", "mars", "mai", "juni", "juli", "oktober", "desember", "okt", "des",
  // weekdays
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag",
  "man", "tir", "ons", "tor", "fre", "lør", "søn",
]);

const ORDERED: RegExp[] = [
  // 12, 1 200, 3.5, <5, ≥10, 65+, 40 %, 1990s
  /^[<>≤≥]?\s*[-−]?\d[\d\s.,]*\s*(%|\+|s)?$/,
  // 0–9, 10-19, 2019–20
  /^[-−]?\d[\d.,]*\s*[-–—/]\s*[-−]?\d[\d.,]*\s*%?$/,
];

const ordered = (label: string): boolean => {
  const l = label.trim().toLowerCase().replace(/\.$/, "");
  return ORDERED.some((r) => r.test(l)) || CALENDAR.has(l);
};

/** "same" when every label is an ordered level (none: same); else "each". */
export function barColorsFor(labels: readonly string[]): BarColors {
  const ls = labels.map((l) => String(l).trim()).filter((l) => l !== "");
  return ls.every(ordered) ? "same" : "each";
}
```

- [ ] **Step 3: Kit v13**

`src/scenes/kit.ts`: `import { barColorsFor } from "./bar-colors";`; line 45 becomes

```ts
export const KIT_VERSION = 13; // v13: barColorsFor() — a bar chart's colours from its labels (2026-10-02); v12: num(v, d, true) groups thousands (2026-09-30); …
```

(keep the rest of the comment). In `SceneKit` after `num(…)`:

```ts
  /** A bar chart's colours from its labels (round 7 §7): "same" for ordered levels (numbers, years, ranges, months, weekdays), else "each". */
  barColorsFor(labels: readonly string[]): "each" | "same";
```

and in the `kit` object: `barColorsFor: (labels) => barColorsFor(labels),`.

`tests/scene-kit.test.ts:166`: `test("KIT_VERSION is 13 and constants ride on the kit", () => { expect(KIT_VERSION).toBe(13); …`.

- [ ] **Step 4: The template**

`src/scenes/packs/data.yaml`, bar_chart: `kit: 13`. In `params.properties`, after `value_labels`:

```yaml
    bar_colors:
      enum: [each, same]
      description: "One series: each — every bar its own colour (bars that are different things); same — one colour (one quantity over years, ranges, months). Default: from the labels."
```

In the layout body, after `const m = series.length;`:

```js
  // Bar colours (round 7 §7): one series, not stacked — a colour per bar when
  // the bars are different things, one colour when they count one thing over
  // ordered levels (from the labels unless given). While a guess is on
  // (bar_guess, set by the expansion) the blue beside the guess's own is skipped.
  const barColors = params.bar_colors === "each" || params.bar_colors === "same" ? params.bar_colors : kit.barColorsFor(labels);
  const perBar = m === 1 && !stacked && barColors === "each";
  const cycle = params.bar_guess === true ? C.series.filter((_, k) => k !== 1) : C.series;
```

and at line 313 `const color = C.series[j % C.series.length];` becomes:

```js
      const color = perBar ? cycle[i % cycle.length] : C.series[j % C.series.length];
```

- [ ] **Step 5: `markBarGuess`**

`src/spec/expand.ts`, above `expandSpec`:

```ts
/** A guess on a bar chart (round 7 §7): bar_guess on, so its per-bar colours
 *  skip the blue beside the guess's own. The same object back otherwise. */
export function markBarGuess(spec: Spec): Spec {
  if (spec.template !== "bar_chart" || !spec.params || spec.params.bar_guess === true) return spec;
  const asked = (spec.commands ?? []).some((c) => {
    const on = c.ask?.on;
    const ids = typeof on === "string" ? [on] : Array.isArray(on) ? on : [];
    return ids.some((id) => id === "all" || /^bar_\d+$/.test(id));
  });
  return asked ? { ...spec, params: { ...spec.params, bar_guess: true } } : spec;
}
```

and `expandSpec` returns `markBarGuess(expandWalks(…))` (wrap the existing chain).

- [ ] **Step 6: Run, re-pin, type-check**

Run: `npx vitest run tests/bar-colors.test.ts tests/data-pack.test.ts tests/scene-kit.test.ts tests/guess-reveal.test.ts tests/guess-handles.test.ts tests/guess-beside-player.test.ts tests/guess-keep-player.test.ts tests/template-box.test.ts tests/examples.test.ts tests/packs.test.ts`
Expected: PASS (if a test pinned a single-series fill to `#b5482e` on name labels, give that fixture `bar_colors: "same"`). Re-pin `tests/prompt-size.test.ts` ("round 7 Task 8: bar_chart bar_colors"), `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/bar-colors.ts src/scenes/kit.ts src/scenes/packs/data.yaml src/spec/expand.ts tests/bar-colors.test.ts tests/scene-kit.test.ts tests/prompt-size.test.ts
git commit -m "Round 7: bar colours decided from the labels; bar_colors each/same

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

---

### Task 9: Icons under the bars — `icons` on bar_chart (spec §6, build order 6)

**Files:**
- Modify: `src/scenes/kit.ts` — `KIT_VERSION` 14, `SceneKit.icon`, `kit.icon`; imports
- Modify: `src/scenes/compile.ts:124-162` — `validateDrawableNode` accepts `image`
- Modify: `src/spec/icon-data.ts` — `iconSlots` (line 212) reads bar_chart `params.icons`; `fillIconDataInPlace` (line 265) creates hosts; `hoistIcons` (line 298) drops an emptied `icon_data`
- Modify: `src/render/icon.ts` — `resolveIcons` (line 337) resolves bar icons
- Modify: `src/llm/hoist.ts` — `stripStrokesForModel` (line 224) drops `params.icon_data`
- Modify: `src/layout/layout.ts` — after the template block (line ~245) warns on a keyword with no data; `src/layout/tier2.ts:1590` exports `noIconWarning`
- Modify: `src/scenes/packs/data.yaml` — bar_chart `kit: 14`, params `icons`, `icon_look`, `icon_data`, `element_ids.bar_1`, layout body, a `lint: |` hook
- Modify: `tests/scene-kit.test.ts`, `tests/spec-i18n.test.ts`, `tests/prompt-size.test.ts`
- Test: `tests/bar-icons.test.ts` (new)

**Interfaces:**
- Consumes: `iconPictureOf`, `iconRingsOf`, `iconAsk`, `iconLookOf`, `isIconData`, `iconAssetName`, `storedIcon` (`src/spec/icon-data.ts`); `fillOne` (`src/render/icon.ts`, module-private).
- Produces:
  - `kit.icon(id: string, data: unknown, at: Pt, size: number, o?: { look?: "picture" | "drawn"; color?: string; ms?: number }): GroupDrawable | null` — picture: group `id` holding image `${id}__pic`; drawn or rings-only: strokes `${id}__r${k}`; null without data.
  - bar_chart params: `icons: (string | {of, set?} | null)[]` (one per bar, keywords only), `icon_look: "picture" | "drawn"`, machine-written `icon_data: {strokes?, credit?, icon_key?}[]` (never by hand). The icon is `bar_i__icon`, a child of `bar_i`.
  - `iconSlots(spec, opts?: { create?: boolean })` — bar slots have `host` = `params.icon_data[i]` (created when `create`), `data: "strokes"`, `credit: "credit"`.
  - `export function noIconWarning(keyword: string): string` from `src/layout/tier2.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/bar-icons.test.ts`:

```ts
// Icons under the bars (round 7 §6): a picture each, between the axis and
// the label, part of its bar; a keyword missing from the cache is named.
import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { flattenDrawables, type GroupDrawable, type ImageDrawable, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import { hoistIcons, iconSlots } from "../src/spec/icon-data";
import { validateSceneLayout } from "../src/scenes/compile";
import { translatableStrings } from "../src/spec/i18n";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  expect(registerPack("data", dataYaml).errors).toEqual([]);
});
const chart = (params: object) => ({ template: "bar_chart", params, elements: [], commands: [] }) as unknown as Spec;
const find = (l: ReturnType<typeof layoutSpec>, id: string) => flattenDrawables(l.drawables).find((d) => d.id === id);
const params = { labels: ["Shark", "Dog", "Snake"], values: [1, 25, 50], icons: ["shark", "dog", "snake"] };

describe("icons under the bars", () => {
  test("a picture each, under the axis and over the label, inside its bar's group", () => {
    const l = layoutSpec(expandSpec(chart(params)));
    expect(l.warnings).toEqual([]);
    const bar = l.drawables.find((d) => d.id === "bar_1") as GroupDrawable;
    const pic = flattenDrawables(bar.children).find((d) => d.id === "bar_1__icon__pic") as ImageDrawable;
    expect(pic.kind).toBe("image");
    expect(pic.href.startsWith("data:image/")).toBe(true);
    const label = find(l, "bar_1__l") as TextDrawable;
    const axisY = (find(l, "axes__x") as StrokeDrawable).pts[0][1];
    expect(pic.pos[1] + pic.h / 2).toBeLessThan(axisY);
    expect(pic.pos[1] - pic.h / 2).toBeGreaterThan(label.pos[1]);
    expect(Math.max(pic.w, pic.h)).toBeLessThanOrEqual(44.01);
  });

  test("the row is kept for the keywords: the chart does not jump when the data arrives", () => {
    const bare = layoutSpec(chart(params));
    const full = layoutSpec(expandSpec(chart(params)));
    expect((find(bare, "bar_1__l") as TextDrawable).pos).toEqual((find(full, "bar_1__l") as TextDrawable).pos);
  });

  test("a keyword missing from the cache is named in a warning (Review Focus 5)", () => {
    const l = layoutSpec(expandSpec(chart({ ...params, icons: ["shark", "zzqxblorp", "snake"] })));
    expect(l.warnings.some((w) => /zzqxblorp/.test(w))).toBe(true);
  });

  test("more than 12 bars: no icons, and the template lint says so", () => {
    const labels = Array.from({ length: 13 }, (_, i) => `B${i + 1}`);
    const l = layoutSpec(expandSpec(chart({ labels, values: labels.map((_, i) => i + 1), icons: labels.map(() => "dog") })));
    expect(flattenDrawables(l.drawables).some((d) => /__icon/.test(d.id))).toBe(false);
    expect(l.issues.some((i) => i.rule === "template-params" && /icons/.test(i.message))).toBe(true);
  });

  test("slots, hoist and translation: keywords only in the document", () => {
    const spec = expandSpec(chart(params));
    expect(iconSlots(spec)).toHaveLength(3);
    const copy = structuredClone(spec);
    expect(hoistIcons(copy)).toBe(3);
    expect(copy.params!.icon_data).toBeUndefined();
    expect(Object.keys(copy.assets ?? {})).toContain("icon.shark");
    const schema = scenes.bar_chart!.manifest.params_schema as Record<string, unknown>;
    expect(translatableStrings(spec, schema).map((t) => t.text)).toEqual(["Shark", "Dog", "Snake"]);
  });

  test("a pack body may draw only self-contained pictures", () => {
    const img = { id: "x", kind: "image", href: "https://example.com/a.svg", pos: [10, 10], w: 10, h: 10 };
    expect(validateSceneLayout({ drawables: [img], labels: [], anchors: {}, order: ["x"] }).some((e) => /data:image/.test(e))).toBe(true);
    expect(validateSceneLayout({ drawables: [{ ...img, href: "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E" }], labels: [], anchors: {}, order: ["x"] })).toEqual([]);
  });
});
```

Run: `npx vitest run tests/bar-icons.test.ts` — Expected: FAIL (no `__icon` drawables).

- [ ] **Step 2: Kit v14 `icon`, and the drawable check**

`src/scenes/kit.ts`: import `iconPictureOf, iconRingsOf` from `"../spec/icon-data"` and `type ImageDrawable` from `"../layout/model"`. `KIT_VERSION = 14; // v14: icon() — an icon's picture or its traced rings (bar icons, 2026-10-02); v13: …`. In `SceneKit`, after `group(…)`:

```ts
  /**
   * An icon from its data (spec/icon-data.ts) in a size×size square centred
   * on `at`: the picture, faded in whole (look "picture", the default), or
   * its rings traced (look "drawn", or rings-only data). One group `id`, so
   * it draws, highlights and erases with whatever holds it. Null without data.
   */
  icon(id: string, data: unknown, at: Pt, size: number, o?: { look?: "picture" | "drawn"; color?: string; ms?: number }): GroupDrawable | null;
```

In the `kit` object, after `group(…)`:

```ts
  icon(id, data, at, size, o = {}) {
    const ms = o.ms ?? SKETCH_MS.stroke;
    const ink = o.color ?? COLORS.ink;
    const pic = (o.look ?? "picture") === "picture" ? iconPictureOf(data, ink) : null;
    if (pic) {
      const h = pic.aspect >= 1 ? size : size * pic.aspect;
      const w = pic.aspect >= 1 ? size / pic.aspect : size;
      const img: ImageDrawable = { id: `${id}__pic`, kind: "image", href: pic.href, pos: at, w, h, z: Z_STROKE, style: defaultStyle(), reveal: "fade", drawOpts: defaultDrawOpts("sketch", Math.min(700, ms)) };
      return { id, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch", ms), children: [img] };
    }
    const rings = iconRingsOf(data);
    if (!rings) return null;
    const [cx, cy] = at;
    return kit.group(id, rings.map((ring, k) => kit.stroke(`${id}__r${k}`, ring.map(([u, v]) => [cx - size / 2 + u * size, cy + size / 2 - v * size] as Pt), { closed: true, color: ink, strokeWidth: 2, ms })));
  },
```

`tests/scene-kit.test.ts`: `KIT_VERSION is 14`, `toBe(14)`.

`src/scenes/compile.ts`, `validateDrawableNode`, before the final `else`:

```ts
  } else if (d.kind === "image") {
    if (!finitePt(d.pos)) errors.push(`image "${d.id}": pos must be a finite point (bounds/finite check)`);
    const size = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v > 0;
    if (!size(d.w) || !size(d.h)) errors.push(`image "${d.id}": w and h must be finite and positive`);
    // Self-contained only: a remote pack must never point the page at a URL.
    if (typeof d.href !== "string" || !d.href.startsWith("data:image/")) errors.push(`image "${d.id}": href must be a data:image/ URI`);
```

- [ ] **Step 3: Icon slots, resolving, hoisting, the model copy**

`src/spec/icon-data.ts`, `iconSlots` becomes:

```ts
/** Every icon a spec asks for: icon elements, nodes, cards' items (and match
 *  partners), a bar chart's `icons` (round 7 §6). `create`: a bar icon's
 *  data host (params.icon_data[i]) is made when missing — for the writers;
 *  readers get a throwaway host. */
export function iconSlots(spec: Pick<Spec, "elements"> & Partial<Pick<Spec, "template" | "params">>, opts: { create?: boolean } = {}): IconSlot[] {
  const out: IconSlot[] = [];
  // …the existing element loop, unchanged…
  const p = spec.params as Record<string, unknown> | undefined;
  if (spec.template === "bar_chart" && p && Array.isArray(p.icons)) {
    const look = iconLookOf({ type: "bar", icon_look: p.icon_look });
    if (opts.create && !Array.isArray(p.icon_data)) p.icon_data = [];
    const hosts = (Array.isArray(p.icon_data) ? p.icon_data : []) as unknown[];
    p.icons.forEach((k, i) => {
      const ask = iconAsk(k);
      if (!ask) return;
      if (opts.create && (typeof hosts[i] !== "object" || hosts[i] === null)) hosts[i] = {};
      const host = typeof hosts[i] === "object" && hosts[i] !== null ? (hosts[i] as Record<string, unknown>) : {};
      out.push({ ask, look, host, data: "strokes", credit: "credit" });
    });
  }
  return out;
}
```

`iconCount`, `unembeddedIcons` keep their signatures but widen the parameter to `Pick<Spec, "elements"> & Partial<Pick<Spec, "template" | "params">>` (resp. `… | "assets"`). In `fillIconDataInPlace`: `for (const s of iconSlots(spec, { create: true })) {`. At the end of `hoistIcons`, before `return moved;`:

```ts
  // A bar chart's emptied data hosts go (keywords only in the document).
  const p = spec.params as Record<string, unknown> | undefined;
  if (p && Array.isArray(p.icon_data) && p.icon_data.every((h) => typeof h !== "object" || h === null || Object.keys(h).length === 0)) delete p.icon_data;
```

`src/render/icon.ts`, `resolveIcons`, after the element loop and before `return results;`:

```ts
  // A bar chart's icons (round 7 §6): one per bar, into params.icon_data[i].
  const p = spec.params as Record<string, unknown> | undefined;
  if (spec.template === "bar_chart" && p && Array.isArray(p.icons)) {
    const look = iconLookOf({ type: "bar", icon_look: p.icon_look });
    for (const [i, k] of (p.icons as unknown[]).entries()) {
      const req = iconAsk(k);
      if (!req) continue;
      const data = (Array.isArray(p.icon_data) ? p.icon_data : (p.icon_data = [])) as Record<string, unknown>[];
      const host = (data[i] ??= {});
      try {
        await fillOne(spec, host, { data: "strokes", key: "icon_key", credit: "credit" }, req, look, deps, opts);
        results.push({ id: `bar_${i + 1}`, ok: true });
      } catch (err) {
        results.push({ id: `bar_${i + 1}`, ok: false, error: (err as Error).message });
      }
    }
  }
```

(import `iconAsk` / `iconLookOf` if not already imported there.)

`src/llm/hoist.ts`, first lines of `stripStrokesForModel`:

```ts
  // A bar chart's icon data (round 7 §6) is machine-written: the keywords stay.
  if (spec.params && "icon_data" in spec.params) {
    const { icon_data: _d, ...params } = spec.params as Record<string, unknown>;
    spec = { ...spec, params };
  }
```

- [ ] **Step 4: The template**

`src/scenes/packs/data.yaml`, bar_chart: `kit: 14`. Params, after `bar_colors`:

```yaml
    icons:
      type: array
      maxItems: 40
      items:
        oneOf:
          - { type: string, x-translate: false }
          - { type: "null" }
          - type: object
            properties:
              of: { type: string, x-translate: false }
              set: { type: string, x-translate: false }
            required: [of]
      description: "One icon KEYWORD per bar, as labels (\"mosquito\", or {of, set}; null for none) — shown as a picture under the bar, above its label. Up to 12 bars."
    icon_look:
      enum: [picture, drawn]
      description: "picture (default) or drawn (traced by hand)."
    icon_data:
      type: array
      description: "Machine-written from the icon cache or assets — never write it."
      items:
        type: object
        additionalProperties: { type: string, x-translate: false }
```

`element_ids.bar_1`: `"the first category's bar (its fill, outline, icon, category label and value label; bar_2, bar_3, … likewise) — one per label, at every stage"`.

Layout body — after `n = Math.min(40, n);`:

```js
  // Icons under the bars (round 7 §6): one per bar, up to 12, about 44 units,
  // between the axis and the category label. The row is kept for the
  // keywords, data or not, so the chart never jumps when they resolve.
  const iconKeys = Array.isArray(params.icons) ? params.icons : [];
  const iconData = Array.isArray(params.icon_data) ? params.icon_data : [];
  const withIcons = n > 0 && n <= 12 && iconKeys.some((k) => k !== null && k !== undefined && k !== "");
```

after `if (title) plot.y1 = …;`:

```js
  // The axis rises by the icon row.
  let iconRow = 0;
  if (withIcons) {
    const y0 = Math.min(plot.y1 - 40, plot.y0 + 54);
    iconRow = y0 - plot.y0;
    plot.y0 = y0;
  }
```

the x caption line passes the plot as it was:

```js
  if (xLab) axesChildren.push(kit.axisLabel("axes__x_label", "x", iconRow > 0 ? { ...plot, y0: plot.y0 - iconRow } : plot, xLab, { fontSize: 22, captionDrop: true }));
```

and the label push (line 335) becomes:

```js
    if (withIcons) {
      const k = iconKeys[i];
      const size = Math.min(44, slotW * (1 - gap), iconRow - 10);
      const ic = k !== null && k !== undefined && k !== "" ? kit.icon(id + "__icon", iconData[i] && iconData[i].strokes, [xc, plot.y0 - 6 - size / 2], size, { look: params.icon_look === "drawn" ? "drawn" : "picture" }) : null;
      if (ic) children.push(ic);
    }
    children.push(kit.text(id + "__l", [xc, plot.y0 - 20 - iconRow], labels[i] !== undefined ? labels[i] : String(i + 1), { fontSize: labelSize }));
```

After the layout body (still inside the bar_chart document, before the `---` that starts `pie_chart`), add the lint hook:

```yaml
lint: |
  const out = [];
  const icons = Array.isArray(params.icons) ? params.icons : [];
  const labels = Array.isArray(params.labels) ? params.labels : [];
  const n = Math.max(labels.length, Array.isArray(params.values) ? params.values.length : 0);
  if (icons.length > 0 && n > 12) out.push({ severity: "warn", message: "icons are shown on up to 12 bars — with " + n + " they are left out" });
  if (icons.length > 0 && labels.length > 0 && icons.length !== labels.length) out.push({ severity: "warn", message: "icons: one per bar, as labels (" + icons.length + " icons, " + labels.length + " labels)" });
  return out;
```

- [ ] **Step 5: The missing-keyword warning**

`src/layout/tier2.ts:1590`: `export function noIconWarning(…)`. `src/layout/layout.ts`: import `noIconWarning` from `./tier2` and `iconAsk, isIconData` from `../spec/icon-data`; inside the template `try`, after `drawables.push(...sceneLayout.drawables);`:

```ts
        // A bar's icon keyword with no artwork (round 7 §6): named, as a node's is.
        const bp = spec.params as Record<string, unknown> | undefined;
        if (spec.template === "bar_chart" && bp && Array.isArray(bp.icons) && Array.isArray(bp.icon_data) && sceneLayout.order.filter((o) => /^bar_\d+$/.test(o)).length <= 12) {
          const data = bp.icon_data as unknown[];
          (bp.icons as unknown[]).forEach((k, i) => {
            const ask = iconAsk(k);
            const host = data[i] as { strokes?: unknown } | undefined;
            if (ask && !isIconData(host?.strokes)) warnings.push(noIconWarning(ask.of));
          });
        }
```

(`icon_data` exists once the icons have been filled — by `withIconData` in `expandSpec` or the resolver; a bare layout with keywords only warns nothing, which keeps the "bare" test above quiet.)

- [ ] **Step 6: The i18n case**

`tests/spec-i18n.test.ts`, in "data tokens are never text" add:

```ts
  test("a bar chart's icon keywords and data are never text (round 7 §6)", () => {
    const schema = { type: "object", properties: { labels: { type: "array", items: { type: "string" } }, icons: { type: "array", items: { oneOf: [{ type: "string", "x-translate": false }, { type: "null" }, { type: "object", properties: { of: { type: "string", "x-translate": false }, set: { type: "string", "x-translate": false } } }] } }, icon_data: { type: "array", items: { type: "object", additionalProperties: { type: "string", "x-translate": false } } } } };
    const s: Spec = { template: "bar_chart", params: { labels: ["Shark"], icons: ["shark", { of: "dog", set: "twemoji" }], icon_data: [{ strokes: "ics1:xyz", credit: "Twemoji" }] }, elements: [], commands: [] };
    expect(translatableStrings(s, schema).map((t) => t.text)).toEqual(["Shark"]);
  });
```

- [ ] **Step 7: Run, re-pin, type-check**

Run: `npx vitest run tests/bar-icons.test.ts tests/spec-i18n.test.ts tests/scene-kit.test.ts tests/data-pack.test.ts tests/template-compile.test.ts tests/icon-keywords.test.ts tests/icon-stale.test.ts tests/cards-look.test.ts tests/examples.test.ts tests/bar-colors.test.ts`
Expected: PASS. Re-pin `tests/prompt-size.test.ts` ("round 7 Task 9: bar_chart icons, icon_look, icon_data"), check `tests/pack-defaults.test.ts` (one catalog entry under 16,000 chars) passes, `npx tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add src/scenes/kit.ts src/scenes/compile.ts src/spec/icon-data.ts src/render/icon.ts src/llm/hoist.ts src/layout/layout.ts src/layout/tier2.ts src/scenes/packs/data.yaml tests/bar-icons.test.ts tests/spec-i18n.test.ts tests/scene-kit.test.ts tests/prompt-size.test.ts
git commit -m "Round 7: icons under the bars — bar_chart icons, kit.icon, slots, resolve, hoist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

---
### Task 10: The question as a headline, the how line under it (spec §8.1, build order 7)

**Files:**
- Modify: `src/ui/gate-dock.ts` — new `GateHead`, `mountGateHead`; `mountGateDock` takes an optional `head`
- Modify: `src/ui/guess-gate.ts:312-326`, `src/ui/cards-gate.ts` (docked list, Skip, mount), `src/ui/formula-gate.ts:67,340,346`, `src/ui/tree-gate.ts:87,332,338`, `src/ui/choose-gate.ts:70,195,200`
- Modify: `src/render/player.ts` — the gate calls at lines ~1778, 1987, 2237, 2353, 2578 pass the question with its `{vars}` filled
- Modify: `src/styles.css` — headline rules, the title-card hide, delete the dead `.cs-guessgate .cs-figgate-hint` (lines 1782-1787) and `.cs-guessgate .cs-figgate-skip` (lines 1928-1933) rules
- Test: `tests/gate-headline.test.ts` (new)

**Interfaces:**
- Consumes: `AskGateStep.question` (`src/ui/controls.ts:235`); each gate's existing `hint` span (class `cs-figgate-hint`).
- Produces:
  - `export interface GateHead { question: string; how: HTMLElement }`
  - `export function mountGateHead(stage: HTMLElement, head: GateHead): { relayout(): void; dispose(): void } | null` — null (and nothing mounted) for an empty question. Mounts `div.cs-gatehead` on the STAGE (not the gate: it fades after the gate is removed) holding `div.cs-gatehead-q` and the how element (which gains `cs-gatehead-how`, loses `cs-waitgate-pill`, keeps `cs-figgate-hint`); adds `cs-headline` to the stage; `dispose()` removes the class, adds `cs-gatehead-out`, removes the node after 300 ms. A new mount removes any `.cs-gatehead` still fading.
  - `mountGateDock(stage, gate, items, onLayout, head?: GateHead): GateDock` — with a head and a question, the how line is in the headline and the bar holds only `items`; with an empty question the how line is the bar's first item (as before).
  - Gate bars list Skip first, then Answer (or Done).

- [ ] **Step 1: Write the failing test**

Create `tests/gate-headline.test.ts`:

```ts
// The question over the figure (round 7 §8.1): the ask's own sentence at the
// top, the gate's hint as the how line under it; the bar keeps only buttons,
// Skip then Answer; a title card's heading stands aside meanwhile.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

class El {
  className = "";
  children: El[] = [];
  text = "";
  parent: El | null = null;
  offsetHeight = 30;
  attrs: Record<string, string> = {};
  style: Record<string, unknown> = { setProperty: () => {}, removeProperty: () => {} };
  classList = {
    set: new Set<string>(),
    add: (c: string) => void this.classList.set.add(c),
    remove: (c: string) => void this.classList.set.delete(c),
    toggle: (c: string, on?: boolean) => void ((on ?? !this.classList.set.has(c)) ? this.classList.set.add(c) : this.classList.set.delete(c)),
    contains: (c: string) => this.classList.set.has(c),
  };
  constructor(public tag: string) {}
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  append(...xs: (El | string)[]): void {
    for (const x of xs) typeof x === "string" ? (this.text += x) : this.appendChild(x);
  }
  appendChild(x: El): El {
    x.parent = this;
    this.children.push(x);
    return x;
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  querySelector(q: string): unknown {
    if (q === "svg.cs-svg") return { getBoundingClientRect: () => ({ top: 40, left: 0, width: 800, height: 600 }) };
    if (q === ".cs-gatehead") return this.children.find((c) => c.className.split(" ").includes("cs-gatehead")) ?? null;
    return null;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 800, height: 700 };
  }
}

const gl = globalThis as Record<string, unknown>;
const saved = { document: gl.document };
beforeAll(() => {
  gl.document = { createElement: (tag: string) => new El(tag) };
});
afterAll(() => {
  gl.document = saved.document;
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const Q = "Which of these animals are mammals? Tap every mammal.";

async function mount(question: string, stage = new El("div")) {
  const { mountGateDock } = await import("../src/ui/gate-dock");
  const { h } = await import("../src/ui/dom");
  const gate = new El("div");
  stage.appendChild(gate);
  const how = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, "Tap a box, or drag a card") as unknown as El;
  const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip" }, "Skip ▸") as unknown as El;
  const answer = h("button", { class: "cs-cardgate-pill cs-guess-answer" }, "Answer ▸") as unknown as El;
  const dock = mountGateDock(stage as unknown as HTMLElement, gate as unknown as HTMLElement, [skip, answer] as unknown as HTMLElement[], () => {}, { question, how: how as unknown as HTMLElement });
  const bar = gate.children.find((c) => c.className === "cs-gatedock")!;
  const heads = () => stage.children.filter((c) => c.className === "cs-gatehead");
  return { stage, gate, how, skip, answer, dock, bar, heads };
}

describe("the headline", () => {
  test("the question over the figure, the how line under it; the bar keeps Skip then Answer", async () => {
    const m = await mount(Q);
    const [head] = m.heads();
    expect(head.textContent).toContain(Q);
    expect(head.children).toContain(m.how);
    expect(m.bar.children).toEqual([m.skip, m.answer]);
    expect(m.stage.classList.contains("cs-headline")).toBe(true);
    // Just under the drawing's top edge (the svg stands 40 px down).
    expect(head.style.top).toBe("46px");
    m.dock.dispose();
    expect(m.stage.classList.contains("cs-headline")).toBe(false);
    expect(head.classList.contains("cs-gatehead-out")).toBe(true);
    await wait(350);
    expect(m.heads()).toHaveLength(0);
  });

  test("no question (test me): no headline; the how line stays in the bar, first", async () => {
    const m = await mount("");
    expect(m.heads()).toHaveLength(0);
    expect(m.bar.children).toEqual([m.how, m.skip, m.answer]);
    expect(m.stage.classList.contains("cs-headline")).toBe(false);
  });

  test("a new question takes down a headline still fading", async () => {
    const a = await mount(Q);
    a.dock.dispose();
    const b = await mount("Which of these foods are fruit? Tap every fruit.", a.stage);
    expect(b.heads()).toHaveLength(1);
    expect(b.heads()[0].textContent).toContain("Which of these foods");
  });
});

describe("every docked gate", () => {
  for (const f of ["guess-gate", "cards-gate", "choose-gate", "formula-gate", "tree-gate"]) {
    test(`${f}: the question goes to the headline; Skip comes first in the bar`, () => {
      const src = readFileSync(new URL(`../src/ui/${f}.ts`, import.meta.url), "utf8");
      expect(src).toMatch(/mountGateDock\([^;]*\{ question: step\.question, how: hint \}\)/);
      expect(src).not.toMatch(/docked\.push\(skip\)/);
    });
  }

  test("CSS: a title card's heading stands aside under a headline; the old top-hint rules are gone", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.cs-stage\.cs-headline [^{]*card_[^{]*\{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.cs-gatehead-q\s*\{[^}]*line-clamp:\s*2/);
    expect(css).not.toMatch(/\.cs-guessgate \.cs-figgate-hint\s*\{/);
    expect(css).not.toMatch(/\.cs-guessgate \.cs-figgate-skip\s*\{/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/gate-headline.test.ts`
Expected: FAIL — no `.cs-gatehead`; the how line is not moved; the source checks fail.

- [ ] **Step 3: The dock (src/ui/gate-dock.ts)**

Header comment, add after the first paragraph:

```ts
// The question itself stands over the figure as a headline while it is open
// (round 7 §8.1), the gate's hint under it as the how line; the dock keeps
// only buttons. A title card's heading stands aside meanwhile (styles.css,
// .cs-stage.cs-headline) and comes back when the headline fades.
```

After `NARROW_PX`:

```ts
/** On the stage while a headline stands: a title card's heading stands aside (styles.css). */
const HEADLINE = "cs-headline";
const HEAD_FADE_MS = 300;

/** The question over the figure (round 7 §8.1) and how to answer it. */
export interface GateHead {
  /** The ask's question, its {vars} filled ("" — no headline: test me). */
  question: string;
  /** The gate's hint: small, under the question; the gate keeps it live. */
  how: HTMLElement;
}

/**
 * Mount the headline on the STAGE (a gate is removed at once when it
 * finishes; the headline fades out after it). Null for no question.
 */
export function mountGateHead(stage: HTMLElement, head: GateHead): { relayout(): void; dispose(): void } | null {
  // A headline still fading from the last question goes at once.
  stage.querySelector(".cs-gatehead")?.remove();
  if (head.question.trim() === "") return null;
  head.how.classList.remove("cs-waitgate-pill");
  head.how.classList.add("cs-gatehead-how");
  const el = h("div", { class: "cs-gatehead" }, h("div", { class: "cs-gatehead-q", title: head.question }, head.question), head.how);
  stage.appendChild(el);
  stage.classList.add(HEADLINE);
  let gone = false;
  const relayout = (): void => {
    if (gone) return;
    // Under the drawing's own top edge (below / strip move the drawing; overlay letterboxes it).
    const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
    const top = svg ? svg.getBoundingClientRect().top - stage.getBoundingClientRect().top : 0;
    el.style.top = `${Math.max(0, top) + 6}px`;
  };
  relayout();
  return {
    relayout,
    dispose: () => {
      if (gone) return;
      gone = true;
      stage.classList.remove(HEADLINE);
      el.classList.add("cs-gatehead-out");
      setTimeout(() => el.remove(), HEAD_FADE_MS);
    },
  };
}
```

`mountGateDock` becomes `export function mountGateDock(stage: HTMLElement, gate: HTMLElement, items: HTMLElement[], onLayout: () => void, head?: GateHead): GateDock {` and its first line:

```ts
  const top = head ? mountGateHead(stage, head) : null;
  // No headline (no question): the how line stays in the dock, first.
  const el = h("div", { class: "cs-gatedock" }, ...(head && !top ? [head.how, ...items] : items));
```

In `relayout`, before `onLayout();`: `top?.relayout();`. In `dispose`, after `disposed = true;`: `top?.dispose();`.

- [ ] **Step 4: The five docked gates**

`src/ui/guess-gate.ts` (lines 312-326):

```ts
      // The bar (round 7 §8.3): Skip, then Answer; the hint is the how line under the question (§8.1).
      const docked: HTMLElement[] = [answer];
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", type: "button" }, words.skip);
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          finish(null);
        });
        docked.unshift(skip);
      }
```

and `dock = mountGateDock(stage, gate, docked, placePill, { question: step.question, how: hint });`.

`src/ui/cards-gate.ts`: `const docked: HTMLElement[] = [answer];` (line 103); in the Skip block `docked.push(skip);` → `docked.unshift(skip);`; the mount: `dock = mountGateDock(stage, gate, docked, () => placeRing(), { question: step.question, how: hint });`.

`src/ui/formula-gate.ts`: line 67 `const docked: HTMLElement[] = [answer];`; line 340 `docked.unshift(skip);`; line 346 `dock = mountGateDock(stage, gate, docked, placeRings, { question: step.question, how: hint });`.

`src/ui/tree-gate.ts`: line 87 `const docked: HTMLElement[] = [answer];`; line 332 `docked.unshift(skip);`; line 338 `dock = mountGateDock(stage, gate, docked, placeRings, { question: step.question, how: hint });`.

`src/ui/choose-gate.ts`: line 70 `const docked: HTMLElement[] = [];`; line 195 `docked.unshift(skip);`; line 200 `dock = mountGateDock(stage, gate, docked, placeRing, { question: step.question, how: hint });`. (A pick removes the docked buttons and then stands down — `standDown` → `dock.dispose()` — which fades the headline.)

- [ ] **Step 5: The player fills the question's `{vars}`**

`src/render/player.ts`:
- line ~1778: `Object.assign({}, step, { question: this.line(step.question), guess: session })`
- line ~1987: `Object.assign({}, step, { question: this.line(step.question), cardsSession: { geometry: g, start, place, show, mark, fade } satisfies CardsSession })`
- line ~2237: `this.askGate!(signal, Object.assign({}, step, { question: this.line(step.question) }))`
- line ~2353: `Object.assign({}, step, { question: this.line(step.question), formulaSession: … })`
- line ~2578: `Object.assign({}, step, { question: this.line(step.question), treeSession: … })`

- [ ] **Step 6: CSS (src/styles.css)**

Delete the rule `.cs-guessgate .cs-figgate-hint { bottom: auto; top: 0.9rem; }` with its two-line comment (lines 1782-1787) and the rule `.cs-guessgate .cs-figgate-skip { bottom: auto; top: 0.8rem; right: 1rem; }` with its comment (lines 1928-1933). After the `.cs-gatedock > .cs-figgate-skip` rule (line 1846) add:

```css
/* The question over the figure while it is open (round 7 §8.1, ui/gate-dock.ts
   mountGateHead): the whole sentence, two lines at most, the how line small
   and muted under it. It stands where a title card's heading is — that
   heading stands aside meanwhile. Taps go through it to the figure. */
.cs-gatehead {
  position: absolute;
  left: 0;
  right: 0;
  top: 0.4rem;
  z-index: 6;
  padding-inline: 1rem;
  text-align: center;
  pointer-events: none;
  transition: opacity 0.3s ease;
}
.cs-gatehead.cs-gatehead-out { opacity: 0; }
.cs-gatehead-q {
  font-family: var(--sketch-font);
  font-size: 1.3rem;
  line-height: 1.2;
  color: var(--ink);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  text-shadow: 0 0 4px var(--paper, #f5f1e6), 0 0 8px var(--paper, #f5f1e6);
}
.cs-gatehead > .cs-figgate-hint {
  position: static;
  transform: none;
  display: block;
  margin-top: 0.15rem;
  padding: 0;
  font-size: 0.85rem;
  color: var(--muted);
  background: none;
  border: none;
  box-shadow: none;
  animation: none;
}
.cs-gatehead > .cs-figgate-hint.cs-figgate-next { animation: gatedock-next 0.45s ease-out; }
.cs-stage.cs-headline :is([data-leaf-id^="card_"][data-leaf-id$="_title"], [data-leaf-id^="card_"][data-leaf-id$="_line"]) {
  opacity: 0 !important;
  transition: opacity 0.3s ease;
}
@media (max-width: 560px) {
  .cs-gatehead-q { font-size: 1.05rem; }
  .cs-gatehead > .cs-figgate-hint { font-size: var(--text-xs); }
}
```

- [ ] **Step 7: Run the gate tests**

Run: `npx vitest run tests/gate-headline.test.ts tests/cards-gate-tap.test.ts tests/guess-account-gate.test.ts tests/guess-gate-field.test.ts tests/choose-gate.test.ts tests/gates.test.ts tests/gate-layout.test.ts tests/cursor.test.ts tests/bigplay.test.ts tests/choose-player.test.ts tests/formula-player.test.ts tests/tree-ask-player.test.ts`
Expected: PASS (the hint is still found by its class `cs-figgate-hint`, now under the stage's headline). `npx tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add src/ui/gate-dock.ts src/ui/guess-gate.ts src/ui/cards-gate.ts src/ui/formula-gate.ts src/ui/tree-gate.ts src/ui/choose-gate.ts src/render/player.ts src/styles.css tests/gate-headline.test.ts
git commit -m "Round 7: the question as a headline over the figure; the how line under it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

---

### Task 11: One family for the bottom bar; drag and connect join the headline (spec §8.3, build order 7)

**Files:**
- Modify: `src/ui/gate-words.ts` — `GateWords.connect` (EN/NB)
- Modify: `src/ui/connect-gate.ts:126-146, 256-271, 434-447` — words, headline, bar order Skip · status · Done
- Modify: `src/ui/drag-gate.ts:41-62, 129` — headline
- Modify: `src/render/player.ts:3721` — the generic gate call fills the question's `{vars}`
- Modify: `src/styles.css` — the pill family (after the rules added in Task 10), phone rule (line ~1908), `.cs-connect-hint` (line 2101)
- Modify: `tests/connect-gate.test.ts:175-178, 301-317`
- Test: `tests/gate-bar.test.ts` (new)

**Interfaces:**
- Consumes: `mountGateHead`, `GateHead` (Task 10); `words.done` (Task 5).
- Produces: `GateWords.connect: string` (EN "Press a star and drag to the next. Click a line to remove it", NB "Trykk på en stjerne og dra til den neste. Klikk på en linje for å fjerne den"); every bar button — `.cs-gatedock > .cs-guess-answer`, `.cs-gatedock > .cs-figgate-skip`, `.cs-connect-bar > .cs-cardgate-pill`, `.cs-draggate > .cs-figgate-skip` — one pill family.

- [ ] **Step 1: Write the failing tests**

Create `tests/gate-bar.test.ts`:

```ts
// One family for the bottom bar (round 7 §8.3): Skip and Answer (or Done) are
// pills of one shape, font, height and border — Answer filled in the guess
// blue, Skip muted — with no shadow and no pulse, on every gate that docks.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { gateWords } from "../src/ui/gate-words";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const rule = (sel: RegExp) => sel.exec(css)?.[1] ?? "";

describe("the bar's pills", () => {
  test("one shape, font and border for Answer, Skip and Done, with no shadow or pulse", () => {
    const family = rule(/\.cs-gatedock > \.cs-guess-answer,\s*\.cs-gatedock > \.cs-figgate-skip,\s*\.cs-connect-bar > \.cs-cardgate-pill,\s*\.cs-draggate > \.cs-figgate-skip\s*\{([^}]*)\}/);
    expect(family).toMatch(/border-radius:\s*999px/);
    expect(family).toMatch(/font-family:\s*var\(--sketch-font\)/);
    expect(family).toMatch(/border-style:\s*solid/);
    expect(family).toMatch(/box-shadow:\s*none/);
    expect(family).toMatch(/animation:\s*none/);
  });
  test("Answer and Done filled in the guess blue; Skip muted", () => {
    expect(rule(/\.cs-gatedock > \.cs-guess-answer,\s*\.cs-connect-bar > \.cs-cardgate-pill\.ok\s*\{([^}]*)\}/)).toMatch(/background:\s*#3f6fb5/);
    expect(rule(/\.cs-gatedock > \.cs-figgate-skip,\s*\.cs-connect-bar > \.cs-cardgate-pill\.skip,\s*\.cs-draggate > \.cs-figgate-skip\s*\{([^}]*)\}/)).toMatch(/color:\s*var\(--muted\)/);
  });
  test("connect's hint no longer pulses", () => {
    expect(rule(/\.cs-connect-hint\s*\{([^}]*)\}/)).toMatch(/animation:\s*none/);
  });
});

test("connect's words in both tongues (no English left in the gate)", () => {
  expect(gateWords("en").connect).toMatch(/Press a star and drag to the next/);
  expect(gateWords("nb").connect).toMatch(/Trykk på en stjerne/);
  const src = readFileSync(new URL("../src/ui/connect-gate.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/"Done ▸"/);
  expect(src).toMatch(/mountGateHead\(/);
  expect(readFileSync(new URL("../src/ui/drag-gate.ts", import.meta.url), "utf8")).toMatch(/mountGateHead\(/);
});
```

`tests/connect-gate.test.ts`: the test "tells the viewer both halves of the gesture …" (line 175) becomes:

```ts
  it("tells the viewer both halves of the gesture, like every other figgate's hint", () => {
    expect(source).toMatch(/cs-connect-hint/);
    expect(gateWords("en").connect).toMatch(/Press a star and drag to the next/);
    expect(gateWords("en").connect).toMatch(/[Cc]lick a line to remove it/);
  });
```

(import `gateWords` from `../src/ui/gate-words`), and in the CSS test (line 301) the title becomes "the hint stands still (round 7 §8.3), and the counter and summary — via disjoint selectors, not a specificity fight" and its last assertion `expect(hintRule).toMatch(/animation:\s*none/);`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/gate-bar.test.ts tests/connect-gate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Words**

`src/ui/gate-words.ts`: `GateWords` gets `/** connect: press a star and drag; a click on a line removes it. */ connect: string;`; EN `connect: "Press a star and drag to the next. Click a line to remove it",`; NB `connect: "Trykk på en stjerne og dra til den neste. Klikk på en linje for å fjerne den",`.

- [ ] **Step 4: Connect**

`src/ui/connect-gate.ts` — `words` is `gateWords(gateLangOf(hd))` (add `const words = gateWords(gateLangOf(hd));` at the top of the promise body if the gate has none). The hint and Done:

```ts
      const hint = h("span", { class: "cs-waitgate-pill cs-connect-hint" }, words.connect);
```
```ts
      const doneBtn = h("button", { class: "cs-cardgate-pill ok" }, words.done);
```

The status stack and the bar (Skip is inserted first later):

```ts
      const status = h("div", { class: "cs-connect-status" }, counter, summary);
      const bar = h("div", { class: "cs-connect-bar" }, status, doneBtn);
      /** The question over the figure, the hint its how line (round 7 §8.1). */
      let head: ReturnType<typeof mountGateHead> = null;
```

Where Skip is added (line ~442) `bar.appendChild(skip);` becomes `bar.insertBefore(skip, status);`. After `stage.appendChild(gate);` (line ~447):

```ts
      head = mountGateHead(stage, { question: step.question, how: hint });
      // No question: the hint stays in the status stack, over the counter.
      if (!head) status.insertBefore(hint, summary);
```

and in `remove` (line ~256) add `head?.dispose();` first. Import `mountGateHead` from `./gate-dock`.

- [ ] **Step 5: Drag**

`src/ui/drag-gate.ts`: the gate no longer holds the hint at first —

```ts
      const gate = h("div", { class: "cs-figgate cs-draggate" }, tray, summary);
      /** The question over the figure, the hint its how line (round 7 §8.1). */
      let head: ReturnType<typeof mountGateHead> = null;
```

In `remove` add `head?.dispose();` first; in `finish`, after `hint.remove();` add `head?.dispose();`. After the gate is appended to the stage:

```ts
      head = mountGateHead(stage, { question: step.question, how: hint });
      if (!head) gate.appendChild(hint);
```

Import `mountGateHead` from `./gate-dock`.

`src/render/player.ts:3721` (the generic gate — drag, connect, click, typed asks): `const t = await this.askGate!(signal, Object.assign({}, step, { question: this.line(step.question) }));`.

- [ ] **Step 6: CSS**

After the headline rules (Task 10) add:

```css
/* One family for the bottom bar (round 7 §8.3): Skip and Answer (or Done)
   are pills of one shape, font, height and border, side by side — Skip on
   the left, Answer on the right, filled. No shadow, no pulse: the headline
   is what draws the eye. */
.cs-gatedock > .cs-guess-answer,
.cs-gatedock > .cs-figgate-skip,
.cs-connect-bar > .cs-cardgate-pill,
.cs-draggate > .cs-figgate-skip {
  font-family: var(--sketch-font);
  font-size: 1.05rem;
  line-height: 1.2;
  min-height: 36px;
  padding: 0.3rem 1.1rem;
  border-width: 1.5px;
  border-style: solid;
  border-radius: 999px;
  box-shadow: none;
  animation: none;
  align-self: center;
}
.cs-gatedock > .cs-guess-answer,
.cs-connect-bar > .cs-cardgate-pill.ok {
  padding-inline: 1.6rem;
  color: #fff;
  background: #3f6fb5;
  border-color: #2f5590;
}
.cs-gatedock > .cs-figgate-skip,
.cs-connect-bar > .cs-cardgate-pill.skip,
.cs-draggate > .cs-figgate-skip {
  color: var(--muted);
  background: var(--surface);
  border-color: var(--muted);
}
```

In the phone block (line ~1908) replace the two lines `.cs-gatedock > .cs-guess-answer { … }` and `.cs-gatedock > .cs-figgate-skip { min-height: 40px; }` with:

```css
  .cs-gatedock > .cs-guess-answer,
  .cs-gatedock > .cs-figgate-skip,
  .cs-connect-bar > .cs-cardgate-pill,
  .cs-draggate > .cs-figgate-skip { min-height: 40px; }
```

and `.cs-connect-hint { animation: waitgate-nudge 1.6s ease-in-out infinite; }` (line 2101) becomes `.cs-connect-hint { animation: none; }` with its comment changed to say the hint stands still (round 7 §8.3).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/gate-bar.test.ts tests/connect-gate.test.ts tests/gate-headline.test.ts tests/cards-gate-tap.test.ts tests/guess-account-gate.test.ts tests/guess-gate-field.test.ts tests/choose-gate.test.ts tests/gates.test.ts tests/cursor.test.ts tests/ask-player.test.ts`
Expected: PASS. `npx tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add src/ui/gate-words.ts src/ui/connect-gate.ts src/ui/drag-gate.ts src/render/player.ts src/styles.css tests/gate-bar.test.ts tests/connect-gate.test.ts
git commit -m "Round 7: one pill family for the bottom bar; drag and connect take the headline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

---

### Task 12: Lint — the question says the whole task; no arrows under `check: "each"` (spec §3.6, §8.1, §8.2)

**Files:**
- Create: `src/lint/ask-lint.ts`
- Modify: `src/lint/lint.ts` — rule union (line ~178) `"ask-question"`, `"cards-check"`; `lintCommands` (line 1743) adds `...lintAsks(spec)`
- Modify: `tests/cards-faster-sort.test.ts:188-200` (lengthen "Which?")
- Modify: `src/examples.json` — the figure questions and wrong lines the new rules flag (indices 361, 366, 387, 388)
- Test: `tests/round7-lint.test.ts` (new)

**Interfaces:**
- Consumes: `authoredCards`, `cardsMode`, `CardsElementLike` (`src/spec/cards.ts`); `LintIssue` (type, `src/lint/lint.ts`).
- Produces: `export function lintAsks(spec: Spec): LintIssue[]`; `QUESTION_MIN_WORDS = 6`; `HEADLINE_MAX_CHARS = 110`; rules `"ask-question"` (under 6 words, an instruction with no object, or longer than the headline holds) and `"cards-check"` (a sort/select/deck under `"each"` whose `right`/`wrong` mentions arrows or marks, English and Norwegian).

- [ ] **Step 1: Write the failing test**

Create `tests/round7-lint.test.ts`:

```ts
// Round 7 lint: a figure question says its whole task (it stands over the
// figure as the headline), and a sort judged card by card has no arrows or
// marks for its wrong line to point at.
import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { expandSpec } from "../src/spec/expand";
import type { Spec } from "../src/spec/types";

const zoo = { id: "zoo", type: "cards", select: "Mammals", items: [{ text: "Whale", in: true }, { text: "Shark" }, { text: "Bat", in: true }] };
const cast = (ask: object, el: object = zoo) => ({ elements: [el], commands: [{ draw: ["zoo"] }, { ask: { on: "zoo", store: "m", ...ask } }] }) as unknown as Spec;
const rule = (spec: Spec, r: string) => lintCommands(spec).filter((i) => i.rule === r);
const FULL = "Which of these animals are mammals? Tap every mammal.";

describe("the question says the whole task", () => {
  test("under six words warns", () => expect(rule(cast({ question: "Tap all the mammals." }), "ask-question")).toHaveLength(1));
  test("an instruction with no object warns, in English and Norwegian", () => {
    expect(rule(cast({ question: "Sort them." }), "ask-question")).toHaveLength(1);
    expect(rule(cast({ question: "Din tur." }), "ask-question")).toHaveLength(1);
  });
  test("a full sentence passes", () => expect(rule(cast({ question: FULL }), "ask-question")).toHaveLength(0));
  test("longer than the headline holds warns", () => {
    const long = `${FULL} ${"Think of how each one feeds its young and breathes, then tap it. ".repeat(2)}`;
    expect(rule(cast({ question: long }), "ask-question")).toHaveLength(1);
  });
  test("a typed question or a quiz is not a figure question", () => {
    const spec = { elements: [], commands: [{ ask: { question: "Name?", answer: "x" } }] } as unknown as Spec;
    expect(rule(spec, "ask-question")).toHaveLength(0);
  });
});

describe("no arrows under check: each", () => {
  test("arrows or marks in the wrong line warn — raw and expanded", () => {
    const spec = cast({ question: FULL, wrong: "You got {m}. The arrows show where the rest belong." });
    expect(rule(spec, "cards-check")).toHaveLength(1);
    expect(rule(expandSpec(spec), "cards-check")).toHaveLength(1);
    expect(rule(cast({ question: FULL, wrong: "{m} right. The marks show where the rest belong." }), "cards-check")).toHaveLength(1);
    expect(rule(cast({ question: FULL, wrong: "Pilene viser hvor resten hører hjemme." }), "cards-check")).toHaveLength(1);
  });
  test("the score passes; check: end keeps its arrows", () => {
    expect(rule(cast({ question: FULL, wrong: "{m} of {m.total} on the first try." }), "cards-check")).toHaveLength(0);
    expect(rule(cast({ question: FULL, wrong: "The arrows show where the rest belong." }, { ...zoo, check: "end" }), "cards-check")).toHaveLength(0);
  });
});
```

Run: `npx vitest run tests/round7-lint.test.ts` — Expected: FAIL (no such rules).

- [ ] **Step 2: The lint module**

Create `src/lint/ask-lint.ts`:

```ts
// What a figure question says (round 7 §8.1, §8.2, §3.6): its question
// stands over the figure as the headline, so it is a full sentence naming
// the task and what counts as right — read without the narration, in two
// lines at most. And a sort judged card by card leaves no arrows or marks
// for its wrong line to point at.

import { authoredCards, cardsMode, type CardsElementLike } from "../spec/cards";
import type { Spec } from "../spec/types";
import type { LintIssue } from "./lint";

/** Under this many words a figure question cannot say its whole task. */
export const QUESTION_MIN_WORDS = 6;
/** About two lines of the headline (1.3 rem across the figure). */
export const HEADLINE_MAX_CHARS = 110;

/** An instruction with no object: "Sort them.", "Your turn.", "Sorter dem.", "Din tur." */
const INSTRUCTION_ONLY = /^((now\s+)?(sort|order|rank|match|place|drag|tap|try|sorter|ranger|plasser|dra|trykk på|prøv)\s+(them|it|these|this|dem|det|disse)(\s+(now|again|nå|igjen))?|your turn|din tur)[.!]?$/i;
/** "The arrows show …", "The marks show …", "Pilene viser …", "Merkene viser …" */
const POINTS_AT = /\b(arrows?|marks?|pilene|pilen|merkene|merket)\b[^.]*\b(show|shows|point|points|viser|peker)\b/i;

export function lintAsks(spec: Spec): LintIssue[] {
  const issues: LintIssue[] = [];
  const cards = new Map<string, CardsElementLike>();
  for (const e of spec.elements ?? []) if (e.type === "cards") cards.set(e.id, e as unknown as CardsElementLike);
  for (const c of authoredCards(spec)) cards.set(c.id, c);
  (spec.commands ?? []).forEach((c, i) => {
    const ask = c.ask;
    if (!ask) return;
    const figure = ask.on !== undefined || ask.blanks !== undefined || ask.pick !== undefined || Array.isArray(ask.choose);
    if (!figure) return;
    const q = typeof ask.question === "string" ? ask.question.trim() : "";
    if (q !== "") {
      const words = q.split(/\s+/).length;
      if (INSTRUCTION_ONLY.test(q) || words < QUESTION_MIN_WORDS) {
        issues.push({ rule: "ask-question", ids: [], severity: "warn", message: `commands[${i}].ask question "${q}" ${words < QUESTION_MIN_WORDS ? `is ${words} words` : "is an instruction with no object"} — it stands over the figure as the headline: a full sentence that names the task and what counts as right ("Which of these animals are mammals? Tap every mammal.")` });
      } else if (q.length > HEADLINE_MAX_CHARS) {
        issues.push({ rule: "ask-question", ids: [], severity: "warn", message: `commands[${i}].ask question is ${q.length} characters — the headline over the figure shows about ${HEADLINE_MAX_CHARS} (two lines); the rest is cut: say it shorter` });
      }
    }
    const one = typeof ask.on === "string" ? ask.on : Array.isArray(ask.on) && ask.on.length === 1 ? ask.on[0] : null;
    const cs = one !== null ? cards.get(one) : undefined;
    if (!cs || cardsMode(cs) !== "sort" || cs.check === "end") return;
    const v = ask.store ?? "f";
    for (const key of ["wrong", "right"] as const) {
      const line = ask[key];
      if (typeof line === "string" && POINTS_AT.test(line)) {
        issues.push({ rule: "cards-check", ids: [cs.id], severity: "warn", message: `commands[${i}].ask ${key}: "${line}" — ${cs.id} checks each card as it is dropped and moves a wrong one to its right box: no arrows or marks are left. Give the score: "{${v}} of {${v}.total} on the first try."` });
      }
    }
  });
  return issues;
}
```

- [ ] **Step 3: Wire it**

`src/lint/lint.ts`: rule union, after `| "ask-stage"` (keep the `;` last):

```ts
    /** a figure question shorter than its task, an instruction alone, or longer than the headline (round 7 §8) — warns */
    | "ask-question"
    /** a sort judged on each drop whose right/wrong line points at arrows or marks (round 7 §3.6) — warns */
    | "cards-check";
```

Import `import { lintAsks } from "./ask-lint";` and append `...lintAsks(spec)` to the list in `lintCommands` (line 1743).

- [ ] **Step 4: Fixtures and the bundled examples the rules flag**

`tests/cards-faster-sort.test.ts` lines 189 and 196: `question: "Which?"` → `question: "Which of these germs is a virus, and which a bacterium?"`.

The examples (indices from `src/examples.json`; run from the repo root):

```bash
node -e '
const fs=require("fs");const p="src/examples.json";const e=JSON.parse(fs.readFileSync(p,"utf8"));
const ask=(i,k)=>e[i].spec.commands[k].ask;
ask(361,3).question="And in 1990, what share of the world'"'"'s people lived like that?";
ask(366,3).question="Two positive tests now: how likely is it that she has the disease?";
ask(387,2).wrong="{f} of {f.total} on the first try.";
ask(388,2).question="Which of these animals are mammals? Tap every mammal.";
ask(388,2).right="All {m.total} right.";
ask(388,2).wrong="{m} of {m.total} on the first try.";
fs.writeFileSync(p,JSON.stringify(e,null,2)+"\n")'
```

Then find any other flagged ask (bundled examples and their playlists):

Run: `npx vitest run tests/examples.test.ts tests/round5-prompt.test.ts tests/round6-prompt.test.ts tests/tree-ask-lint.test.ts tests/fewshots.test.ts`
For every example the "no command-level lint issue" case names, rewrite its question by hand as one full sentence naming the task, read from the speak lines around it (same node pattern as above), and re-run until green.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run tests/round7-lint.test.ts` → PASS. Then `npx vitest run` (the whole suite: other tests assert `lintCommands(...)` is empty on fixtures with short questions — lengthen those questions the same way) → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/lint/ask-lint.ts src/lint/lint.ts tests/round7-lint.test.ts tests/cards-faster-sort.test.ts src/examples.json
git commit -m "Round 7 lint: a figure question says its whole task; no arrows under check each

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

(add any other test fixture files Step 5 touched to the `git add`.)

---

### Task 13: Prompt guidance — check each, reorder, full-sentence questions, icons (spec §3.6, §8.2, §9)

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md` — lines 122, 123, 124, 134
- Modify: `src/spec/schema.ts:630` (cards description), `:645` (`select` description)
- Modify: `src/llm/tags.ts:323` (the `interactive` brief's icon line)
- Modify: `.claude/skills/drawcast/references/rule-card.md:239-258, 290-296`
- Modify: `tests/prompt-size.test.ts`; `tests/round5-prompt.test.ts` only if its parse of the feedback ask needs the new text
- Test: `tests/round5-prompt.test.ts`, `tests/round6-prompt.test.ts`, `tests/build-skill.test.ts`, `tests/prompt-size.test.ts`

**Interfaces:**
- Consumes: the field names built in Tasks 1-12 (`check`, `reveal_style: "reorder"`, `arrange`, `icons`, `bar_colors`, `{f.total}`).
- Produces: guidance text only.

- [ ] **Step 1: The compiler prompt (src/llm/prompts/compiler-v1.md)**

Line 122, replace

```
The cards are drawn shuffled: `draw: ["kill"]` first, then ask `on: "kill"`; the viewer drags or taps them, presses Answer, and each card gets ✓ or ✗ with the truth beside it.
```

with

```
The cards are drawn shuffled: `draw: ["kill"]` first, then ask `on: "kill"`. A rank: they drag the cards into order and press Answer, and the cards slide into the true order. A sort (deck and tap-all too) checks each card as it is dropped — ✓, or ✗ and the card moves to its right box — so `wrong` just gives the score and moves on ("{f} of {f.total} on the first try."), never "the arrows show…"; `"check": "end"` on the cards for a test-like question (sort everything, then Answer).
```

and replace

```
`{g}` already reads "3 of 5" (write "You got {g}", never "{g} of 5").
```

with

```
For a rank `{g}` already reads "3 of 5" (write "You got {g}", never "{g} of 5"); for a sort it is the count right on the first try, `{g.total}` the number of cards. The `question` stands over the figure as its headline while they answer: a full sentence that names the task and what counts as right ("Which of these animals are mammals? Tap every mammal.", not "Tap all the mammals.").
```

Line 123: `"question": "Which branch should she take?"` → `"question": "Which branch should she take, now that each one is weighed?"`; `"question": "Which tile finishes it?"` → `"question": "Which tile finishes the formula for the circle's area?"`.

Line 124 (the feedback example ask): `"question": "Sort them: drag each one into its box."` → `"question": "Sort each food the way a botanist would: fruit or not a fruit?"`; `"wrong": "{f} right. Here is where each belongs."` → `"wrong": "{f} of {f.total} on the first try."`.

Line 134 (icon bullet): replace

```
**A TEMPLATE figure may use icons too**, not only a freehand one: a bar chart whose categories carry faces (`of: "car"`, `of: "bicycle"`) reads faster than a text legend, and a label that names a thing may wear its emblem beside the word. Use one where a picture does work the word cannot — at most a handful, one per category (cards are the exception), never as decoration; a clean figure beats a decorated one.
```

with

```
**A TEMPLATE figure may use icons too**: a bar_chart takes `"icons": ["shark", "dog", …]`, one per bar, shown under each bar; a label that names a thing may wear its emblem beside the word. When a card, a node, a bar or a decorative picture names a concrete object or animal, give it an icon keyword; draw by hand only when no icon fits, or when the drawing itself explains something (a mechanism, a shape, a process).
```

(The strings "write only the KEYWORD" and `"icon_look": "picture"` stay — tests assert them.)

- [ ] **Step 2: Schema, brief, rule card**

`src/spec/schema.ts:630`, in the cards description replace `(they drag the cards, press Answer, and see ✓ or ✗ with the truth beside)` with `(rank: they drag the cards and press Answer, and the cards slide into the true order; sort: each card is judged as it is dropped, a wrong one moved to its right box — check: "end" waits for Answer)`. In the `select` description (line ~645) replace `The viewer taps cards in and out, then Answer.` with `The viewer taps the cards that belong (each judged as tapped), then Done.`

`src/llm/tags.ts:323`, replace

```
"Cards of concrete things (animals, foods, drugs) wear an `icon` each — a keyword of one or two words, shown as a picture; a thing with no clear icon of its own goes without one rather than a near miss. " +
```

with

```
"Cards, bars (a bar_chart's `icons`) and pictures of concrete things (animals, foods, drugs) wear an `icon` each — a keyword of one or two words, shown as a picture; a thing with no clear icon of its own goes without one rather than a near miss. A question on the figure is a full sentence naming the task (\"Which of these animals are mammals? Tap every mammal.\"); a sort checks each card as it is dropped, so its wrong line gives the score (\"{f} of {f.total} on the first try.\"). " +
```

`.claude/skills/drawcast/references/rule-card.md`: lines 247-248 (`The guess stays; the truth is drawn beside it (`reveal_style: "morph"` for the old glide).`) become

```
  The guess stays; the truth is drawn beside it (`reveal_style: "morph"`
  for the old glide). Rank cards slide into the true order (a faint
  "yours" row stays). A sort, deck or select checks each card as it is
  dropped and moves a wrong one to its right box: `wrong` gives the score
  ("{f} of {f.total} on the first try."); `check: "end"` for a test.
  Cards stand above their boxes (`arrange: "side"` / `"rise"` to change).
  The `question` is the headline over the figure: a full sentence naming
  the task ("Which of these animals are mammals? Tap every mammal.").
```

Line 257 (`- Cards: a concrete thing may wear an `icon` …`) becomes `- Cards, nodes and bars (bar_chart `icons: [...]`, one per bar): a concrete thing wears an `icon` (`match_icon` on a match partner); `look` paper (default) / flat / outline — the default is fine.` Line 290 (`- `icon` (`of`: keyword, `size`): a handful at most, one per category, reuse.`) becomes `- `icon` (`of`: keyword, `size`): when a card, node, bar or decorative picture names a concrete thing, give it an icon; draw by hand only when no icon fits or the drawing explains.`

- [ ] **Step 3: Re-pin and run**

Run: `npx vitest run tests/prompt-size.test.ts` and re-pin both baselines ("Re-pinned UP 2026-10-02 (round 7 Task 13, guidance): the cards sentence (rank slides, sort checks each drop, the score line, check end), the headline question rule, bar icons and the icon rule; the schema's cards and select clauses. +N. -> NNN."). Then:

Run: `npx vitest run tests/prompt-size.test.ts tests/round5-prompt.test.ts tests/round6-prompt.test.ts tests/build-skill.test.ts tests/formula-prompt.test.ts tests/fewshots.test.ts`
Expected: PASS (if `round5-prompt` parses the feedback ask by its old question text, update its anchor to the new question). `npm run build:skill` succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/llm/prompts/compiler-v1.md src/spec/schema.ts src/llm/tags.ts .claude/skills/drawcast/references/rule-card.md tests/prompt-size.test.ts
git commit -m "Round 7 guidance: check each, rank reorder, full-sentence questions, icons on bars

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

(add `tests/round5-prompt.test.ts` if Step 3 changed it.)

---

### Task 14: Content — the examples' icons and lines; the decision-mistakes course (spec §9)

**Files:**
- Modify: `src/examples.json` — 364 "Virus or bacterium", 384 "Is it a fruit?", 386 "The deadliest animal", 387 "Fruit or not? — a quick deck"
- Modify: `src/scenes/icon-cache.json` (rebuilt by `npm run icons`)
- Not in git: `dev-casts/courses/decision-mistakes/*.yaml` (revised by hand, linted, not committed)

**Interfaces:**
- Consumes: bar_chart `icons` (Task 9), `{f.total}` (Task 3), the lints (Task 12).

- [ ] **Step 1: The lines**

```bash
node -e '
const fs=require("fs");const p="src/examples.json";const e=JSON.parse(fs.readFileSync(p,"utf8"));
const ask=(i,k)=>e[i].spec.commands[k].ask;
ask(364,1).question="Which of these diseases is caused by a virus, and which by a bacterium?";
ask(364,1).wrong="{s} of {s.total} on the first try.";
ask(384,2).question="Sort each food the way a botanist would: fruit or not a fruit?";
ask(384,2).wrong="{f} of {f.total} on the first try.";
ask(386,16).right="{k} of {k.total}. Snakes, crocodiles and hippos attack; mosquitoes and dogs pass on disease.";
ask(386,16).wrong="{k} of {k.total} on the first try. Dogs kill mostly through rabies, a virus passed in the bite.";
ask(387,2).question="Sort each food the way a botanist would: is it a fruit or not?";
fs.writeFileSync(p,JSON.stringify(e,null,2)+"\n")'
```

(Check the indices first: `node -e 'const e=require("./src/examples.json");for(const i of [364,384,386,387])console.log(i,e[i].spec.title)'` must print "Virus or bacterium", "Is it a fruit?", "The deadliest animal", "Fruit or not? — a quick deck".)

- [ ] **Step 2: The icons**

"The deadliest animal" (386): `params.icons` one per label `["Shark","Hippo","Crocodile","Dog","Snake","Human","Mosquito"]`:

```bash
node -e '
const fs=require("fs");const p="src/examples.json";const e=JSON.parse(fs.readFileSync(p,"utf8"));
e[386].spec.params.icons=["shark","hippopotamus","crocodile","dog","snake","person standing","mosquito"];
const food=e[387].spec.elements.find(x=>x.id==="food");
const kw={Pumpkin:"pumpkin",Avocado:"avocado",Eggplant:"eggplant",Zucchini:"zucchini",Olive:"olive","Bell pepper":"bell pepper","Pea pod":"pea pod",Celery:"celery",Rhubarb:"rhubarb",Lettuce:"leafy green",Onion:"onion",Ginger:"ginger root",Asparagus:"asparagus",Cauliflower:"cauliflower"};
for(const it of food.items) it.icon=kw[it.text];
fs.writeFileSync(p,JSON.stringify(e,null,2)+"\n")'
npm run icons
```

`npm run icons` (network) prints the keywords it could not resolve. For each one not resolved, and for each resolved picture that is a near miss when seen (Task 15 checks them in the browser — a jack-o'-lantern for "pumpkin", a cucumber for "zucchini"), remove that keyword: a card item loses its `icon`; a bar's entry becomes `null`. Re-run `npm run icons` after removing. Note in the commit message which items have no icon.

- [ ] **Step 3: Run the example tests**

Run: `npx vitest run tests/examples.test.ts tests/icon-stale.test.ts tests/cards-look.test.ts tests/round6-prompt.test.ts tests/example-icon-colour.test.ts tests/cards-faster-sort.test.ts tests/bar-icons.test.ts`
Expected: PASS — no lint issue, no layout warning (a missing keyword would warn by name), the deck's text fits its cards with icons (`deck-text`), the deadliest animal's icon row clears its chart (it animates `box: "left"` and back).

- [ ] **Step 4: The decision-mistakes course (not in git)**

In `dev-casts/courses/decision-mistakes/`, one lecture at a time (the revision loop: a small fix, check, next):
- Illustrating icon elements get `icon_look: picture`: 02 p1 `maya`, `cow`, `paper` (the hand-drawn newspaper); 02 p2 `maya`, `tube`, `steth`; 02 p3 `linda`, `linda2`; 02 p4 `tag`, `hand`, `tip`; 03 p1 `cash`, `coin`; 03 p3 `coin`; 03 p4 `cash2`; 04 p1 `ap…`, `mPl_i`, `mDo_i`, `pro_i`, `con_i`; 04 p2 `maya_i`; 04 p3 `mug`, `gS_i`, `gB_i`, `gC_i`, `book_i`, `bike_i`, `phone_i`; 04 p4 `fd1`, `fd2`, `fd3`; 05 p2 `linda_icon`; 05 p4 `plate`.
- Decorative drawings an icon replaces: 02 p1 `fin` → an icon `shark` (keep its draw/highlight/erase beats on the new id), the bars bar1–4 (bees/wasps, dogs, snakes, sharks) each gain an icon beside its label (`honeybee`, `dog`, `snake`, `shark`); 05 p3 nodes `news` → icon `newspaper`, `heard` → `ear`, `size` → `cityscape`. Keep the drawings that explain (the wheel, data paths, the timeline, the Venn ellipses).
- Figure questions the lint flags (01 p1 "Pick a door: tap it.", "Stay or switch?", 01 p3 "Which branch should Maya take?", 03 p2, 03 p3, 03 p4, 05 p1): one full sentence each, naming the task. Sort wrong lines that point at a reveal (01 p4 "Here is where each one belongs."): the score form.
- Lint each lecture: `node scripts/cast.mjs check dev-casts/courses/decision-mistakes/0N-….yaml` — no warnings. Play each changed page muted (Task 15's checklist).

- [ ] **Step 5: Commit**

```bash
git add src/examples.json src/scenes/icon-cache.json
git commit -m "Round 7 content: icons under the deadliest animal's bars and on the fruit deck; score lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp"
```

---

### Task 15: Muted browser check of every changed example (spec §11)

**Files:**
- Modify (only for fixes found): the files the failing check points at — each fix its own small commit with its own test where one can be written.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Start the app and mute it**

Run `npm run dev` (in the background) and open the printed local URL in the browser tool. After EVERY page load or reload, before pressing Play, run this in the page (narration and WebAudio both — the player's mute covers narration only):

```js
(() => {
  window.speechSynthesis && (window.speechSynthesis.speak = () => {});
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { this.muted = true; return play.call(this); };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (d, ...r) { return d instanceof AudioDestinationNode ? d : connect.call(this, d, ...r); };
  return "muted";
})();
```

Confirm it returned "muted" before every Play. Take screenshots at desktop width (1280) and phone width (390) for each item below; compare against `main` where noted (before/after).

- [ ] **Step 2: Sort, deck, select (check: each)**

Open each of "Is it a fruit?", "Virus or bacterium", "Fruit or not? — a quick deck", "Which of these are mammals?", and "The deadliest animal" (its sort `kind`). For each:
- [ ] the cards stand above the boxes (drop); nothing overlaps the boxes' titles or the counter; on the deadliest animal the sort sits clear of the chart (if not: `arrange: "rise"` on `kind`, or move it, and re-run Task 7's example check);
- [ ] the first tray card shows the ring; one tap on a box sends it; a tap on another tray card picks that one; a drag still works;
- [ ] a right drop: green ✓ beside it, the card stays at full strength;
- [ ] a wrong drop: lands in the tapped box, red ✗, about half a second, glides (about 0.6 s) to its right box and stays faded; no red is left on the figure;
- [ ] two quick wrong drops in a row both end in their right boxes;
- [ ] the counter `✓ n · ✗ m` under the boxes ticks on each drop, its numbers right;
- [ ] a placed card ignores taps and drags;
- [ ] no Answer button (sort, deck); the select shows Done, and Done sweeps the missed cards in one by one (faded, counted ✗);
- [ ] the last card answers by itself after its glide; the right/wrong line reads "{f} of {f.total} on the first try" sensibly;
- [ ] at the next command the counter and the faded cards fade further; a seek forward past the ask shows the final state; a seek back before it clears it;
- [ ] a movie run (questions off): the cards go to their boxes one by one, no counter, nothing faded;
- [ ] the deck: the dealt card stands over the boxes and flies down into them.

- [ ] **Step 3: Rank (reorder)**

Open "What kills us", "How fast can they run?" and "The deadliest animal" (its rank): answer with some cards wrong.
- [ ] ✓/✗ on each card for about 0.8 s; the "yours" row appears just above the row (left of a column), wrong cards only, with the word "yours";
- [ ] the cards slide into the true order, rightward ones above the row, leftward below, none through another;
- [ ] after landing: blue connectors from the labels, ✓ on the cards that never moved, no ✗; the ends (most/least) unmoved;
- [ ] the row and connectors fade at the next command; seek forward restores, seek back clears;
- [ ] a movie: the same slide from the shuffle, no row.

- [ ] **Step 4: Bars**

- [ ] "The deadliest animal": an icon under each bar (pictures), labels under the icons, the y caption and the x row clear; drawn bar by bar, each icon with its bar; the bar guess (mosquito) and its beside reveal read clearly (yours blue beside the bar's own colour); `box: "left"` and back keep the icons with their bars;
- [ ] a name-labelled chart ("Did Norway get poorer?" and the other name examples) shows a colour per bar; a year- or number-labelled chart one colour; series charts unchanged.

- [ ] **Step 5: The headline and the bar, every gate kind**

For one example of each — cards (any of the above), guess (the deadliest animal's bar guess, "Extreme poverty"), choose (the deadliest animal's choose, or the course's door), drag, formula ("What number goes in the box?" or a formula-tile example), tree ("So which does the square choose?"), connect:
- [ ] the question stands at the top as a headline (two lines at most, ellipsis beyond), the how line small under it; a title card's heading is hidden meanwhile and comes back when the question is answered;
- [ ] the bottom bar holds only Skip (left) and Answer/Done (right), one pill family, Answer filled blue, no shadow, no pulse; Skip alone centred where there is no Answer;
- [ ] phone width (390): the headline wraps, buttons at least 40 px tall, nothing covers the cards or the plot's top beyond the heading strip;
- [ ] a Norwegian cast (any bundled cast with `lang: nb`, or set `lang: nb` on a copy): Ferdig, the Norwegian hints, "din" on the rank row.

- [ ] **Step 6: Record and fix**

For each failed check: fix in the smallest place, add a test where the failure is testable (a fake-DOM gate test or a pure geometry test), run `npx vitest run` and `npx tsc --noEmit`, commit with the trailer lines. When everything passes, run the whole suite one last time:

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green.
