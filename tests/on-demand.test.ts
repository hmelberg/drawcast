// Template on demand, pure halves and the orchestration with injected steps.
import { afterEach, describe, expect, test } from "vitest";
import { authorOnDemand, buildBriefMessages, BRIEF_SCHEMA, freehandSummary, parseBrief } from "../src/llm/on-demand";
import { structuredOutputSupported } from "../src/llm/client";
import { scenes } from "../src/scenes/registry";
import type { Spec } from "../src/spec/types";
import type { TemplateDoc } from "../src/scenes/doc";
import type { GenerationOutcome } from "../src/llm/compile";

const freehand = {
  title: "The sailing boat",
  elements: [
    { id: "hull", type: "path", points: [[100, 100], [900, 100]] },
    { id: "hull_lbl", type: "label", text: "Hull", attach_to: "hull" },
    { id: "cap", type: "text", text: "A boat is a lever on water", x: 500, y: 700 },
  ],
  commands: [{ draw: ["hull"] }],
} as unknown as Spec;

function doc(id: string): TemplateDoc {
  return {
    template: id, version: 1, kit: 1, status: "ready", description: "A boat. Choose this for boats.",
    params: {}, element_ids: {}, examples: [{ request: "Draw a boat.", params: {} }],
    layout: `return { drawables: [], labels: [], anchors: {}, order: [] };`,
  };
}
const added: string[] = [];
afterEach(() => {
  for (const id of added.splice(0)) delete scenes[id];
});

describe("the brief", () => {
  test("the summary names the freehand elements, their words and attachments", () => {
    const s = freehandSummary(freehand);
    expect(s).toContain("Title: The sailing boat");
    expect(s).toContain('- hull_lbl (label) "Hull" → hull');
    expect(s).toContain('- cap (text) "A boat is a lever on water"');
  });
  test("messages carry the request, the summary and the taken ids", () => {
    const m = buildBriefMessages("Show the parts of a sailing boat.", freehand, ["supply_demand"]);
    expect(m.system).toContain("Taken ids: supply_demand");
    expect(m.user).toContain("Request: Show the parts of a sailing boat.");
    expect(m.user).toContain("Elements the freehand drawing used");
  });
  test("parseBrief accepts a legal untaken id with a real description, rejects the rest", () => {
    const long = "A sailing boat seen from the side with hull, keel, rudder, mast, boom, mainsail and jib as named parts.";
    expect(parseBrief({ id: "sailing_boat", description: long }, ["supply_demand"])).toEqual({ id: "sailing_boat", description: long });
    expect(parseBrief({ id: "Sailing Boat", description: long }, [])).toBeNull();
    expect(parseBrief({ id: "supply_demand", description: long }, ["supply_demand"])).toBeNull();
    expect(parseBrief({ id: "sailing_boat", description: "short" }, [])).toBeNull();
    expect(parseBrief(null, [])).toBeNull();
  });
  test("the brief schema is closed for structured outputs", () => {
    expect(structuredOutputSupported(BRIEF_SCHEMA)).toBe(true);
  });
});

describe("authorOnDemand", () => {
  const outcomeWith = (spec: Spec | null): GenerationOutcome => ({ spec, rounds: [], systemPromptChars: 0 });
  const brief = { id: "sailing_boat", description: "A sailing boat with hull, keel, rudder, mast, boom, mainsail and jib as named parts, labels as a list param." };

  test("brief → author → register → redraw, and the template rides in the spec", async () => {
    added.push("sailing_boat");
    const calls: string[] = [];
    const r = await authorOnDemand("Show the parts of a sailing boat.", freehand, {
      apiKey: "k", model: "claude-opus-5",
      describe: async () => { calls.push("brief"); return { brief, meta: { ms: 1, structuredOutput: true } }; },
      author: async (description) => {
        calls.push("author");
        expect(description).toContain('Use the template id "sailing_boat"');
        expect(description).toContain(brief.description);
        return { doc: doc("sailing_boat"), yaml: "template: sailing_boat\n", rounds: [{ label: "initial", doc: {}, errors: [], lintIssues: [], meta: { ms: 1, structuredOutput: false } }], history: [] };
      },
      register: (yaml) => { calls.push("register:" + yaml.split("\n")[0]); return { ok: true, id: "sailing_boat", errors: [] }; },
      generate: async (request, forced) => { calls.push(`generate:${forced}`); return outcomeWith({ title: request, template: forced, params: {}, commands: [] } as unknown as Spec); },
    });
    expect(calls).toEqual(["brief", "author", "register:template: sailing_boat", "generate:sailing_boat"]);
    expect(r.error).toBeUndefined();
    expect(r.authorRounds).toBe(1);
    expect(r.outcome?.spec?.template).toBe("sailing_boat");
    expect(r.outcome?.spec?.templates?.[0].template).toBe("sailing_boat");
  });

  test("no usable brief: stops before authoring", async () => {
    let authored = false;
    const r = await authorOnDemand("x", freehand, {
      apiKey: "k", model: "m",
      describe: async () => ({ brief: null, meta: { ms: 1, structuredOutput: true } }),
      author: async () => { authored = true; throw new Error("unreachable"); },
      generate: async () => outcomeWith(null),
    });
    expect(authored).toBe(false);
    expect(r.error).toMatch(/brief/);
    expect(r.outcome).toBeNull();
  });

  test("authoring failure: no registration, no redraw, the author's error surfaces", async () => {
    const calls: string[] = [];
    const r = await authorOnDemand("x", freehand, {
      apiKey: "k", model: "m",
      describe: async () => ({ brief, meta: { ms: 1, structuredOutput: true } }),
      author: async () => ({ doc: null, yaml: null, rounds: [{}, {}, {}] as never, history: [], error: "The model never produced a working template (see rounds)." }),
      register: () => { calls.push("register"); return { ok: true, errors: [] }; },
      generate: async () => { calls.push("generate"); return outcomeWith(null); },
    });
    expect(calls).toEqual([]);
    expect(r.authorRounds).toBe(3);
    expect(r.error).toMatch(/never produced/);
  });

  test("registration refused (id owned by a built-in): no redraw", async () => {
    const r = await authorOnDemand("x", freehand, {
      apiKey: "k", model: "m",
      describe: async () => ({ brief, meta: { ms: 1, structuredOutput: true } }),
      author: async () => ({ doc: doc("sailing_boat"), yaml: "template: sailing_boat\n", rounds: [], history: [] }),
      register: () => ({ ok: false, id: "sailing_boat", errors: ["\"sailing_boat\" is a built-in"] }),
      generate: async () => { throw new Error("unreachable"); },
    });
    expect(r.error).toMatch(/could not be registered/);
    expect(r.doc?.template).toBe("sailing_boat");
  });

  test("a redraw that yields no spec reports the generation error and embeds nothing", async () => {
    const r = await authorOnDemand("x", freehand, {
      apiKey: "k", model: "m",
      describe: async () => ({ brief, meta: { ms: 1, structuredOutput: true } }),
      author: async () => ({ doc: doc("sailing_boat"), yaml: "y", rounds: [], history: [] }),
      register: () => ({ ok: true, errors: [] }),
      generate: async () => ({ ...outcomeWith(null), error: "cancelled" }),
    });
    expect(r.error).toBe("cancelled");
    expect(r.outcome?.spec).toBeNull();
  });
});
