// `walk: true` on a group (2026-09-23): the group's members are peers walked
// one at a time. expandWalks turns the field into ordinary fade commands
// before layout — the same arrangement as expandCards — so the player, the
// lint, export and the frames harness all see one thing.

import { describe, expect, test } from "vitest";
import { expandWalks, WALK_DIM, WALK_SECONDS } from "../src/spec/walk";
import type { Command, Spec } from "../src/spec/types";

const rect = (id: string) => ({ id, type: "shape" as const, shape: "rect" as const, x: 0, y: 0, width: 40, height: 40 });

/** Three peers a, b, c — each a picture and its caption — walked as one group. */
function spec(commands: Command[], walk = true): Spec {
  return {
    elements: [
      ...["a", "b", "c"].flatMap((m) => [rect(`${m}_pic`), { id: `${m}_cap`, type: "label" as const, text: m, attach_to: `${m}_pic`, side: "below" as const }]),
      rect("a_extra"),
      ...["a", "b", "c"].map((m) => ({ id: m, type: "group" as const, members: m === "a" ? ["a_pic", "a_cap", "a_extra"] : [`${m}_pic`, `${m}_cap`] })),
      { id: "peers", type: "group", members: ["a", "b", "c"], ...(walk ? { walk: true } : {}) },
    ],
    commands,
  };
}

/** The fades expandWalks inserted, as "to:ids". */
const fades = (s: Spec) => (s.commands ?? []).filter((c) => c.fade).map((c) => `${c.fade!.to}:${[c.fade!.target].flat().join(",")}`);

describe("expandWalks", () => {
  test("a spec with no walk is returned as the same object", () => {
    const s = spec([{ draw: ["a"] }, { draw: ["b"] }], false);
    expect(expandWalks(s)).toBe(s);
  });

  test("drawing the next peer fades the ones already shown, quietly and briefly", () => {
    const out = expandWalks(spec([{ draw: ["a"], speak: "A." }, { draw: ["b"], speak: "B." }, { draw: ["c"], speak: "C." }]));
    expect(fades(out)).toEqual([`${WALK_DIM}:a`, `${WALK_DIM}:b`]);
    const cmds = out.commands!;
    // The fade sits just before the draw it makes room for, with no voice of its own.
    expect(cmds[1].fade).toBeDefined();
    expect(cmds[1].speak).toBeUndefined();
    expect(cmds[1].fade!.duration).toBe(WALK_SECONDS);
    expect(cmds[2].draw).toEqual(["b"]);
  });

  test("more beats on the current peer insert nothing", () => {
    const out = expandWalks(spec([{ draw: ["a_pic"] }, { draw: ["a_cap", "a_extra"] }, { highlight: { target: ["a_extra"] } }]));
    expect(fades(out)).toEqual([]);
  });

  test("a command across two peers restores every faded one first", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { draw: ["c"] }, { highlight: { target: ["a_pic", "c_pic"] } }]));
    expect(fades(out)).toEqual([`${WALK_DIM}:a`, `${WALK_DIM}:b`, "1:a,b"]);
    expect(out.commands!.at(-2)!.fade!.to).toBe(1);
  });

  test("naming the group itself restores them all", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { focus: { target: ["peers"] } }]));
    expect(fades(out).at(-1)).toBe("1:a");
  });

  test("going back to one faded peer brings it up and sets the current one down", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { highlight: { target: ["a_extra"] } }]));
    expect(fades(out)).toEqual([`${WALK_DIM}:a`, `${WALK_DIM}:b`, "1:a"]);
  });

  test("a point or a camera at a faded peer is going back to it too", () => {
    const pointed = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { point: { at: { ref: "a_pic" } } }]));
    expect(fades(pointed).slice(-2)).toEqual([`${WALK_DIM}:b`, "1:a"]);
    const zoomed = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { camera: { center: { ref: "a" }, zoom: 2 } }]));
    expect(fades(zoomed).slice(-2)).toEqual([`${WALK_DIM}:b`, "1:a"]);
  });

  test("a label attached to a peer's part counts as that peer", () => {
    const s = spec([{ draw: ["a"] }, { draw: ["b"] }, { highlight: { target: ["a_cap"] } }]);
    // a_cap is a member of a; make a second label that is in no group at all.
    s.elements!.push({ id: "loose", type: "label", text: "x", attach_to: "a_pic", side: "left" });
    s.commands!.push({ highlight: { target: ["loose"] } });
    const out = expandWalks(s);
    expect(fades(out)).toEqual([`${WALK_DIM}:a`, `${WALK_DIM}:b`, "1:a"]);
  });

  test("the author's own fade wins, and the walk remembers it", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { fade: { target: ["a"], to: 1 }, speak: "Both." }, { highlight: { target: ["a_pic", "b_pic"] } }]));
    // Nothing faded is left for the comparison to restore.
    expect(fades(out)).toEqual([`${WALK_DIM}:a`, "1:a"]);
  });

  test("an erased peer is forgotten", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { erase: ["a"] }, { draw: ["b"] }, { draw: ["c"] }]));
    expect(fades(out)).toEqual([`${WALK_DIM}:b`]);
  });

  test("drawing the whole group at once fades nothing", () => {
    const out = expandWalks(spec([{ draw: ["peers"] }, { highlight: { target: ["b_pic"] } }]));
    expect(fades(out)).toEqual([]);
  });

  test("elements and every other field come through untouched", () => {
    const s = spec([{ draw: ["a"] }, { draw: ["b"] }]);
    const out = expandWalks(s);
    expect(out.elements).toBe(s.elements);
    expect(s.commands).toHaveLength(2); // the input is not mutated
  });
});

import { validateSpec } from "../src/spec/schema";

describe("the field", () => {
  test("a walked group validates", () => {
    expect(validateSpec(spec([{ draw: ["a"] }])).ok).toBe(true);
  });

  test("walk on something that is not a group is refused", () => {
    const r = validateSpec({ elements: [{ id: "t", type: "text", text: "hi", x: 1, y: 2, walk: true }], commands: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("walk is a group's field");
  });
});
