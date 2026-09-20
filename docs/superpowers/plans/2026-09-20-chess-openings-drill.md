# Drill Openings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third activity pill to the chess board — **Drill openings** — that names you an opening and a side, has you play the line, corrects you strictly, and moves on to another, weighted toward the ones you keep missing.

**Architecture:** No new template and no change to the board. `src/ui/quiz-model.ts` already holds an activity registry and `src/ui/tray.ts` already renders and routes it; a new drill is one registry entry plus a mount function modelled on `src/ui/chessvs.ts`. The openings set comes from `params.openings` — inline rows or `"@name"`, resolved by the data-assets round before anything reads params — falling back to a built-in dozen.

**Tech Stack:** TypeScript, Vite, vitest, chess.js (lazily imported).

**Spec:** `docs/superpowers/specs/2026-09-20-chess-openings-drill-design.md` — read it first, especially §2 (why there is no new template), §7 (why the miss history needs its own store) and §9 (the failure rule).

## Global Constraints

- **Netlify runs `npm test && npm run build`.** `npm run build` type-checks with `tsc`, and `tests/` is inside tsconfig's include, so a test that does not compile fails the build even when vitest is green. Both must pass before any commit.
- **Nothing here may ever throw into playback.** The drill takes clicks while a cast is paused. Every failure degrades to a drill that runs with less: a bad row is dropped, a dead `localStorage` means unweighted random, an unusable set falls back to the built-in.
- **A custom set is validated ONCE when the session opens, never per move.** chess.js throws on an illegal SAN; that is a warning in a layout and a crash at click time.
- **`src/ui/chessvs.ts` is the shape to copy** — overlay, teardown, hit-testing, painting. Do not invent a second convention for any of it.
- **Do not touch `src/scenes/packs/games.yaml`.** The board layout is not part of this work. `tests/packs.test.ts` holds byte-level hash pins on nine chess renders; if any of them moves, something has gone wrong.
- Run the FULL suite (`npm test`) at the end of every task.

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/chess-openings.ts` | NEW. The `Opening` type, the built-in set, SAN canonicalisation + validation, and the prefix matcher. Pure: no DOM, no registry, no `localStorage`. |
| `src/ui/chess-openings-store.ts` | NEW. The miss history and weighted pick. Pure logic plus a guarded `localStorage` read/write. Separate from the above because it is the only part that touches storage, and storage is the part that can throw. |
| `src/ui/chessdrill.ts` | NEW. The session mount. DOM; modelled line by line on `chessvs.ts`. |
| `src/ui/quiz-model.ts` | One more entry in the chess block of `activitiesFor`. |
| `src/ui/tray.ts` | Route the new pill id. |
| `tests/chess-openings.test.ts` | NEW. Tasks 1 and 2. |
| `tests/chess-drill-wiring.test.ts` | NEW. Task 4. |

---

### Task 1: The set, its validation, and the prefix matcher

Spec §4, §5, §6, §9. All pure — this is the task with the real test surface.

**Files:**
- Create: `src/ui/chess-openings.ts`
- Test: `tests/chess-openings.test.ts`

**Interfaces:**
- Consumes: `ChessCtor` from `./chessplay-model` (already exported: `new (fen?, opts?) => ChessLike`).
- Produces:
  - `export interface Opening { name: string; eco?: string; side: "white" | "black"; moves: string[]; idea?: string }`
  - `export const BUILT_IN_OPENINGS: readonly Opening[]`
  - `export function validateSet(Chess: ChessCtor, rows: unknown): { set: Opening[]; dropped: string[] }`
  - `export function matchingOpenings(set: readonly Opening[], prefix: readonly string[]): Opening[]`
  - `export function plyList(Chess: ChessCtor, o: Opening): { from: string; to: string; san: string }[]`

- [ ] **Step 1: Write the failing test**

Create `tests/chess-openings.test.ts`:

```ts
// The openings drill's pure half: the shipped set, what a custom set must
// survive, and the one prefix query the whole drill is built on.
import { describe, expect, test } from "vitest";
import { Chess } from "chess.js";
import { BUILT_IN_OPENINGS, matchingOpenings, plyList, validateSet, type Opening } from "../src/ui/chess-openings";
import type { ChessCtor } from "../src/ui/chessplay-model";

const Ctor = Chess as unknown as ChessCtor;

describe("the built-in set", () => {
  // THE test of this task. Shipped data with a bad SAN would throw on a
  // viewer's machine at click time, and nothing else in the suite looks.
  test("every line is legal, replayed move by move through the engine", () => {
    for (const o of BUILT_IN_OPENINGS) {
      expect(() => plyList(Ctor, o), `${o.name}: ${o.moves.join(" ")}`).not.toThrow();
      expect(plyList(Ctor, o), o.name).toHaveLength(o.moves.length);
    }
  });

  test("is a dozen openings, 3-6 plies each, with both sides represented", () => {
    expect(BUILT_IN_OPENINGS.length).toBeGreaterThanOrEqual(10);
    for (const o of BUILT_IN_OPENINGS) {
      expect(o.moves.length, o.name).toBeGreaterThanOrEqual(3);
      expect(o.moves.length, o.name).toBeLessThanOrEqual(6);
    }
    expect(BUILT_IN_OPENINGS.some((o) => o.side === "white")).toBe(true);
    expect(BUILT_IN_OPENINGS.some((o) => o.side === "black")).toBe(true);
  });

  test("names are unique — the miss store keys on them", () => {
    const names = BUILT_IN_OPENINGS.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // The set earns its keep by its members being each other's likely mistakes:
  // playing Nc3 when you meant the Italian's Nf3 must land on a named opening.
  test("a plausible mistake lands on another opening in the set", () => {
    const italian = BUILT_IN_OPENINGS.find((o) => o.name === "Italian Game")!;
    const slip = [...italian.moves.slice(0, 2), "Nc3"]; // 1.e4 e5 2.Nc3
    const hit = matchingOpenings(BUILT_IN_OPENINGS, slip);
    expect(hit.map((o) => o.name)).toContain("Vienna Game");
  });
});

describe("matchingOpenings", () => {
  const set: Opening[] = [
    { name: "A", side: "white", moves: ["e4", "e5", "Nf3"] },
    { name: "B", side: "white", moves: ["e4", "e5", "Nc3"] },
    { name: "C", side: "black", moves: ["d4", "d5"] },
  ];

  test("an empty prefix matches everything", () => {
    expect(matchingOpenings(set, []).map((o) => o.name)).toEqual(["A", "B", "C"]);
  });

  test("an ambiguous prefix matches several", () => {
    expect(matchingOpenings(set, ["e4", "e5"]).map((o) => o.name)).toEqual(["A", "B"]);
  });

  test("a full line matches exactly its own", () => {
    expect(matchingOpenings(set, ["e4", "e5", "Nf3"]).map((o) => o.name)).toEqual(["A"]);
  });

  test("a prefix longer than any line matches nothing", () => {
    expect(matchingOpenings(set, ["e4", "e5", "Nf3", "Nc6"])).toEqual([]);
  });

  test("a prefix that diverges matches nothing", () => {
    expect(matchingOpenings(set, ["e4", "c5"])).toEqual([]);
  });
});

describe("validateSet", () => {
  test("keeps good rows and canonicalises their SAN to the engine's own spelling", () => {
    const { set, dropped } = validateSet(Ctor, [
      { name: "Vienna Game", side: "white", moves: ["e4", "e5", "Nc3"] },
    ]);
    expect(dropped).toEqual([]);
    expect(set[0].moves).toEqual(["e4", "e5", "Nc3"]);
  });

  test("drops a row with an illegal move and names it, rather than throwing", () => {
    const { set, dropped } = validateSet(Ctor, [
      { name: "Good", side: "white", moves: ["e4", "e5", "Nf3"] },
      { name: "Bad", side: "white", moves: ["e4", "e9"] },
    ]);
    expect(set.map((o) => o.name)).toEqual(["Good"]);
    expect(dropped).toEqual(["Bad"]);
  });

  test("drops rows that are not the right shape at all, without throwing", () => {
    const { set, dropped } = validateSet(Ctor, [
      null,
      { name: "No moves", side: "white" },
      { moves: ["e4"] },
      "nonsense",
      { name: "Fine", side: "white", moves: ["e4", "e5", "Nf3"] },
    ]);
    expect(set.map((o) => o.name)).toEqual(["Fine"]);
    expect(dropped.length).toBe(4);
  });

  test("defaults side to white, and keeps an explicit black", () => {
    const { set } = validateSet(Ctor, [
      { name: "X", moves: ["e4", "e5", "Nf3"] },
      { name: "Y", side: "black", moves: ["e4", "c5", "Nf3"] },
    ]);
    expect(set[0].side).toBe("white");
    expect(set[1].side).toBe("black");
  });

  test("a non-array, an empty array, and an array of junk all yield an empty set", () => {
    expect(validateSet(Ctor, undefined).set).toEqual([]);
    expect(validateSet(Ctor, []).set).toEqual([]);
    expect(validateSet(Ctor, [null, 3]).set).toEqual([]);
  });
});

describe("plyList", () => {
  test("gives from/to/san per ply, so judging never compares SAN strings", () => {
    const plies = plyList(Ctor, { name: "X", side: "white", moves: ["e4", "e5", "Nf3"] });
    expect(plies[0]).toMatchObject({ from: "e2", to: "e4", san: "e4" });
    expect(plies[2]).toMatchObject({ from: "g1", to: "f3", san: "Nf3" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/chess-openings.test.ts`
Expected: FAIL on the import — `src/ui/chess-openings.ts` does not exist.

- [ ] **Step 3: Write the module**

Create `src/ui/chess-openings.ts`:

```ts
// The openings drill's pure half (design 2026-09-20-chess-openings-drill §4-6,
// §9): the shipped set, what a custom set must survive to be used, and the one
// prefix query the whole drill is built on.
//
// Nothing here touches the DOM, the registry or localStorage. The drill takes
// clicks while a cast is paused, and "nothing may ever throw into playback"
// (the rule render/record.ts states for itself) — so validation happens ONCE,
// up front, and every bad row is dropped rather than raised.

import type { ChessCtor } from "./chessplay-model";

export interface Opening {
  name: string;
  /** Labelling only. Unverifiable by tests — see the design's §6. */
  eco?: string;
  /** Who the viewer drills as. NOT inferrable: the Sicilian is Black's
   *  opening but its line still begins 1. e4 c5. */
  side: "white" | "black";
  /** SAN, canonicalised to the engine's own spelling by validateSet. */
  moves: string[];
  idea?: string;
}

/**
 * The shipped set. Chosen so its members are each other's LIKELY CONFUSIONS —
 * the Vienna is here because it is what you play when you mean the Italian,
 * and that is what makes a wrong move nameable instead of merely wrong.
 *
 * The move lists are proved by the legality test in tests/chess-openings.test.ts.
 * The ECO codes are not, and cannot be — they are labelling, verified by hand
 * against a reference when this set was written.
 */
export const BUILT_IN_OPENINGS: readonly Opening[] = [
  { name: "Italian Game", eco: "C50", side: "white", moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"], idea: "The bishop eyes f7, Black's weakest square." },
  { name: "Ruy Lopez", eco: "C60", side: "white", moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"], idea: "Pressure on the knight that defends e5." },
  { name: "Scotch Game", eco: "C45", side: "white", moves: ["e4", "e5", "Nf3", "Nc6", "d4"], idea: "Open the centre at once, before Black is ready." },
  { name: "Vienna Game", eco: "C25", side: "white", moves: ["e4", "e5", "Nc3"], idea: "A quieter cousin of the Italian — develop first, commit later." },
  { name: "Queen's Gambit", eco: "D06", side: "white", moves: ["d4", "d5", "c4"], idea: "Offer a pawn to pull Black's centre off the d-file." },
  { name: "English Opening", eco: "A25", side: "white", moves: ["c4", "e5", "Nc3"], idea: "A Sicilian with colours reversed, and a move in hand." },
  { name: "Sicilian Defence", eco: "B50", side: "black", moves: ["e4", "c5", "Nf3", "d6"], idea: "Answer a king's-side opening with a queen's-side counter." },
  { name: "French Defence", eco: "C00", side: "black", moves: ["e4", "e6", "d4", "d5"], idea: "Challenge the centre immediately, and accept a cramped bishop." },
  { name: "Caro-Kann Defence", eco: "B10", side: "black", moves: ["e4", "c6", "d4", "d5"], idea: "The French's solid cousin, with the light bishop free." },
  { name: "Queen's Gambit Declined", eco: "D30", side: "black", moves: ["d4", "d5", "c4", "e6"], idea: "Hold the centre rather than take the pawn." },
  { name: "King's Indian Defence", eco: "E60", side: "black", moves: ["d4", "Nf6", "c4", "g6"], idea: "Give up the centre, then attack it from a distance." },
  { name: "Nimzo-Indian Defence", eco: "E20", side: "black", moves: ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"], idea: "Pin the knight that guards e4." },
];

/** Every ply of an opening as the engine sees it. Throws on an illegal line —
 *  which is why validateSet calls it behind a try, and the drill never does. */
export function plyList(Chess: ChessCtor, o: Opening): { from: string; to: string; san: string }[] {
  const game = new Chess() as unknown as {
    move(san: string): { from: string; to: string; san: string } | null;
  };
  const out: { from: string; to: string; san: string }[] = [];
  for (const san of o.moves) {
    const m = game.move(san);
    if (!m) throw new Error(`illegal move "${san}"`);
    out.push({ from: m.from, to: m.to, san: m.san });
  }
  return out;
}

/**
 * A set that is safe to drill: bad rows dropped and named, SAN canonicalised
 * to the engine's own spelling so judging never has to reconcile two
 * spellings of one move. Runs once when a session opens.
 */
export function validateSet(Chess: ChessCtor, rows: unknown): { set: Opening[]; dropped: string[] } {
  const set: Opening[] = [];
  const dropped: string[] = [];
  if (!Array.isArray(rows)) return { set, dropped };
  for (const [i, raw] of rows.entries()) {
    const row = raw as Partial<Opening> | null;
    const label = (row && typeof row === "object" && typeof row.name === "string" && row.name) || `row ${i + 1}`;
    if (!row || typeof row !== "object" || typeof row.name !== "string" || !Array.isArray(row.moves) || row.moves.length === 0) {
      dropped.push(label);
      continue;
    }
    const o: Opening = {
      name: row.name,
      ...(typeof row.eco === "string" ? { eco: row.eco } : {}),
      side: row.side === "black" ? "black" : "white",
      moves: row.moves.map(String),
      ...(typeof row.idea === "string" ? { idea: row.idea } : {}),
    };
    try {
      o.moves = plyList(Chess, o).map((p) => p.san);
    } catch {
      dropped.push(label);
      continue;
    }
    set.push(o);
  }
  return { set, dropped };
}

/**
 * THE query the drill is built on: which openings begin with this line?
 *
 * It judges a move (does the line so far still match what is being drilled),
 * names a wrong one (does it match some OTHER opening — "that's the Vienna"),
 * and classifies a free-play line. One function, three jobs.
 */
export function matchingOpenings(set: readonly Opening[], prefix: readonly string[]): Opening[] {
  return set.filter((o) => prefix.length <= o.moves.length && prefix.every((san, i) => o.moves[i] === san));
}
```

- [ ] **Step 4: Verify the ECO codes before you commit them**

The legality test proves the MOVES. Nothing proves the codes. Check each against a reference (Wikipedia's ECO tables or any opening database) and correct what does not match. If you cannot confirm one, DELETE that row's `eco` field rather than shipping a guess — the field is optional for exactly this reason. Say in your report which you changed.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/chess-openings.test.ts`
Expected: PASS, all of them.

- [ ] **Step 6: Full suite and tsc**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: green. `tests/packs.test.ts`'s chess hash pins must be untouched — nothing in this task goes near the board.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "The openings a drill can ask for, and what makes a set safe to drill"
```

---

### Task 2: The miss history and the weighted pick

Spec §7. Its own file because it is the only part that touches storage, and storage is the part that can throw.

**Files:**
- Create: `src/ui/chess-openings-store.ts`
- Modify: `tests/chess-openings.test.ts`

**Interfaces:**
- Consumes: `Opening` from `./chess-openings`.
- Produces:
  - `export const OPENINGS_RECORD_KEY = "drawcast.openings"`
  - `export function readHistory(): Record<string, boolean[]>` — opening name → its last attempts, newest last, never throws
  - `export function recordAttempt(name: string, hit: boolean): void` — never throws
  - `export function weightFor(attempts: readonly boolean[] | undefined): number`
  - `export function pickOpening(set: readonly Opening[], history: Record<string, boolean[]>, rng: () => number): Opening`

- [ ] **Step 1: Write the failing test**

Append to `tests/chess-openings.test.ts` — put the import up with the file's other imports, not down beside the new describes:

```ts
import { pickOpening, readHistory, recordAttempt, weightFor, WINDOW } from "../src/ui/chess-openings-store";

describe("weighting", () => {
  test("an opening with no history weighs 1, and each recent miss adds 2", () => {
    expect(weightFor(undefined)).toBe(1);
    expect(weightFor([true, true, true])).toBe(1);
    expect(weightFor([false])).toBe(3);
    expect(weightFor([false, false])).toBe(5);
    expect(weightFor([false, false, false])).toBe(7);
  });

  test("the window IS the cap — only the last three attempts count", () => {
    expect(WINDOW).toBe(3);
    // Five old misses, three recent hits: back to 1, with no separate clamp.
    expect(weightFor([false, false, false, false, false, true, true, true])).toBe(1);
    // And the worst possible weight is the window's.
    expect(weightFor(Array(20).fill(false))).toBe(7);
  });

  test("a miss you have since fixed decays on its own", () => {
    expect(weightFor([false, false, false])).toBe(7);
    expect(weightFor([false, false, false, true])).toBe(5);
    expect(weightFor([false, false, false, true, true])).toBe(3);
    expect(weightFor([false, false, false, true, true, true])).toBe(1);
  });
});

describe("pickOpening", () => {
  const set: Opening[] = [
    { name: "A", side: "white", moves: ["e4", "e5", "Nf3"] },
    { name: "B", side: "white", moves: ["d4", "d5", "c4"] },
  ];

  test("with no history it is uniform over the set", () => {
    expect(pickOpening(set, {}, () => 0).name).toBe("A");
    expect(pickOpening(set, {}, () => 0.9).name).toBe("B");
  });

  test("a missed opening takes a larger share of the range", () => {
    // A weighs 7 (three misses), B weighs 1 — so A covers 7/8 of the range.
    const history = { A: [false, false, false] };
    expect(pickOpening(set, history, () => 0.8).name).toBe("A");
    expect(pickOpening(set, history, () => 0.95).name).toBe("B");
  });

  test("an empty set is never asked for — the caller guarantees it", () => {
    // Documented rather than defended: pickOpening on [] would have nothing
    // to return, and every call site falls back to the built-in set first.
    expect(set.length).toBeGreaterThan(0);
  });
});

describe("the history store", () => {
  test("reads as empty and writes silently when storage is unavailable", () => {
    // jsdom is not configured for this suite, so localStorage is absent —
    // which is exactly the private-mode case the store must survive.
    expect(() => recordAttempt("Italian Game", false)).not.toThrow();
    expect(readHistory()).toEqual({});
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/chess-openings.test.ts -t "weighting"`
Expected: FAIL on the import — the module does not exist.

- [ ] **Step 3: Write the store**

Create `src/ui/chess-openings-store.ts`:

```ts
// The drill's miss history (design §7). Deliberately NOT render/record.ts:
// that store is per cast, shaped around plan steps, and is what a Submit
// sends to a teacher — forty drill attempts would drown the real answers, and
// misses would not follow a viewer between casts even though the built-in set
// is the SAME set on every chess board. So: keyed by opening, across casts.
//
// Storage can be absent or throw (private mode) and then the drill goes on
// unweighted — the same rule render/record.ts, views.ts and learn.ts follow.

import type { Opening } from "./chess-openings";

export const OPENINGS_RECORD_KEY = "drawcast.openings";

/** How many recent attempts count. The window IS the cap: a line you have
 *  since fixed decays back to weight 1 on its own, with no separate clamp. */
export const WINDOW = 3;

/** localStorage when this browser offers one, else null — never a throw. */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Opening name -> its attempts, newest last. Empty when storage is dead. */
export function readHistory(): Record<string, boolean[]> {
  const s = storage();
  if (!s) return {};
  try {
    const raw = s.getItem(OPENINGS_RECORD_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean[]> = {};
    for (const [name, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) out[name] = v.filter((x): x is boolean => typeof x === "boolean").slice(-WINDOW);
    }
    return out;
  } catch {
    return {};
  }
}

/** Append an attempt. Silent on a dead store. */
export function recordAttempt(name: string, hit: boolean): void {
  const s = storage();
  if (!s) return;
  try {
    const history = readHistory();
    history[name] = [...(history[name] ?? []), hit].slice(-WINDOW);
    s.setItem(OPENINGS_RECORD_KEY, JSON.stringify(history));
  } catch {
    // A full or refusing store must not interrupt a drill.
  }
}

/** 1, plus 2 for each miss in the last WINDOW attempts: 1 to 7. */
export function weightFor(attempts: readonly boolean[] | undefined): number {
  const recent = (attempts ?? []).slice(-WINDOW);
  return 1 + 2 * recent.filter((hit) => !hit).length;
}

/** A weighted random opening. `rng` returns [0, 1); inject it for tests. */
export function pickOpening(set: readonly Opening[], history: Record<string, boolean[]>, rng: () => number): Opening {
  const weights = set.map((o) => weightFor(history[o.name]));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (const [i, w] of weights.entries()) {
    r -= w;
    if (r < 0) return set[i];
  }
  return set[set.length - 1];
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/chess-openings.test.ts`
Expected: PASS, all of them.

- [ ] **Step 5: Full suite and tsc**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Openings you keep missing come round again sooner"
```

---

### Task 3: The drill session

Spec §5, §8, §9. DOM. Modelled line by line on `src/ui/chessvs.ts` — read that file in full before writing anything.

**Files:**
- Create: `src/ui/chessdrill.ts`
- Test: none of its own (see the note below)

**Interfaces:**
- Consumes: `validateSet`, `matchingOpenings`, `plyList`, `BUILT_IN_OPENINGS`, `Opening` from `./chess-openings`; `pickOpening`, `readHistory`, `recordAttempt` from `./chess-openings-store`; `boundaryChessFen` is NOT used (the drill starts from the initial position); `chessSquareAt`, `chessSquareBox` from `../render/widgets`; `clientPointFor`, `h`, `logicalPoint` from `./dom`; `legalTargets`, `type ChessCtor` from `./chessplay-model`.
- Produces: `export function mountChessDrill(stage: HTMLElement, hd: RenderHandle): void`

**On testing:** `chessvs.ts` and `chessplay.ts` have no session-level tests in this repo, and this task follows that precedent rather than inventing a harness for one mount. The behaviour that CAN be tested without a DOM lives in Tasks 1 and 2, which is where this plan put it deliberately, and Task 4 covers the wiring. One pure pin does belong here, though — Step 5 below.

- [ ] **Step 1: Read the model**

Read `src/ui/chessvs.ts` end to end. The pieces to reuse verbatim in shape: the `.cs-figgate` gate with its hint pill and ✕, `teardown(restore)` swapping `hd.timeline.callbacks.onState`/`onStep` back and calling `hd.timeline.renderUpTo(hd.timeline.position)`, `clearMarks`/`place`/`ringAt`/`markSelection`, `paint()` through `hd.timeline.previewParams(..., { revealNew: true })`, the lazy `void import("chess.js")`, and the gate click handler's select-then-target flow including the "switching pieces" branch.

- [ ] **Step 2: Establish whether the board can be flipped**

Spec §8 wants the board flipped to the side being drilled. `previewParams` takes arbitrary overrides, but `player.ts:187` notes that some overlays apply "only onto paths already present in the boundary's params" — so a `flip` the author never wrote may or may not take effect.

Find out before building on it: in a scratch test or a quick probe, call `previewParams({ fen, moves: [], plies_shown: 0, flip: true }, { revealNew: true })` on a chess spec whose params do NOT contain `flip`, and see whether the rendered board turns.

- If it works, use it, and restore the original `flip` on teardown.
- If it does not, DROP the flipping (the drill still works unflipped) and say so in your report. Do not add a mechanism to force it — that would be a change to the player for a cosmetic win, and it is not in the spec's scope.

Either answer is fine; an unreported guess is not.

- [ ] **Step 3: Write the session**

`mountChessDrill(stage, hd)`, following `mountChessVs`'s structure. The round state and flow:

```
set        = validateSet(Chess, hd.spec.params?.openings).set, or BUILT_IN_OPENINGS
             when that is empty; `dropped` names go into the opening hint once.
opening    = pickOpening(set, readHistory(), Math.random)
plies      = plyList(Chess, opening)            // from/to/san per ply
drilled    = opening.side === "white" ? "w" : "b"
ply        = 0                                  // how many plies stand
misses     = 0                                  // on the CURRENT ply
roundClean = true                               // false once any miss happens
```

Round start: `game = new Chess()`, `paint()`, caption
`♟ Play the <name>. You are <White|Black>.` If the drilled side is Black, the
opponent plays ply 0 immediately (after `THINK_MS`), because the line begins
with White's move.

A click resolves to a square exactly as in `chessvs`. On a completed
from→to:

1. Try `game.move({ from, to, promotion: "q" })`. An illegal move returns as
   it does in `chessvs` — keep the selection, let them re-aim, and do NOT
   count it as a miss. A drill is about the right move, not about mis-clicks.
2. Compare against `plies[ply]` by **from and to**, never by SAN string —
   `validateSet` already canonicalised the set's SAN, and from/to sidesteps
   disambiguation and promotion entirely.
3. **Match:** `ply++`, `paint()`, ring the move. If the line is finished, end
   the round (step 5). Otherwise the opponent plays `plies[ply]` after
   `THINK_MS`, `ply++`, and it is the viewer's move again.
4. **Miss:** `game.undo()`, `paint()`, `roundClean = false`, `misses++`.
   Caption: take the line so far plus the SAN the engine gave the attempted
   move, and ask `matchingOpenings(set, thatPrefix)` — if it names something
   OTHER than the opening being drilled, say
   `♟ That's the <other name>. The <drilled name> plays <expected SAN>.`;
   otherwise `♟ Not this line — the <drilled name> plays <expected SAN>.`
   On the SECOND miss of the same ply, play `plies[ply]` for them, ring it,
   advance, and carry on.
5. **Round end:** `recordAttempt(opening.name, roundClean)`, speak the row's
   `idea` in the hint if it has one, and show an "Again ↻"-style pill that
   starts the next opening — or start it automatically after a short pause.
   Prefer the pill: `chessvs` already ends that way, and a drill that moves on
   by itself gives no moment to read the `idea`.

The judging core, written out because it is the part that is easy to get
subtly wrong — the undo, the from/to comparison, and what does and does not
count as a miss:

```ts
  /** A completed from -> to from the gate's click handler. */
  const tryMove = (from: string, to: string): void => {
    if (!game || busy || over) return;
    let played: { san: string } | null = null;
    try {
      played = game.move({ from, to, promotion: "q" }) as { san: string } | null;
    } catch {
      return; // illegal: keep the selection and let them re-aim, as chessvs does
    }
    if (!played) return;

    const want = plies[ply];
    if (from === want.from && to === want.to) {
      ply++;
      paint();
      clearMarks();
      ringAt(want.from, "from");
      ringAt(want.to, "");
      misses = 0;
      if (ply >= plies.length) finishRound();
      else opponentMove();
      return;
    }

    // A wrong move is taken back. Name it if the line it WOULD make belongs to
    // something else in the set — that is the whole point of carrying a set of
    // mutual confusions (design §6).
    const attempted = [...plies.slice(0, ply).map((p) => p.san), played.san];
    game.undo();
    paint();
    roundClean = false;
    misses++;
    const other = matchingOpenings(set, attempted).find((o) => o.name !== opening.name);
    hint.textContent = other
      ? `♟ That's the ${other.name}. The ${opening.name} plays ${want.san}.`
      : `♟ Not this line — the ${opening.name} plays ${want.san}.`;

    if (misses >= 2) {
      // Nobody is stranded on a line they have never seen. Still a miss.
      game.move({ from: want.from, to: want.to, promotion: "q" });
      ply++;
      paint();
      clearMarks();
      ringAt(want.from, "from");
      ringAt(want.to, "");
      misses = 0;
      if (ply >= plies.length) finishRound();
      else opponentMove();
    }
  };
```

Note what is NOT a miss: a move chess.js rejects outright. That is a mis-click,
and `chessvs` already treats it as one by keeping the selection.

✕ tears down with `restore: true`, exactly as `chessvs` does.

- [ ] **Step 4: Check it against the failure rule**

Walk your own code and confirm each of these, then say so in your report:
- No path throws out of a click handler. `plyList` is called only behind
  `validateSet` for a custom set, and on `BUILT_IN_OPENINGS`, which Task 1's
  test proves legal.
- A dead `localStorage` changes nothing but the weighting.
- A custom set that is empty or wholly invalid falls back to the built-in, and
  the viewer is told that rows were dropped.
- Teardown removes the gate, restores both timeline callbacks, and clears the
  param overrides — including `flip` if Step 2 said you could use it.

- [ ] **Step 5: Pin the thing that makes the drill visible at all**

Spec §8: the drill starts from the initial position regardless of where the
cast is paused, so on a Scholar's Mate board it needs `piece_c5` — a square
that line never touches, and whose id the plan's visible set has therefore
never heard of. `withNewIdsVisible` in `src/render/params.ts` exists for
exactly this, and it is a PURE function, so it can be pinned with no DOM.

Without this the drill would be invisible on most boards, and nothing else in
the suite looks at it. Add to `tests/chess-openings.test.ts`:

```ts
import { withNewIdsVisible } from "../src/render/params";

describe("a drill move onto a square the cast never touched", () => {
  test("mints an id the plan's visible set grows to include", () => {
    // What a Scholar's Mate board knows about: its own line's squares.
    const baseIds = new Set(["board", "piece_e2", "piece_e4", "piece_f7"]);
    const visible = new Set(["board", "piece_e2"]);
    // What a Sicilian drill paints: a pawn on c5, which that cast never saw.
    const previewOrder = ["board", "piece_e2", "piece_c5"];

    const grown = withNewIdsVisible(baseIds, previewOrder, visible);
    expect(grown.has("piece_c5")).toBe(true);
    // An id the base layout already had keeps its honest visibility.
    expect(grown.has("piece_e4")).toBe(false);
  });
});
```

Run: `npx vitest run tests/chess-openings.test.ts -t "never touched"`
Expected: PASS. If it does not, the assumption spec §8 rests on is wrong, and
the drill needs a different route onto an untouched square — stop and report
that rather than working around it.

- [ ] **Step 6: Full suite, tsc and build**

Run: `npm test && npm run build`
Expected: green. Nothing in this task touches the board, so `tests/packs.test.ts`'s hash pins must not move.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Play the line, and play it again until it is yours"
```

---

### Task 4: The pill, and the wire that reaches it

Spec §2. Two small edits and the tests that pin them.

**Files:**
- Modify: `src/ui/quiz-model.ts` (`activitiesFor`, the chess block)
- Modify: `src/ui/tray.ts` (the activity routing, ~line 817)
- Create: `tests/chess-drill-wiring.test.ts`

**Interfaces:**
- Consumes: `mountChessDrill` from `./chessdrill`.
- Produces: an activity `{ kind: "chess", id: "openings_drill", label: "📖 Drill openings" }`.

- [ ] **Step 1: Write the failing test**

Create `tests/chess-drill-wiring.test.ts`:

```ts
// The pill exists, sits with the other chess activities, and is routed.
// A registry entry nothing routes is a button that does nothing.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { activitiesFor } from "../src/ui/quiz-model";

describe("the Drill openings pill", () => {
  test("is offered on any chess scene, beside the drills already there", () => {
    const ids = activitiesFor(["chess"]).map((a) => a.id);
    expect(ids).toContain("openings_drill");
    expect(ids).toContain("square_quiz");
    expect(ids).toContain("vs_computer");
  });

  test("is not offered on a scene that declares no chess", () => {
    expect(activitiesFor(["piano"]).map((a) => a.id)).not.toContain("openings_drill");
  });

  test("does not displace the generic identify drill for a figure with parts", () => {
    // activitiesFor's own rule: the generic drill is added only when nothing
    // bespoke was. A chess scene is bespoke; a parts figure must be unaffected.
    expect(activitiesFor([], 8).map((a) => a.id)).toEqual(["parts_quiz"]);
  });

  test("the tray routes it — a pill nothing mounts is a dead button", () => {
    const tray = readFileSync(new URL("../src/ui/tray.ts", import.meta.url), "utf8");
    expect(tray).toContain("openings_drill");
    expect(tray).toContain("mountChessDrill");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/chess-drill-wiring.test.ts`
Expected: FAIL — `openings_drill` is in neither the registry nor the tray.

- [ ] **Step 3: Add the registry entry**

`src/ui/quiz-model.ts`, in `activitiesFor`'s chess block:

```ts
  if (interactions.includes("chess")) {
    out.push({ kind: "chess", id: "square_quiz", label: "🎯 Find the square" });
    out.push({ kind: "chess", id: "openings_drill", label: "📖 Drill openings" });
    out.push({ kind: "chess", id: "vs_computer", label: "♟ Play the computer" });
  }
```

The order puts the two drills together and leaves Play the computer last, where it already sits.

- [ ] **Step 4: Route it in the tray**

`src/ui/tray.ts`, at the activity click handler (~line 817), beside the existing `vs_computer` branch:

```ts
          if (a.id === "vs_computer") mountChessVs(stage, hd);
          else if (a.id === "openings_drill") mountChessDrill(stage, hd);
          else mountQuiz(stage, hd, a);
```

Add the import beside `mountChessVs`'s.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/chess-drill-wiring.test.ts`
Expected: PASS, all four.

- [ ] **Step 6: Full suite, tsc and build**

Run: `npm test && npm run build`
Expected: green. Watch for any test that pins the activity row's exact contents — if one exists and now fails, it is asserting a list this task deliberately grew; update it and say which in your report.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "A third pill on the board"
```

---

## After the last task

- [ ] Run `npm test && npm run build` once more on the merged result.
- [ ] Stamp the spec's Status line: `IMPLEMENTED 2026-09-20, plan docs/superpowers/plans/2026-09-20-chess-openings-drill.md`, with the test count.
- [ ] If Task 3's Step 2 found that the board cannot be flipped from `previewParams`, record that in the spec's §8 — it is a claim the spec makes, and a reader should not have to rediscover it.
- [ ] Do NOT build the "best next move" drill. The spec lists it as a later round with a different dataset (§3.6, §11).
