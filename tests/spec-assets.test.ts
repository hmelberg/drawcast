// Hans 2026-09-10: base64 photos and long point lists made a spec hard to
// move around in. Two spec-level answers: an OPTIONAL `assets:` map written
// last, referenced as `strokes: "@name"`, and number pairs on one line.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { assetRef, hoistStrokes, inlineStrokes, resolveAssetRefs, specForDump } from "../src/spec/assets";
import { compactPointPairs, dumpSpecYaml, formatSpec, parseSpecText } from "../src/spec/text";
import { normalizeSpec, validateSpec } from "../src/spec/schema";
import { formatPlaylist, parsePlaylistText, singlePlaylist } from "../src/playlist/playlist";
import { layoutSpec } from "../src/layout/layout";
import { resolveImages } from "../src/render/image";
import { HOISTED, hoistPortraitStrokes, restorePortraitStrokes } from "../src/llm/hoist";
import type { Spec } from "../src/spec/types";

const examples = JSON.parse(readFileSync(new URL("../src/examples.json", import.meta.url), "utf8")) as { title: string; spec?: Spec; playlist?: string }[];
/** A real embedded photo string, borrowed from a bundled example. */
const PHOTO = examples.find((e) => e.title === "Fargen forteller høyden")!.spec!.elements!.find((e) => e.id === "foto")!.strokes!;

describe("compactPointPairs", () => {
  test("a pair nested in a list, and a pair under a key, each go on one line", () => {
    const yaml = ["points:", "  - - 10", "    - 20", "  - - -3.5", "    - 4e2", "domain:", "  x:", "    - 0", "    - 30", ""].join("\n");
    expect(compactPointPairs(yaml)).toBe(["points:", "  - [10, 20]", "  - [-3.5, 4e2]", "domain:", "  x: [0, 30]", ""].join("\n"));
  });
  test("a triple and a list of words are left alone", () => {
    const yaml = ["rgb:", "  - 1", "  - 2", "  - 3", "draw:", "  - a", "  - b", ""].join("\n");
    expect(compactPointPairs(yaml)).toBe(yaml);
  });
  test("every bundled example survives the round trip unchanged", () => {
    for (const e of examples) {
      if (e.spec) expect(parseSpecText(formatSpec(e.spec, "yaml")).value, e.title).toEqual(e.spec);
      if (e.playlist) {
        const pl = parsePlaylistText(e.playlist);
        expect(parsePlaylistText(formatPlaylist(pl, "yaml")), e.title).toEqual(pl);
      }
    }
  });
  test("a path of points is one line per point in the editor", () => {
    const yaml = dumpSpecYaml({ elements: [{ id: "p", type: "path", points: [[1, 2], [3, 4], [5, 6]] }], commands: [] });
    expect(yaml).toContain("points: [[1, 2], [3, 4], [5, 6]]".length > 0 ? "- [1, 2]\n" : "");
    expect(yaml.split("\n").filter((l) => l.includes("- [")).length).toBe(3);
  });
});

describe("assets: a strokes reference and the map it points into", () => {
  const spec: Spec = {
    elements: [{ id: "foto", type: "image", of: "Honeycomb", width: 300, x: 500, y: 400, strokes: "@foto" }],
    commands: [{ draw: ["foto"] }],
    assets: { foto: PHOTO },
  };

  test("assetRef and inlineStrokes read through the map; inline bytes read as themselves", () => {
    expect(assetRef("@foto")).toBe("foto");
    expect(assetRef(PHOTO)).toBeNull();
    expect(inlineStrokes(spec, spec.elements![0])).toBe(PHOTO);
    expect(inlineStrokes({ assets: {} }, { strokes: "@nope" })).toBeUndefined();
    expect(inlineStrokes({}, { strokes: PHOTO })).toBe(PHOTO);
  });

  test("normalizeSpec inlines the bytes, so the layout draws exactly what an inline spec draws", () => {
    const normalized = normalizeSpec(spec) as Spec;
    expect(normalized.elements![0].strokes).toBe(PHOTO);
    const inline: Spec = { ...spec, assets: undefined, elements: [{ ...spec.elements![0], strokes: PHOTO }] };
    expect(JSON.stringify(layoutSpec(spec).drawables)).toBe(JSON.stringify(layoutSpec(inline).drawables));
  });

  test("the validator accepts the map and reports a reference into nothing", () => {
    expect(validateSpec(spec).ok).toBe(true);
    const dangling = { ...spec, assets: {} };
    const v = validateSpec(dangling);
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/"foto".*"@foto".*not in assets/);
    expect(resolveAssetRefs(structuredClone(dangling))).toEqual(["foto"]);
  });

  test("the resolver counts a referenced photo as embedded — no fetch", async () => {
    const results = await resolveImages(structuredClone(spec), {
      fetch: (() => { throw new Error("must not fetch"); }) as never,
      loadRaster: (() => { throw new Error("must not load"); }) as never,
      encode: (() => { throw new Error("must not encode"); }) as never,
    } as never);
    expect(results).toEqual([{ id: "foto", ok: true }]);
  });

  test("hoistStrokes moves long inline bytes under assets, names them by id, leaves short ones", () => {
    const s: Spec = {
      elements: [
        { id: "foto", type: "image", of: "x", strokes: PHOTO },
        { id: "tiny", type: "icon", of: "y", strokes: "ico1:aa:short" },
        { id: "foto2", type: "image", of: "z", strokes: PHOTO },
      ],
      commands: [],
    };
    expect(hoistStrokes(s)).toBe(2);
    expect(s.elements![0].strokes).toBe("@foto");
    expect(s.elements![1].strokes).toBe("ico1:aa:short");
    expect(s.elements![2].strokes).toBe("@foto2");
    expect(Object.keys(s.assets!)).toEqual(["foto", "foto2"]);
    // A second hoist is a no-op: references are not hoisted again.
    expect(hoistStrokes(s)).toBe(0);
    expect(validateSpec(s).ok).toBe(true);
  });

  test("a name already taken by different bytes gets a numbered sibling", () => {
    const s: Spec = { elements: [{ id: "foto", type: "image", of: "x", strokes: PHOTO }], commands: [], assets: { foto: "other" } };
    hoistStrokes(s);
    expect(s.elements![0].strokes).toBe("@foto_2");
    expect(s.assets!.foto_2).toBe(PHOTO);
  });

  test("the serializer writes assets LAST, whatever order the object had", () => {
    const yaml = dumpSpecYaml({ assets: { foto: "abc" }, title: "T", elements: [], commands: [] });
    expect(yaml.trim().split("\n").at(-2)).toBe("assets:");
    expect(yaml.trim().split("\n").at(-1)).toBe("  foto: abc");
    expect(Object.keys(specForDump({ assets: { a: "1" }, b: 2 }))).toEqual(["b", "assets"]);
    // Same through a playlist, and inline strokes are still written where they were.
    const pl = formatPlaylist(singlePlaylist({ assets: { foto: "abc" }, elements: [{ id: "i", type: "image", of: "x", strokes: "inline" }], commands: [] }), "yaml");
    expect(pl.trim().endsWith("assets:\n  foto: abc")).toBe(true);
    expect(pl).toContain("strokes: inline");
  });
});

describe("assets and the model round-trip (llm/hoist.ts)", () => {
  test("the revise sentinel is spelled like a reference but is never one", () => {
    expect(HOISTED.startsWith("@")).toBe(true);
    expect(assetRef(HOISTED)).toBeNull();
  });

  test("the assets map leaves the document with the strokes and comes back with them", () => {
    const doc = formatSpec({ elements: [{ id: "foto", type: "image", of: "x", strokes: "@foto" }], commands: [], assets: { foto: PHOTO } }, "yaml");
    const hoisted = hoistPortraitStrokes(doc);
    expect(hoisted.text).not.toContain("img1:");
    expect(hoisted.text).not.toContain("assets:");
    expect(hoisted.text).toMatch(new RegExp(`strokes: ['"]${HOISTED}['"]`));
    const back = parsePlaylistText(hoisted.text);
    restorePortraitStrokes(back, hoisted.blobs);
    const spec = back.entries[0].kind === "item" ? back.entries[0].spec : null;
    expect(spec?.assets).toEqual({ foto: PHOTO });
    expect(spec?.elements?.[0].strokes).toBe("@foto");
  });
});
