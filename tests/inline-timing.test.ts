import { describe, expect, test } from "vitest";
import { scanLines } from "../src/spec/script/lines";

const speech = (text: string) => scanLines(text)[0] as { text: string; actions?: { head: string; rest: string; offset: number }[] };

describe("lifting an action out of a line", () => {
  test("the spoken text is the line without the span", () => {
    const l = speech("Pengene går rundt (@arrow a -> b@) og tilbake.\n");
    expect(l.text).toBe("Pengene går rundt og tilbake.");
    expect(l.actions).toEqual([{ head: "arrow", rest: "a -> b", offset: "Pengene går rundt".length }]);
  });

  test("several actions keep their order and their places", () => {
    const l = speech("Først (@draw a@) så (@draw b@) ferdig.\n");
    expect(l.text).toBe("Først så ferdig.");
    expect(l.actions!.map((a) => a.rest)).toEqual(["a", "b"]);
    expect(l.actions![0].offset).toBeLessThan(l.actions![1].offset);
  });

  test("an action at the very start has offset 0", () => {
    const l = speech("(@camera zoom 2@) Se her.\n");
    expect(l.text).toBe("Se her.");
    expect(l.actions![0].offset).toBe(0);
  });

  test("a line with no action is untouched", () => {
    expect(speech("Helt vanlig prosa.\n").actions).toBeUndefined();
  });

  test("a parenthesis followed by an at-sign in prose is prose", () => {
    const l = speech("Skriv (@ hvis du vil) videre.\n");
    expect(l.text).toBe("Skriv (@ hvis du vil) videre.");
    expect(l.actions).toBeUndefined();
  });

  test("an unclosed span names its line", () => {
    expect(() => scanLines("Pengene (@arrow a -> b går rundt.\n")).toThrow(/line 1/);
  });
});

import { parseScriptPages } from "../src/spec/script/parse";
import { printScriptPages } from "../src/spec/script/print";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const one = (text: string) => parseScriptPages(text).pages[0].spec;

describe("the cue", () => {
  test("an action inside a line becomes a command with a cue", () => {
    const spec = one("Pengene går rundt (@camera zoom 2@) og tilbake.\n");
    expect(spec.commands).toHaveLength(1);
    const cmd = spec.commands![0];
    expect(cmd.speak).toBe("Pengene går rundt og tilbake.");
    expect(cmd.camera).toEqual({ zoom: 2 });
    expect(cmd.cue).toBeCloseTo("Pengene går rundt".length / "Pengene går rundt og tilbake.".length, 6);
  });

  test("two actions are two commands, in the order they are heard", () => {
    const spec = one("Først (@camera zoom 2@) så (@camera reset true@) ferdig.\n");
    expect(spec.commands).toHaveLength(2);
    expect(spec.commands![0].cue!).toBeLessThan(spec.commands![1].cue!);
    expect(spec.commands![0].speak).toBe("Først så ferdig.");
    expect(spec.commands![1].speak).toBeUndefined();
  });

  test("an indented direction comes first and has no cue", () => {
    const spec = one("Se her (@camera zoom 2@) nå.\n    draw a\n");
    expect(spec.commands![0]).toMatchObject({ draw: ["a"], speak: "Se her nå." });
    expect(spec.commands![0].cue).toBeUndefined();
    expect(spec.commands![1]).toMatchObject({ camera: { zoom: 2 } });
  });

  test("a cue outside 0–1 is refused", () => {
    expect(validateSpec({ commands: [{ speak: "hei", camera: { zoom: 2 }, cue: 1.5 }], elements: [] }).ok).toBe(false);
  });
});

describe("printing a cue back inside its line", () => {
  test("print → parse → print is stable", () => {
    const source = "Pengene går rundt (@camera zoom 2@) og tilbake.\n";
    const spec = one(source);
    expect(printScriptPages({}, [{ spec }])).toBe(source);
  });

  test("an action at the start prints at the start", () => {
    const source = "(@camera zoom 2@) Se her.\n";
    expect(printScriptPages({}, [{ spec: one(source) }])).toBe(source);
  });

  test("an uncued command still prints on its own line", () => {
    const spec: Spec = { commands: [{ speak: "Hei.", camera: { zoom: 2 } }] };
    expect(printScriptPages({}, [{ spec }])).toBe("Hei.\n    camera zoom 2\n");
  });

  test("both forms in one beat: the indented one first, the cued one inside the line", () => {
    const source = "Se her (@camera zoom 2@) nå.\n    draw a\n";
    expect(printScriptPages({}, [{ spec: one(source) }])).toBe(source);
  });
});

import { planCommands } from "../src/render/plan";
import { layoutSpec } from "../src/layout/layout";

describe("the plan carries the cue to the player", () => {
  const planOf = (spec: Spec) => planCommands(spec.commands ?? [], layoutSpec(spec).order);

  test("a cued command's step knows when to start", () => {
    const spec = one('Se her (@camera zoom 2@) nå.\n    draw a\n    dot a x 1 y 2 hidden true\n');
    const plan = planOf(spec);
    const cued = plan.steps.find((s) => s.kind === "camera")!;
    expect((cued as { cue?: number }).cue).toBeGreaterThan(0);
  });

  test("an uncued command's step carries none", () => {
    const spec: Spec = {
      elements: [{ id: "a", type: "point", x: 1, y: 2 }],
      commands: [{ draw: ["a"], speak: "Hei." }],
    };
    const step = planOf(spec).steps.find((s) => s.kind === "draw")!;
    expect((step as { cue?: number }).cue).toBeUndefined();
  });
});
