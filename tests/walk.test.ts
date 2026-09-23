// `walk: true` on a group (2026-09-23): the group's members are peers walked
// one at a time. expandWalks turns the field into ordinary fade commands
// before layout — the same arrangement as expandCards — so the player, the
// lint, export and the frames harness all see one thing.

import { describe, expect, test } from "vitest";
import { expandWalks, WALK_DIM, WALK_SECONDS } from "../src/spec/walk";
import type { Command, Spec } from "../src/spec/types";

const rect = (id: string) => ({ id, type: "shape" as const, shape: "rect" as const, x: 0, y: 0, width: 40, height: 40 });

/** Three peers a, b, c — each a picture and its caption — walked as one group. */
function spec(commands: Command[], walk: boolean | "fade" | "zoom" | "replace" = true): Spec {
  return {
    elements: [
      ...["a", "b", "c"].flatMap((m) => [rect(`${m}_pic`), { id: `${m}_cap`, type: "label" as const, text: m, attach_to: `${m}_pic`, side: "below" as const }]),
      rect("a_extra"),
      ...["a", "b", "c"].map((m) => ({ id: m, type: "group" as const, members: m === "a" ? ["a_pic", "a_cap", "a_extra"] : [`${m}_pic`, `${m}_cap`] })),
      { id: "peers", type: "group", members: ["a", "b", "c"], ...(walk ? { walk } : {}) },
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

/** Every inserted or kept command, one word each: "fade 0.3 a", "camera a", "camera reset", "erase a", "draw a". */
const trace = (s: Spec) =>
  (s.commands ?? []).map((c) =>
    c.fade ? `fade ${c.fade.to} ${[c.fade.target].flat()}` :
    c.camera ? (c.camera.reset ? "camera reset" : `camera ${c.camera.center?.ref} ${c.camera.zoom}`) :
    c.erase ? `erase ${[c.erase].flat()}` :
    c.draw ? `draw ${[c.draw].flat()}` :
    Object.keys(c).filter((k) => k !== "speak")[0]);

describe('walk: "zoom"', () => {
  test("the camera frames each new peer as it arrives, after the others step back", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }], "zoom"));
    expect(trace(out)).toEqual(["camera a fit", "draw a", `fade ${WALK_DIM} a`, "camera b fit", "draw b", "camera reset"]);
  });

  test("a comparison pulls back to the whole page and brings them all back", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { highlight: { target: ["a_pic", "b_pic"] } }], "zoom"));
    expect(trace(out).slice(-3)).toEqual(["camera reset", "fade 1 a", "highlight"]);
  });

  test("going back to one frames it again", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { highlight: { target: ["a_pic"] } }], "zoom"));
    expect(trace(out).slice(-5)).toEqual([`fade ${WALK_DIM} b`, "fade 1 a", "camera a fit", "highlight", "camera reset"]);
  });

  test("a quiz, and the end of the cast, see the whole page", () => {
    const quizzed = expandWalks(spec([{ draw: ["a"] }, { quiz: { question: "?", choices: ["x", "y"], correct: 1 } }], "zoom"));
    expect(trace(quizzed)).toEqual(["camera a fit", "draw a", "camera reset", "quiz"]);
    const ended = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }], "zoom"));
    expect(trace(ended).slice(-2)).toEqual(["draw b", "camera reset"]);
  });

  test("the author's own camera wins: a reset they wrote is not doubled", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { camera: { reset: true } }, { highlight: { target: ["peers"] } }], "zoom"));
    expect(trace(out).filter((t) => t === "camera reset")).toHaveLength(1);
  });
});

describe('walk: "replace"', () => {
  test("the next alternative erases the one before", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { draw: ["c"] }], "replace"));
    expect(trace(out)).toEqual(["draw a", "erase a", "draw b", "erase b", "draw c"]);
  });

  test("a comparison draws back only the ones it names", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { draw: ["c"] }, { highlight: { target: ["a_pic", "c_pic"] } }], "replace"));
    expect(trace(out).slice(-2)).toEqual(["draw a", "highlight"]);
  });

  test("naming the group draws them all back", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { draw: ["c"] }, { focus: { target: ["peers"] } }], "replace"));
    expect(trace(out).slice(-2)).toEqual(["draw a,b", "focus"]);
  });

  test("going back to one erases the current and draws it again", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { highlight: { target: ["a_pic"] } }], "replace"));
    expect(trace(out).slice(-3)).toEqual(["erase b", "draw a", "highlight"]);
  });

  test("an author's own draw of an erased one is not doubled", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { draw: ["a"] }], "replace"));
    expect(trace(out).slice(-2)).toEqual(["erase b", "draw a"]);
  });

  test("drawing one PART of an erased one brings the whole of it back first", () => {
    const out = expandWalks(spec([{ draw: ["a"] }, { draw: ["b"] }, { draw: ["a_extra"] }], "replace"));
    expect(trace(out).slice(-3)).toEqual(["erase b", "draw a", "draw a_extra"]);
  });
});

describe("the field", () => {
  test("a walked group validates", () => {
    expect(validateSpec(spec([{ draw: ["a"] }])).ok).toBe(true);
  });

  test("the three ways validate, and nothing else does", () => {
    for (const w of ["fade", "zoom", "replace"] as const) expect(validateSpec(spec([{ draw: ["a"] }], w)).ok).toBe(true);
    expect(validateSpec(spec([{ draw: ["a"] }], "sideways" as never)).ok).toBe(false);
  });

  test("a camera may ask to fit its target", () => {
    expect(validateSpec(spec([{ draw: ["a"] }, { camera: { center: { ref: "a" }, zoom: "fit" } }], false)).ok).toBe(true);
  });

  test("walk on something that is not a group is refused", () => {
    const r = validateSpec({ elements: [{ id: "t", type: "text", text: "hi", x: 1, y: 2, walk: true }], commands: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("walk is a group's field");
  });
});
