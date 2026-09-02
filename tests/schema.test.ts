import { describe, expect, test } from "vitest";
import { isBlankSpec, validateSpec  } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const goodSpec: Spec = {
  template: "supply_demand",
  params: { demand: { label: "D" }, supply: { label: "S" }, equilibrium: { show: true } },
  commands: [
    { speak: "Start with the axes." },
    { draw: ["axes"] },
    { draw: ["demand_curve", "label_D"] },
    { pause: 1 },
  ],
};

describe("validateSpec", () => {
  test("accepts a valid templated spec", () => {
    const r = validateSpec(goodSpec);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  test("accepts a draw command given as a bare string", () => {
    const r = validateSpec({ template: "supply_demand", commands: [{ draw: "axes" }] });
    expect(r.ok).toBe(true);
  });

  test("speak paired with draw is a narrated action (valid); two actions are not", () => {
    expect(validateSpec({ elements: [{ id: "axes", type: "axes" }], commands: [{ speak: "hi", draw: ["axes"] }] }).ok).toBe(true);
    const r = validateSpec({ commands: [{ draw: ["axes"], pause: 1 }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/at most one action/i);
  });

  test("rejects a command with none of speak/draw/pause", () => {
    const r = validateSpec({ commands: [{ parallel: true }] });
    expect(r.ok).toBe(false);
  });

  test("rejects a curve element with neither qualitative shape nor expr", () => {
    const r = validateSpec({
      elements: [{ id: "c1", type: "curve" }],
      commands: [{ draw: ["c1"] }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/c1/);
  });

  test("rejects duplicate element ids", () => {
    const r = validateSpec({
      elements: [
        { id: "a", type: "text", text: "x", x: 10, y: 10 },
        { id: "a", type: "text", text: "y", x: 20, y: 20 },
      ],
      commands: [{ draw: ["a"] }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/duplicate/i);
  });

  test("rejects a label without attach_to", () => {
    const r = validateSpec({
      elements: [{ id: "l1", type: "label", text: "hello" }],
      commands: [{ draw: ["l1"] }],
    });
    expect(r.ok).toBe(false);
  });

  test("reports structural (ajv) errors for wrong types", () => {
    const r = validateSpec({ commands: [{ pause: "long" }] });
    expect(r.ok).toBe(false);
  });

  test("rejects a spec with neither template nor elements", () => {
    const r = validateSpec({ commands: [{ speak: "nothing to draw" }] });
    expect(r.ok).toBe(false);
  });

  test("the empty spec stays INVALID here — generation must repair, never ship a silent blank; the editor admits it via isBlankSpec", () => {
    expect(validateSpec({ elements: [], commands: [] }).ok).toBe(false);
    expect(isBlankSpec({ elements: [], commands: [] })).toBe(true);
    expect(isBlankSpec({ elements: [], commands: [{ speak: "hi" }] } as never)).toBe(false);
    expect(isBlankSpec({ template: "supply_demand", commands: [] } as never)).toBe(false);
  });
});

describe("validateSpec — gesture verbs", () => {
  const base = { template: "supply_demand" };

  test("accepts every new verb in valid form", () => {
    const r = validateSpec({
      ...base,
      commands: [
        { speak: "look here", blocking: false },
        { point: { at: { ref: "eq" }, gesture: "circle" } },
        { highlight: { target: ["demand_curve"], effect: "pulse", duration: 2, color: "#c00" } },
        { move: { target: ["demand_curve"], by: [10, 0], easing: "ease-out" } },
        { move: { target: ["dot"], path: [[5, 5], [10, 0]] } },
        { show: ["guides"] },
        { hide: ["guides"] },
        { erase: ["note"], parallel: true },
        { clear: { keep: ["axes"] } },
        { camera: { center: { ref: "eq" }, zoom: 2 } },
        { camera: { reset: true } },
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test("accepts bare-string targets on the new verbs", () => {
    const r = validateSpec({
      ...base,
      commands: [{ hide: "guides" }, { highlight: { target: "demand_curve" } }, { move: { target: "dot", by: [1, 1] } }],
    });
    expect(r.ok).toBe(true);
  });

  test("rejects two action verbs on one command", () => {
    const r = validateSpec({ ...base, commands: [{ hide: ["a"], show: ["b"] }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/at most one action/i);
  });

  test("rejects blocking on a non-speak command", () => {
    const r = validateSpec({ ...base, commands: [{ draw: ["axes"], blocking: false }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/blocking/);
  });

  test("rejects a move without by or path", () => {
    const r = validateSpec({ ...base, commands: [{ move: { target: ["a"] } }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/by|path/);
  });

  test("rejects a point without a resolvable at", () => {
    const r = validateSpec({ ...base, commands: [{ point: { at: { x: 5 } } }] });
    expect(r.ok).toBe(false);
  });

  test("rejects a camera with no center/zoom/reset", () => {
    const r = validateSpec({ ...base, commands: [{ camera: {} }] });
    expect(r.ok).toBe(false);
  });

  test("animate command validates: numeric targets, duration only with animate", () => {
    const ok = validateSpec({
      template: "supply_demand",
      params: { demand_shift: { amount: 0 } },
      commands: [{ animate: { "demand_shift.amount": 20 }, duration: 3, speak: "watch it slide" }],
    });
    expect(ok.ok).toBe(true);
    const badValue = validateSpec({
      template: "supply_demand",
      params: {},
      commands: [{ animate: { "demand_shift.amount": "right" as unknown as number } }],
    });
    expect(badValue.ok).toBe(false);
    const strayDuration = validateSpec({
      template: "supply_demand",
      params: {},
      commands: [{ draw: ["axes"], duration: 2 }],
    });
    expect(strayDuration.ok).toBe(false);
    const twoVerbs = validateSpec({
      template: "supply_demand",
      params: {},
      commands: [{ animate: { a: 1 }, draw: ["axes"] }],
    });
    expect(twoVerbs.ok).toBe(false);
  });
});

describe("voice and delivery", () => {
  test("valid: spec voice, command voice+delivery with speak", () => {
    const r = validateSpec({
      voice: "male",
      elements: [{ id: "c1", type: "curve", direction: "decreasing" }],
      commands: [{ draw: ["c1"], speak: "Here.", voice: "b", delivery: "grave" }],
    });
    expect(r.errors).toEqual([]);
  });
  test("voice/delivery without speak is a semantic error", () => {
    const r = validateSpec({
      elements: [{ id: "c1", type: "curve", direction: "decreasing" }],
      commands: [{ draw: ["c1"], voice: "b" }],
    });
    expect(r.errors.join(" ")).toContain("voice and delivery only apply");
  });
  test("bad enum rejected structurally", () => {
    const r = validateSpec({ voice: "robot", elements: [{ id: "c1", type: "curve", direction: "decreasing" }] });
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("element links", () => {
  const withLink = (link: unknown) => ({
    elements: [{ id: "book", type: "shape", shape: "rect", x: 100, y: 100, width: 80, height: 120, link }],
    commands: [{ draw: ["book"] }],
  });

  test("an array of https links is valid; a bare string normalizes to one", () => {
    expect(validateSpec(withLink(["https://x.org/won.pdf", "https://youtu.be/dQw4w9WgXcQ"])).ok).toBe(true);
    expect(validateSpec(withLink("https://x.org/won.pdf")).ok).toBe(true);
  });

  test("more than four links is a structural error", () => {
    const r = validateSpec(withLink(["https://a.org/1", "https://a.org/2", "https://a.org/3", "https://a.org/4", "https://a.org/5"]));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/link/);
  });

  test("a non-http link is a semantic error", () => {
    const r = validateSpec(withLink(["javascript:alert(1)"]));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/http/);
  });
});
