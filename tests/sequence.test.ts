// The `sequence` element (spec/sequence.ts, page frame round 2 W12): a run
// of pictures — the current one large in the middle, the done ones a small
// row along the top — expanded before layout into ordinary elements and
// commands.

import { describe, expect, it } from "vitest";
import { expandSequences, sequenceGeometry, STRIP_SIZE, type SequenceElementLike } from "../src/spec/sequence";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import { declaredBox } from "../src/spec/answer-buttons";
import { contentBox, CONTENT_TOP_BARE } from "../src/layout/page";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { planOptionsFor } from "../src/render/index";
import { planCommands } from "../src/render/plan";
import { poseOf } from "../src/render/pose";
import type { BBox } from "../src/layout/geometry";
import type { Command, Spec, SpecElement } from "../src/spec/types";

const ICONS = ["brick", "fish", "banana", "octopus", "horse", "cow", "giraffe", "flamingo"];

const seq = (n: number, extra: Partial<SequenceElementLike> = {}): SpecElement =>
  ({ id: "s", type: "sequence", items: ICONS.slice(0, n).map((icon, i) => ({ icon, label: `Item ${i + 1}`, mark: i % 2 ? "True" : "Myth" })), ...extra }) as unknown as SpecElement;

const spec = (n: number, commands: Command[], extra: Partial<SequenceElementLike> = {}): Spec => ({ title: "A run", elements: [seq(n, extra)], commands: [{ speak: "Here they come." }, ...commands] });

const inside = (b: BBox, area: BBox): boolean => b.x >= area.x - 0.5 && b.y >= area.y - 0.5 && b.x + b.w <= area.x + area.w + 0.5 && b.y + b.h <= area.y + area.h + 0.5;
const overlaps = (a: BBox, b: BBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const byId = (s: Spec) => new Map((s.elements ?? []).map((e) => [e.id, e]));

describe("sequence: the expansion", () => {
  it("mints the pictures, names, marks and groups, and leaves no sequence behind", () => {
    const out = expandSequences(spec(3, [{ draw: ["s_1"] }]));
    const ids = (out.elements ?? []).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["s_1", "s_2", "s_3", "s_1_label", "s_3_label", "s_1_mark", "s_3_mark", "s", "s_strip"]));
    expect(ids).not.toContain("s_dot_1");
    expect((out.elements ?? []).some((e) => (e.type as string) === "sequence")).toBe(false);
    const m = byId(out);
    expect(m.get("s_1")).toMatchObject({ type: "icon", of: "brick", icon_look: "picture" });
    expect(m.get("s")).toMatchObject({ type: "group", members: ["s_1", "s_2", "s_3"] });
    expect(m.get("s_strip")).toMatchObject({ type: "group", members: ["s_1", "s_2", "s_3", "s_1_mark", "s_2_mark", "s_3_mark"] });
  });

  it("is the same object back when there is no sequence", () => {
    const s: Spec = { elements: [{ id: "a", type: "text", text: "Hi", x: 500, y: 400 }], commands: [{ draw: ["a"] }] };
    expect(expandSequences(s)).toBe(s);
  });

  it("an icon item takes fallbacks; a text item is a paper card; a string names the author's element, placed in the middle", () => {
    const s: Spec = {
      title: "Mixed",
      elements: [
        { id: "mine", type: "icon", of: "star" },
        { id: "s", type: "sequence", items: [{ icon: ["brick", "wall"], label: "Wall" }, { text: "Lightning never strikes twice" }, "mine"] } as unknown as SpecElement,
      ],
      commands: [{ draw: ["s_1"] }, { draw: ["s_2"] }, { draw: ["s_3"] }],
    };
    const out = expandSequences(s);
    const m = byId(out);
    expect(m.get("s_1")).toMatchObject({ type: "icon", of: "brick", or: ["wall"] });
    expect(m.get("s_2")).toMatchObject({ type: "node", shape: "rect", text: "Lightning never strikes twice" });
    expect(m.get("s_3")).toMatchObject({ type: "group", members: ["mine"] });
    const g = sequenceGeometry(seq(3) as unknown as SequenceElementLike, true);
    expect(m.get("mine")).toMatchObject({ x: g.centre.x });
  });
});

describe("sequence: positions from the content area", () => {
  for (const heading of [true, false]) {
    const area = heading ? contentBox() : contentBox({ heading: false });
    for (let n = 3; n <= 8; n++) {
      it(`${n} items${heading ? "" : ", no heading"}: the picture, its name and every slot inside the content area; the strip evenly spaced and clear of the picture`, () => {
        const el = seq(n) as unknown as SequenceElementLike;
        const g = sequenceGeometry(el, heading);
        const pic: BBox = { x: g.centre.x - g.size / 2, y: g.centre.y - g.size / 2, w: g.size, h: g.size };
        expect(inside(pic, area)).toBe(true);
        expect(g.size).toBeGreaterThanOrEqual(250);
        expect(g.labelY - 22).toBeGreaterThan(area.y);
        expect(g.slots).toHaveLength(n);
        expect(g.stripSize).toBeLessThanOrEqual(STRIP_SIZE);
        const gaps = g.slots.slice(1).map((s, i) => s.x - g.slots[i].x);
        for (const d of gaps) expect(d).toBeCloseTo(gaps[0], 5);
        expect(gaps[0]).toBeGreaterThan(g.stripSize); // the minis never touch
        const mid = (g.slots[0].x + g.slots[n - 1].x) / 2;
        expect(mid).toBeCloseTo(500, 5); // centred
        for (const s of g.slots) {
          const box: BBox = { x: s.x - g.stripSize / 2, y: s.y - g.stripSize / 2, w: g.stripSize, h: g.stripSize };
          expect(inside(box, area)).toBe(true);
          expect(overlaps(box, pic)).toBe(false);
          expect(g.markY - 11).toBeGreaterThan(pic.y + pic.h); // the mark sits between the strip and the picture
        }
        if (heading) expect(g.slots[0].y + g.stripSize / 2).toBeLessThanOrEqual(area.y + area.h);
        else expect(g.slots[0].y + g.stripSize / 2).toBeLessThanOrEqual(CONTENT_TOP_BARE);
      });
    }
  }

  it("hatches: at, size, strip bottom and none", () => {
    const g = sequenceGeometry(seq(4, { at: { x: 380, y: 420 }, size: 200 }) as unknown as SequenceElementLike, true);
    expect(g.centre).toEqual({ x: 380, y: 420 });
    expect(g.size).toBe(200);
    const bottom = sequenceGeometry(seq(4, { strip: "bottom" }) as unknown as SequenceElementLike, true);
    expect(bottom.slots[0].y).toBeLessThan(bottom.centre.y - bottom.size / 2);
    expect(bottom.slots[0].y - bottom.stripSize / 2).toBeGreaterThanOrEqual(contentBox().y);
    expect(sequenceGeometry(seq(4, { strip: "none" }) as unknown as SequenceElementLike, true).slots).toEqual([]);
  });
});

describe("sequence: the commands", () => {
  it("drawing item k sends k−1 into its slot first: name hidden, a shrinking move, its mark; item k comes with its name", () => {
    const out = expandSequences(spec(4, [{ draw: ["s_1"], speak: "One." }, { draw: ["s_2"], speak: "Two." }]));
    const cmds = out.commands ?? [];
    const g = sequenceGeometry(seq(4) as unknown as SequenceElementLike, true);
    expect(cmds[1]).toEqual({ draw: ["s_1", "s_1_label"], speak: "One." });
    expect(cmds[2]).toEqual({ hide: ["s_1_label"] });
    expect(cmds[3].move).toMatchObject({ target: "s_1", to: { x: g.slots[0].x, y: g.slots[0].y } });
    expect(cmds[3].move!.scale).toBeCloseTo(g.stripSize / g.size, 2);
    expect(cmds[4]).toEqual({ draw: ["s_1_mark"], parallel: true });
    expect(cmds[5]).toEqual({ draw: ["s_2", "s_2_label"], speak: "Two." });
  });

  it("the bare id draws the next item", () => {
    const out = expandSequences(spec(3, [{ draw: ["s"] }, { draw: "s", speak: "Next." }]));
    const draws = (out.commands ?? []).filter((c) => c.draw).map((c) => c.draw);
    expect(draws).toEqual([["s_1", "s_1_label"], ["s_1_mark"], ["s_2", "s_2_label"]]);
  });

  it("drawing <id>_strip sends the last one in, then brings the whole row to the middle in one move", () => {
    const out = expandSequences(spec(3, [{ draw: ["s_1"] }, { draw: ["s_2"] }, { draw: ["s_3"] }, { draw: ["s_strip"], speak: "All three." }]));
    const cmds = out.commands ?? [];
    const last = cmds[cmds.length - 1];
    expect(last).toEqual({ speak: "All three." });
    const recap = cmds[cmds.length - 2];
    expect(recap.move).toMatchObject({ target: "s_strip", to: { x: 500 } });
    expect(recap.move!.scale).toBeGreaterThan(1);
    expect(cmds.some((c) => c.move?.target === "s_3")).toBe(true);
  });

  it("recap: false leaves the row at the top", () => {
    const out = expandSequences(spec(3, [{ draw: ["s_1"] }, { draw: ["s_strip"] }], { recap: false }));
    expect((out.commands ?? []).some((c) => c.move?.target === "s_strip")).toBe(false);
  });

  it("show_upcoming dots: one per slot with the first item, each hidden as its item lands, the rest at the recap", () => {
    const out = expandSequences(spec(3, [{ draw: ["s_1"] }, { draw: ["s_2"] }, { draw: ["s_strip"] }], { show_upcoming: "dots", recap: true }));
    const cmds = out.commands ?? [];
    expect(cmds[1]).toEqual({ draw: ["s_dot_1", "s_dot_2", "s_dot_3"], parallel: true });
    const hides = cmds.filter((c) => c.hide).map((c) => c.hide);
    expect(hides).toContainEqual(["s_dot_1"]);
    expect(hides).toContainEqual(["s_dot_2"]);
    expect(hides).toContainEqual(["s_dot_3"]);
  });

  it("strip none: a done item simply goes", () => {
    const out = expandSequences(spec(3, [{ draw: ["s_1"] }, { draw: ["s_2"] }], { strip: "none" }));
    expect(out.commands![2]).toEqual({ hide: ["s_1", "s_1_label"] });
  });

  it("the author erasing the current item takes its name too", () => {
    const out = expandSequences(spec(3, [{ draw: ["s_1"] }, { erase: ["s_1"] }, { draw: ["s_2"] }]));
    expect(out.commands![2]).toEqual({ erase: ["s_1", "s_1_label"] });
    expect(out.commands!.some((c) => c.move)).toBe(false);
  });

  it("as planned, each done picture's centre lands on its slot, and the recap keeps them in the content area", () => {
    const s = expandSpec(spec(5, [{ draw: ["s_1"] }, { draw: ["s_2"] }, { draw: ["s_3"] }, { draw: ["s_4"] }, { draw: ["s_5"] }, { draw: ["s_strip"] }]));
    const layout = layoutSpec(s, heuristicMeasure);
    const bb = elementBBoxes(layout, heuristicMeasure);
    // Icons with no artwork in the test store have no drawn box: their declared one stands in.
    for (const e of s.elements ?? []) if (!bb.has(e.id) && declaredBox(e)) bb.set(e.id, declaredBox(e)!);
    const plan = planCommands(s.commands ?? [], layout.order, { bboxOf: (id) => bb.get(id) ?? null, ...planOptionsFor(s, layout) });
    const g = sequenceGeometry(seq(5) as unknown as SequenceElementLike, true);
    const final = new Map<string, [number, number]>();
    const seen: string[] = [];
    for (const step of plan.steps) {
      if (step.kind !== "transform") continue;
      for (const it of step.items) {
        const b = bb.get(it.id)!;
        const c = poseOf(it.to.offset, it.to.turn)([b.x + b.w / 2, b.y + b.h / 2]);
        if (!seen.includes(it.id)) {
          seen.push(it.id);
          const k = Number(it.id.slice(2));
          if (/^s_\d$/.test(it.id)) {
            expect(c[0]).toBeCloseTo(g.slots[k - 1].x, 0);
            expect(c[1]).toBeCloseTo(g.slots[k - 1].y, 0);
          }
        }
        final.set(it.id, c);
      }
    }
    const area = contentBox();
    for (const [, c] of final) expect(inside({ x: c[0] - 1, y: c[1] - 1, w: 2, h: 2 }, area)).toBe(true);
    const xs = [1, 2, 3, 4, 5].map((k) => final.get(`s_${k}`)![0]);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(xs[1] - xs[0], 3);
  });
});

describe("sequence: with on-canvas quiz buttons", () => {
  it("the buttons stand clear of the current picture, its name and the strip, inside the content area", () => {
    const s = expandSpec(
      spec(5, [
        { draw: ["s_1"] },
        { quiz: { question: "?", choices: ["True", "Myth"], correct: 2, on_canvas: true } },
        { draw: ["s_2"] },
        { quiz: { question: "?", choices: ["True", "Myth"], correct: 1, on_canvas: true } },
      ] as Command[]),
    );
    const m = byId(s);
    const g = sequenceGeometry(seq(5) as unknown as SequenceElementLike, true);
    const area = contentBox();
    const strip: BBox[] = g.slots.map((p) => ({ x: p.x - g.stripSize / 2, y: g.markY - 11, w: g.stripSize, h: p.y + g.stripSize / 2 - (g.markY - 11) }));
    for (const q of [1, 2]) {
      for (const j of [1, 2]) {
        const b = declaredBox(m.get(`quiz_${q}_btn_${j}`)!)!;
        expect(inside(b, area)).toBe(true);
        expect(overlaps(b, declaredBox(m.get(`s_${q}`)!)!)).toBe(false);
        expect(overlaps(b, declaredBox(m.get(`s_${q}_label`)!)!)).toBe(false);
        for (const sb of strip) expect(overlaps(b, sb)).toBe(false);
      }
    }
  });
});

describe("sequence: the schema", () => {
  it("validates as authored", () => {
    expect(validateSpec(spec(4, [{ draw: ["s_1"] }, { draw: ["s_strip"] }], { show_upcoming: "dots", strip: "top", recap: false })).errors).toEqual([]);
  });

  it("names a missing element, an item with both icon and text, too few items, a colliding id", () => {
    const bad: Spec = {
      elements: [
        { id: "s", type: "sequence", items: ["ghost", { icon: "fish", text: "Fish" }] } as unknown as SpecElement,
        { id: "s_strip", type: "text", text: "x", x: 1, y: 1 },
      ],
      commands: [],
    };
    const errs = validateSpec(bad).errors.join("\n");
    expect(errs).toContain('item "ghost" is not an element');
    expect(errs).toContain("items[1]: give icon");
    expect(errs).toContain('"s_strip" collides');
    const few = validateSpec({ elements: [{ id: "s", type: "sequence", items: [{ icon: "fish" }] } as unknown as SpecElement], commands: [] });
    expect(few.ok).toBe(false);
  });

  it("a cards item still needs its text (label and mark are a sequence's)", () => {
    const errs = validateSpec({ elements: [{ id: "c", type: "cards", items: [{ icon: "fish", label: "x" }, "b"] } as unknown as SpecElement], commands: [] }).errors;
    expect(errs.join("\n")).toContain("every item is its words");
  });
});
