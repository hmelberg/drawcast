import { describe, expect, test } from "vitest";
import { planCommands, INITIAL_STATE, isExplicitPointRef, type PlanStep } from "../src/render/plan";
import { poseOf } from "../src/render/pose";
import { CANVAS } from "../src/layout/canvas";

const allIds = ["axes", "demand_curve", "label_D", "supply_curve"];

/** visible ids after steps[0..i] */
const visibleAt = (plan: ReturnType<typeof planCommands>, i: number) => plan.states[i].visible;

describe("planCommands", () => {
  test("normalizes a bare-string draw into an id list", () => {
    const { steps } = planCommands([{ draw: "axes" }], allIds);
    expect(steps[0]).toMatchObject({ kind: "draw", ids: ["axes"] });
  });

  test("appends an implicit final draw for unmentioned elements", () => {
    const { steps } = planCommands([{ draw: ["axes"] }], allIds);
    const last = steps[steps.length - 1];
    expect(last.kind).toBe("draw");
    expect((last as { ids: string[] }).ids.sort()).toEqual(["demand_curve", "label_D", "supply_curve"]);
  });

  test("drops unknown ids with a warning instead of failing", () => {
    const { steps, warnings } = planCommands([{ draw: ["axes", "nonsense"] }], allIds);
    expect((steps[0] as { ids: string[] }).ids).toEqual(["axes"]);
    expect(warnings.join(" ")).toMatch(/nonsense/);
  });

  test("no commands means one draw-everything step", () => {
    const { steps } = planCommands(undefined, allIds);
    expect(steps).toHaveLength(1);
    expect((steps[0] as { ids: string[] }).ids.sort()).toEqual([...allIds].sort());
  });

  test("cumulative scene states support command-level step back", () => {
    const plan = planCommands(
      [{ speak: "intro" }, { draw: ["axes"] }, { pause: 1 }, { draw: ["demand_curve", "label_D"] }],
      allIds,
    );
    expect(visibleAt(plan, 0)).toEqual([]);
    expect(visibleAt(plan, 1)).toEqual(["axes"]);
    expect(visibleAt(plan, 2)).toEqual(["axes"]);
    expect([...visibleAt(plan, 3)].sort()).toEqual(["axes", "demand_curve", "label_D"]);
  });

  test("speak and pause pass through with their payloads", () => {
    const { steps } = planCommands([{ speak: "hello" }, { pause: 2.5 }], []);
    expect(steps[0]).toMatchObject({ kind: "speak", text: "hello", blocking: true });
    expect(steps[1]).toMatchObject({ kind: "pause", seconds: 2.5 });
  });

  test("speak blocking:false is preserved", () => {
    const { steps } = planCommands([{ speak: "watch this", blocking: false }], []);
    expect(steps[0]).toMatchObject({ kind: "speak", blocking: false });
  });

  test("parallel flag is preserved on draw steps", () => {
    const { steps } = planCommands([{ draw: ["axes", "demand_curve"], parallel: true }], allIds);
    expect(steps[0]).toMatchObject({ kind: "draw", parallel: true });
  });
});

describe("visibility verbs", () => {
  test("hide removes ids from the visible state; show restores them", () => {
    const plan = planCommands(
      [{ draw: ["axes", "demand_curve"] }, { hide: ["demand_curve"] }, { show: ["demand_curve"] }],
      ["axes", "demand_curve"],
    );
    expect(visibleAt(plan, 0).sort()).toEqual(["axes", "demand_curve"]);
    expect(visibleAt(plan, 1)).toEqual(["axes"]);
    expect(visibleAt(plan, 2).sort()).toEqual(["axes", "demand_curve"]);
  });

  test("erase produces an animatable step only for visible ids", () => {
    const plan = planCommands(
      [{ draw: ["axes"] }, { erase: ["axes", "demand_curve"] }],
      ["axes", "demand_curve"],
    );
    const eraseStep = plan.steps.find((s) => s.kind === "erase") as Extract<PlanStep, { kind: "erase" }>;
    expect(eraseStep.ids).toEqual(["axes"]);
    expect(visibleAt(plan, plan.steps.indexOf(eraseStep))).toEqual([]);
  });

  test("hidden/erased elements are excluded from the implicit final draw", () => {
    const plan = planCommands([{ draw: ["axes"] }, { hide: ["demand_curve"] }], ["axes", "demand_curve", "label_D"]);
    const last = plan.steps[plan.steps.length - 1] as Extract<PlanStep, { kind: "draw" }>;
    expect(last.implicit).toBe(true);
    expect(last.ids).toEqual(["label_D"]);
  });

  test("clear hides everything visible except keep", () => {
    const plan = planCommands(
      [{ draw: ["axes", "demand_curve", "label_D"] }, { clear: { keep: ["axes"] } }],
      ["axes", "demand_curve", "label_D"],
    );
    const clearStep = plan.steps[1] as Extract<PlanStep, { kind: "clear" }>;
    expect(clearStep.ids.sort()).toEqual(["demand_curve", "label_D"]);
    expect(visibleAt(plan, 1)).toEqual(["axes"]);
  });
});

describe("move", () => {
  test("accumulates offsets across moves and converts domain deltas", () => {
    const plan = planCommands(
      [{ draw: ["demand_curve"] }, { move: { target: ["demand_curve"], by: [10, 0] } }, { move: { target: "demand_curve", by: [5, 2] } }],
      ["demand_curve"],
      { deltaToLogical: ([x, y]) => [x * 2, y * 3] },
    );
    expect(plan.states[1].offsets["demand_curve"]).toEqual([20, 0]);
    expect(plan.states[2].offsets["demand_curve"]).toEqual([30, 6]);
    expect(plan.steps[2]).toMatchObject({ kind: "move", path: [[10, 6]], easing: "ease-in-out", seconds: 1 });
  });

  test("move of an invisible element warns but still applies", () => {
    const plan = planCommands([{ move: { target: ["axes"], by: [5, 0] } }], ["axes"]);
    expect(plan.warnings.join(" ")).toMatch(/not visible/);
    expect(plan.states[0].offsets["axes"]).toEqual([5, 0]);
  });

  test("move without by/path is skipped with a warning", () => {
    const plan = planCommands([{ move: { target: ["axes"] } }], ["axes"]);
    expect(plan.warnings.join(" ")).toMatch(/by, to, path, rotate or scale/);
    expect(plan.steps.filter((s) => s.kind === "move")).toHaveLength(0);
  });

  test("rotate records a turn in the state and emits a transform step", () => {
    const plan = planCommands([{ draw: ["demand_curve"] }, { move: { target: ["demand_curve"], rotate: 90 } }], allIds, {
      bboxOf: (id) => (id === "demand_curve" ? { x: 100, y: 100, w: 200, h: 100 } : null),
    });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.kind).toBe("transform");
    expect(step.items).toHaveLength(1);
    expect(step.items[0].to.turn.deg).toBe(90);
    expect(step.items[0].to.turn.pivot).toEqual([200, 150]); // the bbox centre, original frame
    expect(plan.states[1].turns.demand_curve).toEqual({ deg: 90, pivot: [200, 150], scale: 1, mirror: false });
    expect(plan.states[1].offsets.demand_curve ?? [0, 0]).toEqual([0, 0]);
  });
  test("to moves the centre to the destination (a delta from the current centre)", () => {
    const plan = planCommands([{ draw: ["demand_curve"] }, { move: { target: ["demand_curve"], to: [400, 300] } }], allIds, {
      bboxOf: (id) => (id === "demand_curve" ? { x: 100, y: 100, w: 200, h: 100 } : null),
    });
    expect(plan.states[1].offsets.demand_curve).toEqual([200, 150]);
  });
  test("attached labels ride a rotation by their own box centre — the label's own turn stays undefined (design §2.2)", () => {
    // demand_curve's box is {0,0,10,10} (centre 5,5) — its own default pivot,
    // since no explicit pivot is given. label_D's box is DISTINCT ({15,0,10,10},
    // centre 20,5) so its centre sits off that pivot and the rotation actually
    // displaces it — a same-box fixture here would make the box-centre rule and
    // the old pure-translation rule agree by coincidence and prove nothing.
    const boxes: Record<string, { x: number; y: number; w: number; h: number }> = { demand_curve: { x: 0, y: 0, w: 10, h: 10 }, label_D: { x: 15, y: 0, w: 10, h: 10 } };
    const plan = planCommands(
      [{ draw: ["demand_curve", "label_D"] }, { move: { target: ["demand_curve"], by: [10, 0], rotate: 90 } }],
      allIds,
      { bboxOf: (id) => boxes[id], attachedTo: (id) => (id === "demand_curve" ? ["label_D"] : []) },
    );
    expect(plan.states[1].turns.demand_curve?.deg).toBe(90);
    // demand_curve's own centre IS its pivot, so its offset is just the translation.
    expect(plan.states[1].offsets.demand_curve).toEqual([10, 0]);
    // label_D's centre (20,5), relative to the pivot (5,5), is v=(15,0); a 90°
    // turn sends v to (0,15) (rotateVec is [-y,x] at 90°); adding the pivot (5,5)
    // and the translation (10,0) lands it at (15,20) — a [-5,15] displacement
    // from its untouched start (20,5). The old pure-translation rule would have
    // given [10,0]: this is nowhere close, so the test actually distinguishes them.
    expect(plan.states[1].offsets.label_D).toEqual([-5, 15]);
    expect(plan.states[1].turns.label_D).toBeUndefined();
  });
  test("move with neither by, to, path nor rotate is skipped with a warning", () => {
    const plan = planCommands([{ move: { target: ["axes"] } }], ["axes"]);
    expect(plan.steps.filter((s) => s.kind === "move" || s.kind === "transform")).toHaveLength(0);
    expect(plan.warnings.join(" ")).toMatch(/move/);
  });
  test("a follower named twice by attachedTo (e.g. a label id matching label_<target>) is moved once", () => {
    const plan = planCommands(
      [{ draw: ["demand_curve", "label_D"] }, { move: { target: ["demand_curve"], by: [10, 0], rotate: 45 } }],
      allIds,
      { bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }), attachedTo: (id) => (id === "demand_curve" ? ["label_D", "label_D"] : []) },
    );
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.items.filter((it) => it.id === "label_D")).toHaveLength(1);
    expect(plan.states[1].offsets.label_D).toEqual([10, 0]);
  });
  test("two targets sharing a follower move it once", () => {
    const plan = planCommands(
      [{ draw: ["demand_curve", "supply_curve", "label_D"] }, { move: { target: ["demand_curve", "supply_curve"], by: [10, 0], rotate: 45 } }],
      allIds,
      {
        bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }),
        attachedTo: (id) => (id === "demand_curve" || id === "supply_curve" ? ["label_D"] : []),
      },
    );
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.items.filter((it) => it.id === "label_D")).toHaveLength(1);
    expect(plan.states[1].offsets.label_D).toEqual([10, 0]);
  });
  test("scale composes a pose about the element's centre", () => {
    const plan = planCommands([{ draw: ["demand_curve"] }, { move: { target: ["demand_curve"], scale: 2 } }], allIds, {
      bboxOf: (id) => (id === "demand_curve" ? { x: 100, y: 100, w: 200, h: 100 } : null),
    });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.kind).toBe("transform");
    expect(step.items[0].to.turn.scale).toBe(2);
    expect(step.items[0].to.turn.pivot).toEqual([200, 150]);
    expect(step.items[0].to.offset).toEqual([0, 0]);
    expect(plan.states[1].turns.demand_curve.scale).toBe(2);
  });
  test("scale about an explicit pivot shifts the offset exactly", () => {
    const plan = planCommands([{ draw: ["demand_curve"] }, { move: { target: ["demand_curve"], scale: 2, pivot: [100, 100] } }], allIds, {
      bboxOf: (id) => (id === "demand_curve" ? { x: 100, y: 100, w: 200, h: 100 } : null),
    });
    const it = (plan.steps[1] as Extract<PlanStep, { kind: "transform" }>).items[0];
    // the corner under the pivot stays put; the far corner (300,200) lands at (500,300)
    expect(poseOf(it.to.offset, it.to.turn)([100, 100])).toEqual([100, 100]);
    expect(poseOf(it.to.offset, it.to.turn)([300, 200])).toEqual([500, 300]);
  });
});

describe("highlight and point", () => {
  const bboxOf = (id: string) => (id === "eq" ? { x: 100, y: 200, w: 40, h: 20 } : null);

  test("highlight targets only visible elements and carries their boxes", () => {
    const plan = planCommands(
      [{ draw: ["eq"] }, { highlight: { target: ["eq", "ghost"], effect: "circle", duration: 2 } }],
      ["eq", "ghost"],
      { bboxOf },
    );
    const step = plan.steps[1] as Extract<PlanStep, { kind: "highlight" }>;
    expect(step).toMatchObject({ kind: "highlight", ids: ["eq"], effect: "circle", seconds: 2 });
    expect(step.boxes["eq"]).toEqual({ x: 100, y: 200, w: 40, h: 20 });
    expect(plan.warnings.join(" ")).toMatch(/ghost/);
  });

  test("point at a ref resolves to the element's bbox center", () => {
    const plan = planCommands([{ draw: ["eq"] }, { point: { at: { ref: "eq" } } }], ["eq"], { bboxOf });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "point" }>;
    expect(step).toMatchObject({ kind: "point", x: 120, y: 210, gesture: "tap", seconds: 2 });
  });

  test("point at coordinates maps through the domain", () => {
    const plan = planCommands([{ point: { at: { x: 1, y: 2 }, gesture: "underline" } }], [], {
      toLogical: ([x, y]) => [x * 100, y * 100],
    });
    expect(plan.steps[0]).toMatchObject({ kind: "point", x: 100, y: 200, gesture: "underline" });
  });

  test("point at an unknown ref is skipped with a warning", () => {
    const plan = planCommands([{ point: { at: { ref: "nope" } } }], ["eq"], { bboxOf });
    expect(plan.steps.filter((s) => s.kind === "point")).toHaveLength(0);
    expect(plan.warnings.join(" ")).toMatch(/nope/);
  });
});

describe("camera", () => {
  test("zoom on an element yields a clamped canvas-aspect box", () => {
    const plan = planCommands(
      [{ draw: ["eq"] }, { camera: { center: { ref: "eq" }, zoom: 2 } }],
      ["eq"],
      { bboxOf: () => ({ x: 0, y: 0, w: 40, h: 20 }) },
    );
    const step = plan.steps[1] as Extract<PlanStep, { kind: "camera" }>;
    expect(step.box).toEqual({ x: 0, y: 0, w: CANVAS.w / 2, h: CANVAS.h / 2 }); // clamped to the bottom-left corner
    expect(plan.states[1].camera).toEqual(step.box);
  });

  test("reset returns the camera state to null", () => {
    const plan = planCommands([{ camera: { zoom: 2 } }, { camera: { reset: true } }], []);
    expect(plan.states[0].camera).not.toBeNull();
    expect(plan.states[1].camera).toBeNull();
  });
});

describe("animate planning", () => {
  const base = { demand_shift: { amount: 0 }, azimuth: 32 };

  test("step carries targets, starts from animateBase, default duration 2", () => {
    const plan = planCommands([{ animate: { "demand_shift.amount": 20 } }], ["axes"], { animateBase: base });
    const step = plan.steps.find((s) => s.kind === "animate")!;
    expect(step).toMatchObject({ kind: "animate", targets: { "demand_shift.amount": 20 }, starts: { "demand_shift.amount": 0 }, seconds: 2 });
  });

  test("cumulative: a second animate starts from the first's target; states carry params", () => {
    const plan = planCommands(
      [{ animate: { azimuth: 120 } }, { animate: { azimuth: 240 } }],
      ["axes"],
      { animateBase: base },
    );
    const steps = plan.steps.filter((s) => s.kind === "animate");
    expect(steps[1]).toMatchObject({ starts: { azimuth: 120 } });
    const idx = plan.steps.indexOf(steps[1]);
    expect(plan.states[idx].params).toEqual({ azimuth: 240 });
    expect(INITIAL_STATE.params).toEqual({});
  });

  test("no template → warn + no step; missing numeric start → null start + warning", () => {
    const none = planCommands([{ animate: { a: 1 } }], ["axes"], {});
    expect(none.steps.some((s) => s.kind === "animate")).toBe(false);
    expect(none.warnings.join(" ")).toMatch(/animate requires a scene template/);
    const missing = planCommands([{ animate: { "tax.rate": 5 } }], ["axes"], { animateBase: base });
    const step = missing.steps.find((s) => s.kind === "animate")!;
    expect(step).toMatchObject({ starts: { "tax.rate": null } });
    expect(missing.warnings.join(" ")).toMatch(/no numeric start value/);
  });

  test("no template with a paired speak: animate still skipped, but the narration survives as its own speak step", () => {
    const plan = planCommands([{ animate: { a: 1 }, speak: "watch it grow" }], ["axes"], {});
    expect(plan.steps.some((s) => s.kind === "animate")).toBe(false);
    expect(plan.warnings.join(" ")).toMatch(/animate requires a scene template/);
    expect(plan.steps).toContainEqual({ kind: "speak", text: "watch it grow", blocking: true });
  });

  test("dropped non-numeric animate targets each get their own warning, not just the all-dropped case", () => {
    const plan = planCommands(
      [{ animate: { "demand_shift.amount": 20, bad: "nope" } as unknown as Record<string, number> }],
      ["axes"],
      { animateBase: base },
    );
    expect(plan.warnings).toContain('animate "bad" target is not a number (dropped)');
    const step = plan.steps.find((s) => s.kind === "animate")!;
    expect(step).toMatchObject({ targets: { "demand_shift.amount": 20 } });
  });

  test("bbox source switches after an animate", () => {
    const before = { x: 0, y: 0, w: 10, h: 10 };
    const after = { x: 50, y: 0, w: 10, h: 10 };
    const plan = planCommands(
      [
        { draw: ["dot"] },
        { highlight: { target: ["dot"] } },
        { animate: { "demand_shift.amount": 20 } },
        { highlight: { target: ["dot"] } },
      ],
      ["dot"],
      { animateBase: base, bboxOf: () => before, bboxesFor: () => () => after },
    );
    const highlights = plan.steps.filter((s) => s.kind === "highlight");
    expect(highlights[0].boxes["dot"]).toEqual(before);
    expect(highlights[1].boxes["dot"]).toEqual(after);
  });

  test("narrated animate gets the narration pairing", () => {
    const plan = planCommands([{ animate: { azimuth: 90 }, speak: "spin" }], [], { animateBase: base });
    expect(plan.steps[0].narration).toBe("spin");
  });
});

describe("arrange", () => {
  const pieces = ["k_1", "k_2", "k_3", "k_4"];
  const opts = {
    bboxOf: (id: string) => (pieces.includes(id) ? { x: 200, y: 300, w: 100, h: 80 } : null),
    expandId: (id: string) => (id === "k" ? pieces : null),
    pieceOf: (id: string) => {
      const k = pieces.indexOf(id);
      return k < 0 ? null : { apex: [300, 375] as [number, number], centroid: [0, 0] as [number, number], midAngle: (k + 0.5) * 90, halfAngle: 45, radius: 120 };
    },
  };
  test("a pieces id expands to its pieces; zipper emits one transform step with a turn per piece", () => {
    const plan = planCommands([{ draw: ["k"] }, { arrange: { target: "k", layout: "zipper", at: [600, 375] } }], pieces, opts);
    expect((plan.steps[0] as { ids: string[] }).ids).toEqual(pieces);
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.kind).toBe("transform");
    expect(step.items.map((i) => i.id)).toEqual(pieces);
    expect(step.items[0].to.turn.deg).toBeCloseTo(90 - 45, 6);
    // Piece 2 sits at midAngle 135° and must end pointing down (−90°). The
    // raw difference is −225°, but the delta is tweened linearly, so it is
    // normalised to the equivalent short way round: +135°.
    expect(step.items[1].to.turn.deg).toBeCloseTo(135, 6);
    expect(((((135 + 135) % 360) + 360) % 360)).toBe(270); // …the same final direction as −90°
    expect(plan.states[1].turns.k_1.deg).toBeCloseTo(45, 6);
  });
  test("row on plain elements is a pure translation to a centred row", () => {
    const plan = planCommands([{ draw: ["a", "b"] }, { arrange: { target: ["a", "b"], layout: "row", at: [500, 375], gap: 20 } }], ["a", "b"], {
      bboxOf: (id) => (id === "a" ? { x: 0, y: 0, w: 100, h: 50 } : { x: 900, y: 700, w: 100, h: 50 }),
    });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.items[0].to.offset).toEqual([390, 350]); // a's centre (50,25) → (440,375)
    expect(step.items[1].to.offset).toEqual([-390, -350]); // b's centre (950,725) → (560,375)
    expect(step.items.every((i) => i.to.turn.deg === 0)).toBe(true);
  });
  test("attached labels follow a row translation — once per label, by their element's delta, unturned", () => {
    const plan = planCommands([{ draw: ["a", "b"] }, { arrange: { target: ["a", "b"], layout: "row", at: [500, 375], gap: 20 } }], ["a", "b", "label_a"], {
      bboxOf: (id) => (id === "a" ? { x: 0, y: 0, w: 100, h: 50 } : id === "b" ? { x: 900, y: 700, w: 100, h: 50 } : { x: 0, y: 60, w: 40, h: 20 }),
      // both targets claim the same label, and the list repeats it: it moves ONCE, with a
      attachedTo: (id) => (id === "a" || id === "b" ? ["label_a", "label_a"] : []),
    });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    const label = step.items.filter((i) => i.id === "label_a");
    expect(label).toHaveLength(1);
    expect(label[0].to.offset).toEqual([390, 350]); // a's delta, and both started at [0, 0]
    expect(label[0].to.turn.deg).toBe(0);
    expect(plan.states[1].offsets["label_a"]).toEqual([390, 350]);
  });
  test("a zipper piece's attached label rides the turn — its box centre goes where the piece's new pose puts it, but the text itself does not turn (design §2.2)", () => {
    // label_k_1's box centre is (310, 340), inside k_1's own box.
    const labelBox = { x: 300, y: 335, w: 20, h: 10 };
    const plan = planCommands([{ draw: ["k"] }, { arrange: { target: "k", layout: "zipper", at: [600, 375] } }], [...pieces, "label_k_1"], {
      ...opts,
      bboxOf: (id: string) => (pieces.includes(id) ? { x: 200, y: 300, w: 100, h: 80 } : id === "label_k_1" ? labelBox : null),
      attachedTo: (id: string) => (id === "k_1" ? ["label_k_1"] : []),
    });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.items.map((i) => i.id)).toEqual(["k_1", "label_k_1", "k_2", "k_3", "k_4"]);
    const k1 = step.items.find((i) => i.id === "k_1")!;
    const label = step.items.find((i) => i.id === "label_k_1")!;
    // The text never turns or scales, no matter how far the slice rotates.
    expect(label.to.turn.deg).toBe(0);
    expect(label.to.turn.scale ?? 1).toBe(1);
    // Its box centre lands exactly where k_1's own new pose carries it: P1(c) − P0(c).
    const centre: [number, number] = [labelBox.x + labelBox.w / 2, labelBox.y + labelBox.h / 2];
    const before = poseOf([0, 0], undefined)(centre);
    const after = poseOf(k1.to.offset, k1.to.turn)(centre);
    expect(label.to.offset[0]).toBeCloseTo(after[0] - before[0], 6);
    expect(label.to.offset[1]).toBeCloseTo(after[1] - before[1], 6);
    // A 90°+ swing about the apex moves a box centre well away from its start.
    expect(Math.hypot(label.to.offset[0], label.to.offset[1])).toBeGreaterThan(50);
    expect(plan.states[1].offsets["label_k_1"]).toEqual(label.to.offset);
  });
});

describe("fade", () => {
  test("fade records a persistent opacity and tweens from the previous value", () => {
    const plan = planCommands([{ draw: ["demand_curve"] }, { fade: { target: ["demand_curve"], to: 0.3 } }, { fade: { target: "demand_curve", to: 1, duration: 0.5 } }], allIds);
    const s1 = plan.steps[1] as Extract<PlanStep, { kind: "fade" }>;
    expect(s1.kind).toBe("fade");
    expect(s1.items).toEqual([{ id: "demand_curve", from: 1, to: 0.3 }]);
    expect(s1.seconds).toBe(1);
    expect(plan.states[1].opacities.demand_curve).toBe(0.3);
    const s2 = plan.steps[2] as Extract<PlanStep, { kind: "fade" }>;
    expect(s2.items).toEqual([{ id: "demand_curve", from: 0.3, to: 1 }]);
    expect(s2.seconds).toBe(0.5);
    expect(plan.states[2].opacities.demand_curve).toBe(1);
  });
  test("attached labels fade with their element, once", () => {
    const plan = planCommands([{ draw: ["demand_curve", "label_D"] }, { fade: { target: ["demand_curve"], to: 0.2 } }], allIds, {
      attachedTo: (id) => (id === "demand_curve" ? ["label_D", "label_D"] : []),
    });
    const s = plan.steps[1] as Extract<PlanStep, { kind: "fade" }>;
    expect(s.items.map((i) => i.id)).toEqual(["demand_curve", "label_D"]);
    expect(plan.states[1].opacities.label_D).toBe(0.2);
  });
  test("a pieces id expands and `to` is clamped to 0…1", () => {
    const plan = planCommands([{ draw: ["k"] }, { fade: { target: "k", to: 1.7 } }], ["k_1", "k_2"], { expandId: (id) => (id === "k" ? ["k_1", "k_2"] : null) });
    const s = plan.steps[1] as Extract<PlanStep, { kind: "fade" }>;
    expect(s.items.map((i) => i.id)).toEqual(["k_1", "k_2"]);
    expect(s.items[0].to).toBe(1);
  });
  test("fade on an unknown id is skipped with a warning", () => {
    const plan = planCommands([{ fade: { target: ["nope"], to: 0.5 } }], ["axes"]);
    expect(plan.steps.filter((s) => s.kind === "fade")).toHaveLength(0);
    expect(plan.warnings.join(" ")).toMatch(/fade/);
  });
});

describe("anchors in commands (design §2.1)", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const boxes: Record<string, ReturnType<typeof box>> = { a: box(100, 100, 200, 20), b: box(400, 400, 100, 20), tri: box(0, 0, 100, 100) };
  const named: Record<string, Record<string, [number, number]>> = {
    a: { tail: [100, 110], tip: [300, 110], mid: [200, 110] },
    b: { tail: [400, 410], tip: [500, 410], mid: [450, 410] },
    tri: { vertex_1: [0, 0], vertex_2: [100, 0], vertex_3: [0, 100], side_2: [50, 50], centroid: [100 / 3, 100 / 3] },
  };
  const opts = { bboxOf: (id: string) => boxes[id] ?? null, anchorOf: (id: string, name: string) => named[id]?.[name] ?? null };
  const transformOf = (plan: ReturnType<typeof planCommands>, i = 0) => plan.steps[i] as Extract<PlanStep, { kind: "transform" }>;

  test("move.to {ref, anchor} with move.anchor: b's tail lands on a's tip", () => {
    // drawn first so the "not visible" sanity warning stays out of the way of this assertion
    const plan = planCommands([{ draw: ["a", "b"] }, { move: { target: ["b"], anchor: "tail", to: { ref: "a", anchor: "tip" } } }], ["a", "b"], opts);
    expect(plan.warnings).toEqual([]);
    const it = transformOf(plan, 1).items.find((x) => x.id === "b")!;
    expect(it.to.offset).toEqual([-100, -300]); // tail (400,410) → tip (300,110)
    expect(plan.states[1].offsets.b).toEqual([-100, -300]);
  });
  test("move.pivot {anchor} without ref is the target's own anchor: 180° about side_2 sends vertex_1 to (100,100)", () => {
    const plan = planCommands([{ move: { target: ["tri"], rotate: 180, pivot: { anchor: "side_2" } } }], ["tri"], opts);
    const st = plan.states[0];
    const p = poseOf(st.offsets.tri, st.turns.tri)([0, 0]);
    expect(p[0]).toBeCloseTo(100, 6);
    expect(p[1]).toBeCloseTo(100, 6);
  });
  test("anchors resolve in CURRENT coordinates after an earlier move", () => {
    const plan = planCommands(
      [{ move: { target: ["a"], by: [50, 0] } }, { move: { target: ["b"], anchor: "tail", to: { ref: "a", anchor: "tip" } } }],
      ["a", "b"],
      opts,
    );
    expect(plan.states[1].offsets.b).toEqual([-50, -300]);
  });
  test("an explicit pivot rides with the translation: by + rotate about the element's own centre given as a ref rolls, it does not swing", () => {
    const plan = planCommands([{ move: { target: ["tri"], by: [300, 0], rotate: -360, pivot: { ref: "tri" } } }], ["tri"], opts);
    const it = transformOf(plan).items[0];
    // pivot in the original frame is the centre itself, so a half-way pose is a pure slide + spin about it
    expect(it.to.turn.pivot[0]).toBeCloseTo(50, 6);
    expect(it.to.turn.pivot[1]).toBeCloseTo(50, 6);
    expect(it.to.offset).toEqual([300, 0]);
  });
  test("an explicit pivot is resolved once, from the pre-move state: two targets turning about the first one share its centre", () => {
    const plan = planCommands([{ move: { target: ["a", "b"], by: [300, 0], rotate: -360, pivot: { ref: "a" } } }], ["a", "b"], opts);
    const items = transformOf(plan).items;
    const pa = items.find((x) => x.id === "a")!.to.turn.pivot;
    const pb = items.find((x) => x.id === "b")!.to.turn.pivot;
    // a's centre (200,110) in the original frame. Resolved inside the loop, b
    // used to see a's ALREADY moved centre and swung on a 300-unit circle.
    expect(pa[0]).toBeCloseTo(200, 6);
    expect(pa[1]).toBeCloseTo(110, 6);
    expect(pb[0]).toBeCloseTo(200, 6);
    expect(pb[1]).toBeCloseTo(110, 6);
  });
  test("move.to is resolved once too: two targets sent to the first one's tip both aim at where it started", () => {
    const plan = planCommands([{ move: { target: ["a", "b"], to: { ref: "a", anchor: "tip" } } }], ["a", "b"], opts);
    const items = transformOf(plan).items;
    // a's tip is (300,110); a's own centre (200,110) and b's centre (450,410) both land there
    expect(items.find((x) => x.id === "a")!.to.offset).toEqual([100, 0]);
    expect(items.find((x) => x.id === "b")!.to.offset).toEqual([-150, -300]);
  });
  test("a universal anchor comes off the box; an unknown one warns and uses center; arrange.at takes a ref", () => {
    const plan = planCommands([{ move: { target: ["b"], to: { ref: "tri", anchor: "top_right" } } }], ["b", "tri"], opts);
    expect(plan.states[0].offsets.b).toEqual([100 - 450, 100 - 410]);
    const bad = planCommands([{ move: { target: ["b"], to: { ref: "tri", anchor: "wat" } } }], ["b", "tri"], opts);
    expect(bad.warnings.join(" ")).toMatch(/wat/);
    expect(bad.states[0].offsets.b).toEqual([50 - 450, 50 - 410]);
    const arr = planCommands([{ arrange: { target: ["a", "b"], layout: "row", at: { ref: "tri", anchor: "top" } } }], ["a", "b", "tri"], opts);
    expect(arr.warnings).toEqual([]);
    // row aligns every item's centre to the resolved at[1] (tri's top, y=100): each item's
    // FINAL y (its own raw centre plus the offset row gave it) lands on that same line.
    const ys = transformOf(arr).items.map((it) => it.to.offset[1] + boxes[it.id].y + boxes[it.id].h / 2);
    expect(ys.every((y) => Math.abs(y - ys[0]) < 1e-6)).toBe(true);
  });
  test("point.at and camera.center aim at an anchor", () => {
    const plan = planCommands([{ point: { at: { ref: "a", anchor: "tip" } } }, { camera: { center: { ref: "a", anchor: "tip" }, zoom: 4 } }], ["a"], opts);
    expect(plan.steps[0]).toMatchObject({ kind: "point", x: 300, y: 110 });
    const cam = plan.steps[1] as Extract<PlanStep, { kind: "camera" }>;
    expect(cam.box!.x + cam.box!.w / 2).toBeCloseTo(300, 6); // (300,110) at zoom 4 stays inside the canvas clamp
  });
});

describe("isExplicitPointRef", () => {
  test("arrays, refs and x+y are explicit; a ref-less anchor is not", () => {
    expect(isExplicitPointRef([1, 2])).toBe(true);
    expect(isExplicitPointRef({ ref: "a" })).toBe(true);
    expect(isExplicitPointRef({ x: 1, y: 2 })).toBe(true);
    expect(isExplicitPointRef({ anchor: "vertex_2" })).toBe(false);
    expect(isExplicitPointRef(undefined)).toBe(false);
  });
});
