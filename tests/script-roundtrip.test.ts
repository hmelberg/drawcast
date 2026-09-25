// The contract the whole format rests on: what the printer writes, the parser
// reads back into the same spec. Held against every cast the app ships —
// 258 bundled examples and every scene pack's manifest examples — because a
// format that round-trips its own toy tests and not the real corpus is a
// format that will lose someone's work.
import { beforeAll, describe, expect, test } from "vitest";
import bundledExamples from "../src/examples.json";
import { parseScriptPages } from "../src/spec/script/parse";
import { printScriptPages } from "../src/spec/script/print";
import { normalizeSpec } from "../src/spec/schema";
import { scenes } from "../src/scenes/registry";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import type { Spec } from "../src/spec/types";

/** Key order carries no meaning in a spec, so compare canonically. */
const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const bundled = (bundledExamples as { spec?: Spec }[]).filter((e) => e.spec).map((e) => e.spec!);

/**
 * A pack's manifest examples are `{request, params}`, not whole specs — so
 * each becomes the spec it stands for: that template with those params. That
 * is the corpus worth having here anyway, because template params are the
 * deepest structures in the app (empty objects, arrays of objects, nested
 * maps) and they all travel through the `with:` setting.
 */
function packSpecs(): Spec[] {
  const out: Spec[] = [];
  const all = scenes as unknown as Record<string, { manifest?: { examples?: { params?: unknown }[] } }>;
  for (const id of Object.keys(all)) {
    for (const ex of all[id]?.manifest?.examples ?? []) {
      if (ex?.params === undefined) continue;
      out.push({ title: id, template: id, params: ex.params as Record<string, unknown>, commands: [{ speak: "Hei." }] });
    }
  }
  return out;
}

const check = (specs: Spec[]): { broken: string[]; unstable: string[] } => {
  const broken: string[] = [];
  const unstable: string[] = [];
  specs.forEach((spec, i) => {
    const name = spec.title ?? `#${i}`;
    let once = "";
    try {
      once = printScriptPages({}, [{ spec }]);
      const back = parseScriptPages(once).pages[0].spec;
      if (!same(normalizeSpec(back), normalizeSpec(spec))) broken.push(`${name}: differs after the round trip`);
      const twice = printScriptPages({}, [{ spec: back }]);
      if (twice !== once) unstable.push(name);
    } catch (err) {
      broken.push(`${name}: ${(err as Error).message}`);
    }
  });
  return { broken, unstable };
};

describe("the round trip over the bundled corpus", () => {
  const result = check(bundled);
  test("every bundled example survives print → parse unchanged", () => {
    expect(result.broken).toEqual([]);
  });
  test("printing is stable across a second pass", () => {
    expect(result.unstable).toEqual([]);
  });
  test("the corpus is actually there", () => {
    expect(bundled.length).toBeGreaterThan(250);
  });
});

describe("the round trip over the scene packs", () => {
  let result: { broken: string[]; unstable: string[] };
  let count = 0;
  beforeAll(async () => {
    await ensureEnabledPacks(Object.keys(PACK_DEFS));
    const specs = packSpecs();
    count = specs.length;
    result = check(specs);
  });
  test("every pack example survives print → parse unchanged", () => {
    expect(result.broken).toEqual([]);
  });
  test("printing is stable across a second pass", () => {
    expect(result.unstable).toEqual([]);
  });
  test("the packs are actually loaded", () => {
    expect(count).toBeGreaterThan(0);
  });
});

describe("the data coordinate forms survive the round trip (2026-09-25)", () => {
  test("at {data}, arrow ends {data}, path data: true, verb points {data}", () => {
    const spec = {
      title: "data forms",
      template: "survival_curve",
      params: { arms: [{ label: "A", survival: [1, 0.8, 0.6] }] },
      elements: [
        { id: "note", type: "text", text: "half", at: { data: [1, 0.5] } },
        { id: "mark", type: "point", at: { data: [2, 0.6] } },
        { id: "arr", type: "arrow", from: { data: [0, 0] }, to: { data: [2, 0.6] } },
        { id: "band", type: "path", data: true, points: [[0, 0.5], [2, 0.5]] },
      ],
      commands: [{ draw: ["note", "mark", "arr", "band"] }, { point: { at: { data: [1, 0.8] } } }, { camera: { center: { data: [1, 0.5] }, zoom: 1.5 } }],
    } as unknown as Spec;
    expect(check([spec])).toEqual({ broken: [], unstable: [] });
  });
});

describe("a derivation survives the round trip (2026-09-25)", () => {
  test("math steps (strings and {tex, note}), step by name and step in place", () => {
    const spec = {
      title: "derivation",
      elements: [{ id: "eq", type: "math", tex: "2x + 3 = 11", x: 300, y: 560, steps: ["2x = 8", { tex: "x = 4", note: "halve both sides" }], step_gap: 100 }],
      commands: [{ draw: ["eq"] }, { step: "eq", speak: "Take three." }, { step: { target: "eq", in_place: true, duration: 2 } }],
    } as unknown as Spec;
    expect(check([spec])).toEqual({ broken: [], unstable: [] });
  });
});
