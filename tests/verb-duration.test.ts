// `duration` written beside a verb rather than inside it (2026-10-05): the
// schema documents a duration on highlight (and on every verb that declares
// one), and a book's author wrote `{highlight: {target: bar_1}, duration: 2}`
// — validation said "duration only applies to animate". The command's
// duration is the verb's when the verb takes one and sets none itself.
import { describe, expect, test } from "vitest";
import { specSchema, validateSpec } from "../src/spec/schema";
import { foldVerbDuration, VERBS_WITH_DURATION } from "../src/spec/verb-duration";
import { planCommands } from "../src/render/plan";
import type { Command, Spec } from "../src/spec/types";

const els = [{ id: "a", type: "text", text: "a", x: 100, y: 100 }];
const valid = (cmd: unknown) => validateSpec({ elements: els, commands: [cmd] } as unknown as Spec);

describe("a duration beside the verb", () => {
  test("is accepted on highlight, and the plan holds it that long", () => {
    expect(valid({ highlight: { target: "a" }, duration: 2 })).toEqual({ ok: true, errors: [] });
    const step = planCommands([{ draw: ["a"] }, { highlight: { target: ["a"] }, duration: 2, speak: "Look." } as Command], ["a"]).steps.find((s) => s.kind === "highlight");
    expect(step).toMatchObject({ seconds: 2 });
    expect(step && "untilNarrationEnd" in step ? step.untilNarrationEnd : undefined).toBeFalsy();
  });

  test("the verb's own duration wins; a verb with no duration still refuses it", () => {
    expect(foldVerbDuration({ highlight: { target: ["a"], duration: 1 }, duration: 3 } as Command)).toEqual({ highlight: { target: ["a"], duration: 1 } });
    expect(valid({ draw: ["a"], duration: 2 }).ok).toBe(false);
    expect(valid({ animate: { k: 1 }, duration: 2 }).errors.some((e) => /duration/.test(e))).toBe(false);
  });

  test("the verbs that fold are the ones whose schema declares a duration", () => {
    const props = (specSchema as unknown as { properties: { commands: { items: { properties: Record<string, { properties?: object; oneOf?: { properties?: object }[] }> } } } }).properties.commands.items.properties;
    const declared = Object.entries(props).filter(([, v]) => "duration" in (v?.properties ?? v?.oneOf?.find((o) => o.properties)?.properties ?? {})).map(([k]) => k);
    expect([...VERBS_WITH_DURATION].sort()).toEqual(declared.sort());
  });
});
