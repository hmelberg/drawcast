// tests/widgets-pack.test.ts — the three widgets Task 3 adds to the pack
// (xylophone, bubble sort, tic-tac-toe), each driven through the pure harness
// the authors' own node tests use. A pack widget is only as good as the
// sequence a viewer can actually click, so every rule the document teaches is
// pinned as a click (or a key) sequence: the notes a bar records, the swap
// bubble sort refuses, and the opponent that must answer the same way twice.
//
// tests/widget-demo.test.ts owns the other half — that every shipped demo
// PATCHES, so the movie moves — and the examples gate owns the layouts.
import { beforeAll, describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { demoWidget, keyEvent, partAt, runWidget } from "../src/scenes/widget-run";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import type { Spec } from "../src/spec/types";

const IDS = ["xylophone", "bubble_sort", "tictactoe"];

beforeAll(async () => {
  await ensureEnabledPacks(["widgets"]);
});

/** Every complaint the figure makes at these params. No storyboard, so
 *  nothing is exempted for not being on screen together: the strictest read. */
function lintAt(id: string, params: Record<string, unknown>): string[] {
  const l = layoutSpec({ title: id, template: id, params, commands: [] } as unknown as Spec);
  return [...l.warnings, ...l.issues.map((i) => `[${i.severity}] ${i.message}`)];
}

describe("xylophone", () => {
  test("bars sound their note and record it; Done answers the sequence; keys 1–8 play too", () => {
    const x = scenes["xylophone"];
    const r = runWidget(x, {}, ["bar_1", "bar_3", "bar_5", "key_done"]);
    expect(r.errors).toEqual([]);
    expect(r.answer).toBe("C4 E4 G4");
    expect(r.params.played).toBe("C4 E4 G4");
    expect(r.effects[0].some((e) => e.sound && "notes" in e.sound)).toBe(true);
    const k = runWidget(x, {}, [keyEvent("1", 50), keyEvent("3", 50), keyEvent("5", 50), keyEvent("Enter", 50)]);
    expect(k.errors).toEqual([]);
    expect(k.answer).toBe("C4 E4 G4");
  });

  test("Done on an empty xylophone says nothing — `answer` means done, not provisional", () => {
    const r = runWidget(scenes["xylophone"], {}, ["key_done"]);
    expect(r.answer).toBeNull();
    expect(r.effects.flat()).toEqual([]);
  });

  test("the keys the body declares are the eight bars and Enter — nothing else is swallowed", () => {
    expect(scenes["xylophone"].widget!().keys).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "Enter"]);
  });

  test("judge reads a played sequence the way a person writes it: case, spacing, edges", () => {
    const judge = scenes["xylophone"].widget!().judge!;
    expect(judge("C4 E4 G4", "C4 E4 G4")).toBe(true);
    expect(judge("  c4   e4 g4 ", "C4 E4 G4")).toBe(true);
    expect(judge("C4 E4", "C4 E4 G4")).toBe(false);
    expect(judge("C4 G4 E4", "C4 E4 G4")).toBe(false);
  });

  test("the demo taps the answer's bars, sounds each one and fills the strip in as it goes", () => {
    const d = demoWidget(scenes["xylophone"], {}, "C4 E4 G4");
    expect(d.errors).toEqual([]);
    expect(d.effects.filter((e) => e.pointer).map((e) => e.pointer)).toEqual(["bar_1", "bar_3", "bar_5", "key_done"]);
    expect(d.effects.filter((e) => e.sound)).toHaveLength(3);
    expect([...d.effects].reverse().find((e) => e.patch)!.patch).toEqual({ played: "C4 E4 G4" });
  });

  test("an ask naming a note this xylophone has not got demonstrates NOTHING, not a different tune", () => {
    const d = demoWidget(scenes["xylophone"], {}, "C4 F#4 G4");
    expect(d.errors).toEqual([]);
    expect(d.effects).toEqual([]);
  });
});

describe("bubble sort", () => {
  test("two adjacent bars swap, non-adjacent is refused, the sorted state answers", () => {
    const b = scenes["bubble_sort"];
    // One swap from sorted, and four bars — the fewest the document declares.
    const r = runWidget(b, { values: [1, 3, 2, 4] }, ["bar_1", "bar_2"]);
    expect(r.errors).toEqual([]);
    expect(r.params.values).toEqual([1, 2, 3, 4]);
    expect(r.params.swaps).toBe(1);
    expect(r.answer).toBe("sorted");
    // A non-adjacent pair patches NOTHING (so the run's params never gain a
    // `values` key at all) and the viewer is told the rule out loud.
    const bad = runWidget(b, {}, ["bar_0", "bar_2"]);
    expect(bad.errors).toEqual([]);
    expect(bad.params.values).toBeUndefined();
    expect(bad.effects.flat().some((e) => e.caption)).toBe(true);
  });

  test("the sorted row answers exactly once — a tenth click does not ask the gate again", () => {
    const r = runWidget(scenes["bubble_sort"], { values: [1, 3, 2, 4] }, ["bar_1", "bar_2", "bar_0", "bar_1", "bar_2", "bar_3"]);
    expect(r.effects.flat().filter((e) => e.answer !== undefined)).toHaveLength(1);
    expect(r.params.values).toEqual([1, 2, 3, 4]);
  });

  test("a click on a bar and then the same bar again just lets it go", () => {
    const r = runWidget(scenes["bubble_sort"], {}, ["bar_0", "bar_0", "bar_3"]);
    expect(r.errors).toEqual([]);
    expect(r.params.values).toBeUndefined();
  });

  test("the demo bubbles the default bars all the way to sorted, bounded", () => {
    const d = demoWidget(scenes["bubble_sort"], {}, "sorted");
    expect(d.errors).toEqual([]);
    const patches = d.effects.filter((e) => e.patch);
    expect(patches.length).toBeLessThanOrEqual(13); // 12 swaps + the final jump
    expect((patches.at(-1)!.patch as { values: number[] }).values).toEqual([1, 2, 3, 5, 8, 9]);
  });
});

describe("tic-tac-toe", () => {
  test("X plays, O answers deterministically, a finished game answers won/lost/draw", () => {
    const t = scenes["tictactoe"];
    const r = runWidget(t, {}, ["cell_4"]);
    expect(r.errors).toEqual([]);
    const board = r.params.board as string;
    expect(board.split("").filter((c) => c === "x")).toHaveLength(1);
    expect(board.split("").filter((c) => c === "o")).toHaveLength(1);
    const again = runWidget(t, {}, ["cell_4"]);
    expect(again.params.board).toBe(board); // deterministic opponent
  });

  test("the opponent takes its OWN win ahead of blocking yours", () => {
    // The one position that tells the two apart, and the reason it is here:
    // every empty-board sequence below reads the same whether the rule looks
    // for a win first or a block first, so none of them can fail if the two
    // branches are swapped. Here O has oo. on the top row and X has xx. on
    // the middle: taking the win ends the game, blocking prolongs it.
    const r = runWidget(scenes["tictactoe"], { board: "oo.xx...." }, ["cell_6"]);
    expect(r.errors).toEqual([]);
    expect(r.params.board).toBe("oooxx.x.."); // O completed the top row…
    expect(r.answer).toBe("lost");
    // …and did NOT play the block at 5, which would have left the game open.
    expect(r.params.board).not.toBe("oo.xxox..");
  });

  test("the opponent's fixed rule: block before the centre, the centre before a corner", () => {
    const t = scenes["tictactoe"];
    // Centre, then the far corner, then the block O forces: a draw, every time.
    const drawn = runWidget(t, {}, ["cell_4", "cell_8", "cell_1", "cell_3", "cell_6"]);
    expect(drawn.errors).toEqual([]);
    expect(drawn.params.board).toBe("oxoxxoxox");
    expect(drawn.answer).toBe("draw");
    // Corner, opposite corner, block, and the fork O's rule cannot see.
    const won = runWidget(t, {}, ["cell_0", "cell_8", "cell_6", "cell_3"]);
    expect(won.answer).toBe("won");
    // Three in a column offered to a gate that takes its own win first.
    const lost = runWidget(t, {}, ["cell_0", "cell_1", "cell_3"]);
    expect(lost.answer).toBe("lost");
  });

  test("keys 1–9 are the cells in reading order", () => {
    const t = scenes["tictactoe"];
    expect(t.widget!().keys).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    const byKey = runWidget(t, {}, [keyEvent("5", 40), keyEvent("9", 40), keyEvent("2", 40), keyEvent("4", 40), keyEvent("7", 40)]);
    expect(byKey.errors).toEqual([]);
    expect(byKey.params.board).toBe("oxoxxoxox"); // the same game as cells 4, 8, 1, 3, 6
  });

  test("a finished game answers once, and a taken square is refused with a caption", () => {
    const t = scenes["tictactoe"];
    const r = runWidget(t, {}, ["cell_4", "cell_4", "cell_8", "cell_1", "cell_3", "cell_6", "cell_0"]);
    expect(r.effects.flat().filter((e) => e.answer !== undefined)).toHaveLength(1);
    expect(r.effects[1].some((e) => e.caption)).toBe(true); // the second click on the centre
  });

  test("judge lets a win pass a draw's ask — beating the computer is not a wrong answer", () => {
    const judge = scenes["tictactoe"].widget!().judge!;
    expect(judge("draw", "draw")).toBe(true);
    expect(judge("won", "draw")).toBe(true);
    expect(judge("lost", "draw")).toBe(false);
    expect(judge("draw", "won")).toBe(false);
  });

  test("the demo plays a whole scripted game, a patch per move, and ends in a draw", () => {
    const d = demoWidget(scenes["tictactoe"], {}, "draw");
    expect(d.errors).toEqual([]);
    expect(d.effects.filter((e) => e.pointer).length).toBeGreaterThanOrEqual(5);
    const last = [...d.effects].reverse().find((e) => e.patch)!;
    expect((last.patch as { board: string }).board).toBe("oxoxxoxox");
  });
});

// I4: a body's on() reads `ev.id` off wherever partAt() says the click
// landed — so if the two ever disagreed, a viewer's tap on a pad's own
// centre would silently miss it. This pins the whole pack's HIT SURFACE,
// not just its ids: every interactive part (a pad, a cell, a bar, a peg, a
// switch) at its own box centre, at the same params the bundled example
// uses. Non-interactive ids (a title, a strip, a counter, a hint line, the
// grid) are never clicked by a body, so they are left out on purpose.
describe("every pack widget's interactive parts sit on the real hit surface", () => {
  const cases: { id: string; parts: string[] }[] = [
    { id: "morse_key", parts: ["key_dot", "key_dash", "key_gap", "key_send"] },
    { id: "tower_of_hanoi", parts: ["peg_0", "peg_1", "peg_2"] },
    { id: "logic_gates", parts: ["switch_a", "switch_b"] },
    { id: "xylophone", parts: Array.from({ length: 8 }, (_, i) => `bar_${i + 1}`).concat("key_done") },
    { id: "bubble_sort", parts: Array.from({ length: 6 }, (_, i) => `bar_${i}`) },
    { id: "tictactoe", parts: Array.from({ length: 9 }, (_, i) => `cell_${i}`) },
  ];

  test.each(cases)("$id: partAt(centre-of-box) answers each part with its own id", ({ id, parts }) => {
    const exampleParams = scenes[id].manifest.examples[0].params as Record<string, unknown>;
    const scene = buildWidgetScene(scenes[id], exampleParams);
    expect(scene, id).not.toBeNull();
    for (const part of parts) {
      const box = scene!.boxes.get(part);
      expect(box, `${id}: ${part} has no box at the example params`).toBeDefined();
      const centre: [number, number] = [box!.x + box!.w / 2, box!.y + box!.h / 2];
      expect(partAt(scene!, centre), `${id}: a click at ${part}'s own centre`).toBe(part);
    }
  });
});

// The bundled example pins ONE param set, and the examples gate lints that
// one. These two hold the rest of each document to the same bar: the shapes
// the MODEL copies (a template's own manifest examples, which nothing else
// lints), and the shapes the VIEWER makes — a figure that lints clean empty
// and collides once it is full is exactly the defect an example must not
// model (the animate-stage promise, for the interactive path).
describe("the figure stays clean wherever it is driven", () => {
  test.each(IDS)("%s lays out cleanly at every one of its own manifest examples", (id) => {
    for (const ex of scenes[id].manifest.examples) {
      expect(lintAt(id, ex.params as Record<string, unknown>), `${id}: ${ex.request}`).toEqual([]);
    }
  });

  test.each([
    { id: "xylophone", answer: "C4 D4 E4 F4 G4 A4 B4 C5" }, // the longest played line there is
    { id: "bubble_sort", answer: "sorted" },
    { id: "tictactoe", answer: "draw" }, // every square filled
  ])("$id lays out cleanly at every state its own demo patches it into", ({ id, answer }) => {
    const d = demoWidget(scenes[id], {}, answer);
    expect(d.errors).toEqual([]);
    const params: Record<string, unknown> = {};
    let patches = 0;
    for (const e of d.effects) {
      if (!e.patch) continue;
      patches = patches + 1;
      Object.assign(params, e.patch);
      expect(lintAt(id, params), `${id} at ${JSON.stringify(params)}`).toEqual([]);
    }
    expect(patches, `${id}: the demo never moved the figure`).toBeGreaterThan(0);
  });
});
