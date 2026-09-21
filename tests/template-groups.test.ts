// A template may hand the planner a NAME for a set of its own elements.
//
// The planner has always expanded a parent id to its members (plan.ts,
// expandOne): name the parent, and every member is drawn, highlighted or
// arranged, while each member keeps its own id for everything else. Only
// freehand specs could reach it — a template's layout had no channel to
// declare a group, so `layout.groups` was empty for every template scene,
// and a cast that wanted a chess board had to name sixty-odd ids to get one.
//
// Hans, 2026-09-21: "the aim is to be able to quickly show a position, maybe
// animate to the given position, and to be able to specify this in a
// non-verbose way in the code."
import { describe, expect, test } from "vitest";
import gamesYaml from "../src/scenes/packs/games.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { ensureEngines } from "../src/scenes/engines";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { planCommands } from "../src/render/plan";

const chess = (params: Record<string, unknown> = {}) => ({ template: "chess_board", params, elements: [] });

async function laidOut(params: Record<string, unknown> = {}) {
  await ensureEngines(["chess"]);
  registerPack("games", gamesYaml);
  return layoutSpec(chess(params) as never, heuristicMeasure);
}

describe("a template's own groups", () => {
  test("reach the layout, where the planner looks them up", async () => {
    const res = await laidOut();
    expect(Object.keys(res.groups).sort()).toEqual(["pieces", "position", "squares"]);
  });

  test("`position` is the whole board in one word — and groups nest", async () => {
    // What a cast means by "show the position": the board with its
    // coordinates, all sixty-four squares, the men, and the move arrow that
    // grows as a line is played. expandOne recurses, so this group may name
    // the other two rather than repeating their members.
    const res = await laidOut({ moves: ["e4"] });
    expect(res.groups.position).toEqual(["board", "squares", "pieces", "move_arrow"]);
  });

  test("`pieces` is every piece standing on the board", async () => {
    const res = await laidOut();
    expect(res.groups.pieces).toHaveLength(32); // the opening array
    expect(res.groups.pieces).toContain("piece_e2");
    expect(res.groups.pieces.every((id) => /^piece_[a-h][1-8]$/.test(id))).toBe(true);
  });

  test("`pieces` is every square the line's men ever stand on, not just today's", async () => {
    // A square the line only reaches later carries an EMPTY piece group at
    // ply 0 (games.yaml: the id exists at every plies_shown so an animate can
    // glide onto it). The group must name those too — drawing one paints
    // nothing, but leaving it out leaves it UNMENTIONED, and the planner
    // sweeps everything unmentioned into an implicit draw AFTER the last
    // beat: a cast that ends on a phantom step drawing invisible men.
    const res = await laidOut({ moves: ["e4", "e5"], plies_shown: 0 });
    expect(res.groups.pieces).toContain("piece_e2"); // where the pawn stands now
    expect(res.groups.pieces).toContain("piece_e4"); // where it will stand
  });

  test("`squares` is all sixty-four, light and dark alike", async () => {
    const res = await laidOut();
    expect(res.groups.squares).toHaveLength(64);
    expect(res.groups.squares).toContain("sq_a1");
    expect(res.groups.squares).toContain("sq_f7");
  });

  test("a group draws nothing of its own — it is a name, not an element", async () => {
    const res = await laidOut();
    // In `order` it would be drawn as a phantom by the implicit final draw.
    expect(res.order).not.toContain("pieces");
    expect(res.drawables.some((d) => d.id === "pieces" || d.id === "squares")).toBe(false);
  });
});

describe("naming a group in a command", () => {
  test("draws every member, so a whole board is ONE id", async () => {
    const res = await laidOut();
    const plan = planCommands([{ draw: ["position"] }], res.order, {
      expandGroup: (id: string) => res.groups[id] ?? null,
    } as never);
    expect(plan.warnings).toEqual([]);
    const step = plan.steps.find((s) => s.kind === "draw")!;
    expect(step.ids).toContain("board");
    expect(step.ids.filter((id) => id.startsWith("piece_"))).toHaveLength(32);
    expect(step.ids.filter((id) => id.startsWith("sq_"))).toHaveLength(64);
  });

  test("leaves every member addressable by its own id", async () => {
    // The whole point of a group over a kit.group: `piece_e2` is still an
    // element, so it can be pointed at, moved for a what-if, and glided by
    // an animated plies_shown.
    const res = await laidOut();
    const plan = planCommands(
      [{ draw: ["position"] }, { point: { at: { ref: "piece_e2" } } }, { highlight: { target: "piece_e2" } }],
      res.order,
      { expandGroup: (id: string) => res.groups[id] ?? null, bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }) } as never,
    );
    expect(plan.warnings).toEqual([]);
  });

  test("leaves nothing for the implicit final draw — not even mid-line", async () => {
    // resolveIds expands before `mentioned` is written, so the men are not
    // re-sketched after the last beat; and the group covering the line's
    // later squares is what keeps THOSE out of it too.
    const res = await laidOut({ moves: ["e4", "e5", "Nf3"], plies_shown: 0 });
    const plan = planCommands([{ draw: ["position"] }], res.order, {
      expandGroup: (id: string) => res.groups[id] ?? null,
    } as never);
    expect(plan.steps.filter((s) => s.kind === "draw" && (s as { implicit?: boolean }).implicit)).toEqual([]);
  });
});
