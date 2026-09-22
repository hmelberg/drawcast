// The prose gate (wantsCode / wantsSound) has withheld the 17.5k code block
// and the 1.4k sound block since the code round. The schema did not follow,
// so a request the prompt had already decided was not about code still
// carried the whole code element — and was CONSTRAINED to a schema that
// allowed one. Design §3.3.
import { describe, expect, test } from "vitest";
import { apiSchema } from "../src/llm/compile";
import { CODE_ONLY_ELEMENT_PROPS, SOUND_ONLY_COMMAND_PROPS } from "../src/spec/schema";

const props = (s: object) => (s as any).properties.elements.items.properties;
const cmds = (s: object) => (s as any).properties.commands.items.properties;

describe("the schema's code and sound halves", () => {
  test("the code key list is derived from the descriptions, not hand-kept", () => {
    // Every element property whose description begins "code:" is code-only.
    // Measured 2026-09-22: 14 of them. `width` mentions code but describes
    // six element types, so the prefix — not the word — is the rule.
    const all = props(apiSchema());
    const derived = Object.keys(all).filter((k) => /^code(\/| |:)/.test(all[k].description ?? ""));
    expect([...CODE_ONLY_ELEMENT_PROPS].sort()).toEqual(derived.sort());
    expect(CODE_ONLY_ELEMENT_PROPS).toContain("controls");
    expect(CODE_ONLY_ELEMENT_PROPS).not.toContain("width");
  });

  // Same guard, for the play verb's command properties. Caught a real gap
  // while implementing this task: a draft SOUND_ONLY_COMMAND_PROPS of
  // ["play", "instrument", "tempo"] passed every test the brief specified,
  // yet left `press` and `reveal` — both validated together with
  // tempo/instrument as play-only in this schema's own semantic checks
  // ("tempo, instrument, press and reveal only apply to a play command") —
  // sitting in a soundless request's schema. `play` itself doesn't carry the
  // "With play:" prefix (it IS the verb, not a property of it), so it is
  // added explicitly rather than derived.
  test("the sound key list is derived from the descriptions too", () => {
    const all = cmds(apiSchema());
    const derived = Object.keys(all).filter((k) => /^With play:/.test(all[k].description ?? ""));
    expect(["play", ...derived].sort()).toEqual([...SOUND_ONLY_COMMAND_PROPS].sort());
  });

  test("no gate asked for means the whole schema, as before", () => {
    expect(JSON.stringify(apiSchema())).toEqual(JSON.stringify(apiSchema({ code: true, sound: true })));
  });

  test("a code-less request is not handed the code element", () => {
    const s = apiSchema({ code: false, sound: true });
    expect(props(s).type.enum).not.toContain("code");
    for (const k of CODE_ONLY_ELEMENT_PROPS) expect(props(s)[k]).toBeUndefined();
    // and the sound half is untouched by the code gate
    expect(cmds(s).play).toBeDefined();
  });

  test("a soundless request is not handed the play verb", () => {
    const s = apiSchema({ code: true, sound: false });
    for (const k of SOUND_ONLY_COMMAND_PROPS) expect(cmds(s)[k]).toBeUndefined();
    expect(props(s).type.enum).toContain("code");
  });

  test("the gate is worth what it claims", () => {
    const full = JSON.stringify(apiSchema()).length;
    const bare = JSON.stringify(apiSchema({ code: false, sound: false })).length;
    expect(full - bare).toBeGreaterThan(9_000);
  });

  // The failure this gate could introduce, in one assertion: the prompt's
  // {{SCHEMA}} and the structured-output constraint are built from the same
  // object, so a request that gets the code element in one gets it in both.
  // The brief's original version of this test asserted every
  // /apiSchema\([^)]*\)/g match in compile.ts equalled the gated call — but
  // apiSchema is DEFINED in that file (src/llm/compile.ts), so its own
  // signature is itself a match and the assertion fails against a correct
  // implementation. Asserting on the stricter `apiSchema({...})` call shape
  // instead (which the definition's `apiSchema(opts: {...} = {})` never
  // matches, since "{" is not the character right after the opening paren)
  // sidesteps that, and separately banning a bare `apiSchema()` call in this
  // file makes the invariant stronger, not weaker: every call site in
  // compile.ts must both pass flags AND pass the same two flags.
  test("the prompt's schema and the constraint are the same object", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync("src/llm/compile.ts", "utf8"));
    const calls = src.match(/apiSchema\(\{[^}]*\}\)/g) ?? [];
    expect(calls.length, "every apiSchema call in compile.ts").toBeGreaterThan(0);
    for (const c of calls) expect(c).toBe("apiSchema({ code: wantCode, sound: wantSound })");
    expect(src).not.toMatch(/apiSchema\(\)/);
  });
});
