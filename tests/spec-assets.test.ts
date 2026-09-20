// Hans 2026-09-10: base64 photos and long point lists made a spec hard to
// move around in. Two spec-level answers: an OPTIONAL `assets:` map written
// last, referenced as `strokes: "@name"`, and number pairs on one line.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  ASSET_MAX_BYTES,
  ASSET_SEND_MAX,
  assetBytes,
  assetRef,
  describeAsset,
  formatAssetSize,
  hoistStrokes,
  inlineStrokes,
  paramAssetRefs,
  paramsWithAssets,
  resolveAssetRefs,
  resolveParamAssetRefs,
  specForDump,
} from "../src/spec/assets";
import { compactPointPairs, dumpSpecYaml, formatSpec, parseSpecText } from "../src/spec/text";
import { normalizeSpec, validateSpec } from "../src/spec/schema";
import { formatPlaylist, itemsOf, parsePlaylistText, singlePlaylist } from "../src/playlist/playlist";
import { layoutSpec } from "../src/layout/layout";
import { resolveImages } from "../src/render/image";
import { HOISTED, hoistPortraitStrokes, restorePortraitStrokes } from "../src/llm/hoist";
import { parseScriptPages } from "../src/spec/script/parse";
import type { Spec } from "../src/spec/types";

const examples = JSON.parse(readFileSync(new URL("../src/examples.json", import.meta.url), "utf8")) as { title: string; spec?: Spec; playlist?: string }[];
/** A real embedded photo string, borrowed from a bundled example. */
const PHOTO = examples.find((e) => e.title === "Fargen forteller høyden")!.spec!.elements!.find((e) => e.id === "foto")!.strokes!;

describe("compactPointPairs", () => {
  test("a pair nested in a list, and a pair under a key, each go on one line", () => {
    const yaml = ["points:", "  - - 10", "    - 20", "  - - -3.5", "    - 4e2", "domain:", "  x:", "    - 0", "    - 30", ""].join("\n");
    expect(compactPointPairs(yaml)).toBe(["points:", "  - [10, 20]", "  - [-3.5, 4e2]", "domain:", "  x: [0, 30]", ""].join("\n"));
  });
  test("a quoted key compacts too: js-yaml writes domain's y as 'y' (a bare y is YAML 1.1's boolean)", () => {
    const yaml = dumpSpecYaml({ domain: { x: [0, 30], y: [0, 85000] }, elements: [], commands: [] });
    expect(yaml).toContain("x: [0, 30]");
    expect(yaml).toContain("'y': [0, 85000]");
    expect(parseSpecText(yaml).value).toEqual({ domain: { x: [0, 30], y: [0, 85000] }, elements: [], commands: [] });
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
    // hoist re-prints the document, and the editor's format is script now.
    expect(hoisted.text).toMatch(new RegExp(`strokes ${HOISTED}`));
    const back = parsePlaylistText(hoisted.text);
    restorePortraitStrokes(back, hoisted.blobs);
    const spec = back.entries[0].kind === "item" ? back.entries[0].spec : null;
    expect(spec?.assets).toEqual({ foto: PHOTO });
    expect(spec?.elements?.[0].strokes).toBe("@foto");
  });
});

describe("an asset may be data, not only bytes", () => {
  const OPENINGS = [
    { name: "Italian Game", eco: "C50", moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"] },
    { name: "Ruy Lopez", eco: "C60", moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"] },
  ];

  test("a data asset validates, and survives a YAML round trip with its types intact", () => {
    const spec = { template: "chess_board", params: { set: "@openings" }, assets: { openings: OPENINGS }, commands: [] } as unknown as Spec;
    expect(validateSpec(spec).errors).toEqual([]);
    const back = parsePlaylistText(formatPlaylist(singlePlaylist(spec), "script"));
    // Playlist exposes items via itemsOf (chapters excluded), not a bare `.items`.
    expect(itemsOf(back)[0].spec.assets!.openings).toEqual(OPENINGS);
  });

  test("strokes pointing at a data asset reads as absent rather than as an object", () => {
    const spec = { assets: { openings: OPENINGS } } as unknown as Spec;
    expect(inlineStrokes(spec, { strokes: "@openings" })).toBeUndefined();
  });

  test("a byte asset is untouched: hoistStrokes still moves long strokes and names them by element id", () => {
    const spec = { elements: [{ id: "foto", type: "image", strokes: PHOTO }] } as unknown as Spec;
    expect(hoistStrokes(spec)).toBe(1);
    expect(spec.elements![0].strokes).toBe("@foto");
    expect(spec.assets!.foto).toBe(PHOTO);
  });

  // Round 1 review finding: parseFence's ```assets``` fence cast the parsed
  // YAML to Record<string, string>, silently narrowing hand-typed data back
  // to bytes. A hand-typed `assets:` block is a documented way to add a data
  // asset (design 2026-09-20 §6), so the fence must carry an array value
  // (not just a string) with its shape intact.
  test("a hand-typed assets fence carries data, not only bytes", () => {
    const spec = parseScriptPages(["Hei.", "", "```assets", "openings:", "  - name: Italian Game", "    moves: [e4, e5, Nf3]", "```", ""].join("\n")).pages[0].spec;
    expect(spec.assets).toEqual({ openings: [{ name: "Italian Game", moves: ["e4", "e5", "Nf3"] }] });
  });
});

describe("@name inside params", () => {
  const SET = [{ name: "Italian Game", moves: ["e4"] }];

  test("resolves at the top level, and at any depth", () => {
    const params = { set: "@openings", nested: { pair: ["@openings", 3] } };
    const dangling = resolveParamAssetRefs({ assets: { openings: SET }, params });
    expect(dangling).toEqual([]);
    expect(params.set).toEqual(SET);
    expect((params.nested.pair as unknown[])[0]).toEqual(SET);
    expect((params.nested.pair as unknown[])[1]).toBe(3);
  });

  test("a partial match is left alone — the reference is the WHOLE string or nothing", () => {
    const params = { title: "see @openings", set: "@openings" };
    resolveParamAssetRefs({ assets: { openings: SET }, params });
    expect(params.title).toBe("see @openings");
  });

  test("a name that resolves to nothing is reported, not thrown, and left as written", () => {
    const params = { set: "@missing" };
    expect(resolveParamAssetRefs({ assets: {}, params })).toEqual(["missing"]);
    expect(params.set).toBe("@missing");
  });

  test("a reference to BYTES is left standing too — bytes are not data", () => {
    const params = { set: "@foto" };
    expect(resolveParamAssetRefs({ assets: { foto: "iVBORw0KGgo" }, params })).toEqual([]);
    expect(params.set).toBe("@foto"); // semanticErrors says why, in Task 3
  });

  test("paramAssetRefs reports where each reference sits", () => {
    expect(paramAssetRefs({ set: "@openings", deep: { rows: ["@endgames"] } })).toEqual([
      { path: "set", name: "openings" },
      { path: "deep.rows.0", name: "endgames" },
    ]);
  });

  test("normalizeSpec resolves params, so a layout never sees a reference", () => {
    const spec = { template: "chess_board", params: { set: "@openings" }, assets: { openings: SET } };
    const out = normalizeSpec(spec) as { params: { set: unknown }; assets: unknown };
    expect(out.params.set).toEqual(SET);
    // The input document is untouched: normalizeSpec clones.
    expect(spec.params.set).toBe("@openings");
  });

  test("paramsWithAssets returns a resolved copy and leaves the spec alone", () => {
    const spec = { params: { set: "@openings" }, assets: { openings: SET } } as unknown as Spec;
    expect(paramsWithAssets(spec).set).toEqual(SET);
    expect((spec.params as { set: string }).set).toBe("@openings");
  });

  test("a literal dotted key resolves correctly and does not throw — the path is a label, not a traversal", () => {
    const params = { "chart.title": "@openings" };
    expect(resolveParamAssetRefs({ assets: { openings: SET }, params })).toEqual([]);
    expect(params["chart.title"]).toEqual(SET);
  });

  test("paramsWithAssets copies even with no assets — mutating the result must not touch spec.params", () => {
    const spec = { params: { set: "plain" } } as unknown as Spec;
    const out = paramsWithAssets(spec);
    out.set = "mutated";
    expect((spec.params as { set: string }).set).toBe("plain");
  });
});

describe("asset errors", () => {
  const errorsFor = (spec: unknown): string[] => validateSpec(normalizeSpec(spec)).errors;

  test("a params reference to an absent asset names the path and the name", () => {
    expect(errorsFor({ template: "chess_board", params: { set: "@missing" }, commands: [] })).toContain(
      'params.set refers to asset "@missing", which is not in assets',
    );
  });

  test("strokes pointing at data, and params pointing at bytes, each say which is which", () => {
    const strokesAtData = errorsFor({
      elements: [{ id: "p1", type: "portrait", of: "Ada", strokes: "@openings" }],
      assets: { openings: [{ name: "Italian Game" }] },
      commands: [],
    });
    expect(strokesAtData).toContain(
      'element "p1" (portrait): strokes refers to asset "@openings", which is data, not encoded bytes',
    );
    const paramsAtBytes = errorsFor({
      template: "chess_board",
      params: { set: "@foto" },
      assets: { foto: "iVBORw0KGgo" },
      commands: [],
    });
    expect(paramsAtBytes).toContain('params.set refers to asset "@foto", which is encoded bytes, not data');
  });

  test("the absent-strokes message is unchanged", () => {
    expect(errorsFor({ elements: [{ id: "p1", type: "portrait", of: "Ada", strokes: "@gone" }], commands: [] })).toContain(
      'element "p1" (portrait): strokes refers to asset "@gone", which is not in assets',
    );
  });

  test("an asset over the cap is refused, and the message names both sizes", () => {
    const big = Array.from({ length: 40_000 }, (_, i) => ({ name: `row ${i}`, moves: ["e4", "e5"] }));
    expect(assetBytes(big)).toBeGreaterThan(ASSET_MAX_BYTES);
    const errs = errorsFor({ template: "chess_board", params: { set: "@big" }, assets: { big }, commands: [] });
    expect(errs.some((e) => /^asset "@big" is [\d.]+ MB; the limit is 1 MB$/.test(e))).toBe(true);
  });

  test("formatAssetSize reads the way a person would say it", () => {
    expect(formatAssetSize(6 * 1024)).toBe("6 KB");
    expect(formatAssetSize(1_468_006)).toBe("1.4 MB");
    // Low KB range, untouched by the fix below.
    expect(formatAssetSize(2 * 1024)).toBe("2 KB");
    // The KB branch rounds up to 1024 before the old MB gate (>= 1024 * 1024)
    // would trip — a byte count a hair under the cap must still read "1 MB",
    // never "1024 KB" (round 1 review finding, cross-task: Tasks 7 and 8
    // call this with arbitrary sizes that land in exactly this gap).
    expect(formatAssetSize(ASSET_MAX_BYTES - 1)).toBe("1 MB");
    expect(formatAssetSize(ASSET_MAX_BYTES)).toBe("1 MB");
  });
});

describe("the authoring-time trap (design §4.3)", () => {
  test("a param that points at an asset is not a schema violation", async () => {
    const { registerPack } = await import("../src/scenes/packs");
    const { ensureEngines } = await import("../src/scenes/engines");
    const { templateParamIssues } = await import("../src/scenes/params-check");
    const gamesYaml = (await import("../src/scenes/packs/games.yaml?raw")).default;
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);

    const spec = {
      template: "chess_board",
      params: { moves: "@line" },
      assets: { line: ["e4", "e5", "Nf3"] },
    } as unknown as Spec;

    // Unresolved, the schema sees a string where an array belongs.
    expect(templateParamIssues("chess_board", spec.params, true).errors.length).toBeGreaterThan(0);
    // Resolved — the form every validator must see — it is clean.
    expect(templateParamIssues("chess_board", paramsWithAssets(spec), true).errors).toEqual([]);
  });
});

describe("descriptors and the send threshold", () => {
  const small = [{ name: "Italian Game", eco: "C50", moves: ["e4", "e5"], idea: "f7" }];
  const big = Array.from({ length: 2_000 }, (_, i) => ({ name: `Line ${i}`, eco: "C50", moves: ["e4", "e5"], idea: "x" }));

  test("describeAsset names the shape, never the contents", () => {
    expect(describeAsset(small)).toBe("@data 1 rows — name, eco, moves[], idea");
    expect(describeAsset([])).toBe("@data 0 rows");
    expect(describeAsset([1, 2, 3])).toBe("@data 3 numbers");
    expect(describeAsset(["a", "b"])).toBe("@data 2 strings");
    expect(describeAsset({ openings: 1, endgames: 2 })).toBe("@data object — openings, endgames");
    expect(describeAsset(42)).toBe("@data value");
  });

  test("a small data asset is SENT, so the model can edit it", () => {
    const doc = formatPlaylist(singlePlaylist({ template: "chess_board", params: { set: "@openings" }, assets: { openings: small } } as unknown as Spec), "script");
    const hoisted = hoistPortraitStrokes(doc);
    const sent = itemsOf(parsePlaylistText(hoisted.text))[0].spec;
    expect(sent.assets!.openings).toEqual(small);
    expect(hoisted.described).toEqual([]);
  });

  test("a large one is described, and the original comes back untouched", () => {
    expect(assetBytes(big)).toBeGreaterThan(ASSET_SEND_MAX);
    const doc = formatPlaylist(singlePlaylist({ template: "chess_board", params: { set: "@openings" }, assets: { openings: big } } as unknown as Spec), "script");
    const hoisted = hoistPortraitStrokes(doc);
    const seen = itemsOf(parsePlaylistText(hoisted.text))[0].spec;
    expect(seen.assets!.openings).toBe(`@data ${big.length} rows — name, eco, moves[], idea`);
    expect(hoisted.described.map((d) => d.name)).toEqual(["openings"]);

    // What the model returns, descriptor and all, restores to the original.
    const reply = parsePlaylistText(hoisted.text);
    restorePortraitStrokes(reply, hoisted.blobs);
    expect(itemsOf(reply)[0].spec.assets!.openings).toEqual(big);
  });

  test("an edit to a SENT asset survives restoration", () => {
    const doc = formatPlaylist(singlePlaylist({ template: "chess_board", params: { set: "@openings" }, assets: { openings: small } } as unknown as Spec), "script");
    const hoisted = hoistPortraitStrokes(doc);
    const reply = parsePlaylistText(hoisted.text);
    const edited = [...small, { name: "Sicilian Defence", eco: "B20", moves: ["e4", "c5"], idea: "asymmetry" }];
    itemsOf(reply)[0].spec.assets = { openings: edited };
    restorePortraitStrokes(reply, hoisted.blobs);
    expect(itemsOf(reply)[0].spec.assets!.openings).toEqual(edited);
  });

  test("a reply that drops the assets block loses nothing", () => {
    const doc = formatPlaylist(singlePlaylist({ template: "chess_board", params: { set: "@openings" }, assets: { openings: small } } as unknown as Spec), "script");
    const hoisted = hoistPortraitStrokes(doc);
    const reply = parsePlaylistText(hoisted.text);
    delete itemsOf(reply)[0].spec.assets;
    restorePortraitStrokes(reply, hoisted.blobs);
    expect(itemsOf(reply)[0].spec.assets!.openings).toEqual(small);
  });

  test("the threshold decides AT its boundary, not near it", () => {
    // A row is ~46 bytes serialized; build one set just under 32 KB and one just over.
    const row = (i: number) => ({ name: `Line ${i}`, eco: "C50", moves: ["e4"] });
    const fit: ReturnType<typeof row>[] = [];
    while (assetBytes([...fit, row(fit.length)]) <= ASSET_SEND_MAX) fit.push(row(fit.length));
    const over = [...fit, row(fit.length)];
    expect(assetBytes(fit)).toBeLessThanOrEqual(ASSET_SEND_MAX);
    expect(assetBytes(over)).toBeGreaterThan(ASSET_SEND_MAX);

    const seen = (rows: unknown) => {
      const doc = formatPlaylist(singlePlaylist({ template: "chess_board", params: { set: "@s" }, assets: { s: rows } } as unknown as Spec), "script");
      return itemsOf(parsePlaylistText(hoistPortraitStrokes(doc).text))[0].spec.assets!.s;
    };
    expect(seen(fit)).toEqual(fit); // exactly at the limit: still sent
    expect(typeof seen(over)).toBe("string"); // one row more: described
  });

  test("a ragged table describes as its FIRST row — a hint, not a schema", () => {
    expect(describeAsset([{ name: "a", eco: "C50" }, { name: "b", extra: 1 }])).toBe("@data 2 rows — name, eco");
  });

  test("bytes and data coexist in one spec, each reachable only from its own kind of site", () => {
    const spec = {
      template: "chess_board",
      params: { set: "@openings" },
      elements: [{ id: "foto", type: "image", strokes: "@foto" }],
      assets: { foto: PHOTO, openings: small },
      commands: [],
    } as unknown as Spec;
    const out = normalizeSpec(spec) as Spec;
    expect((out.params as { set: unknown }).set).toEqual(small);
    expect(out.elements![0].strokes).toBe(PHOTO);
    // Scoped to what this test is about: an unrelated schema complaint about
    // the image element must not decide whether asset handling is correct.
    expect(validateSpec(out).errors.filter((e) => e.includes("asset"))).toEqual([]);
  });

  test("bytes are unchanged: still stashed whole, still invisible to the model", () => {
    const doc = formatPlaylist(singlePlaylist({ elements: [{ id: "foto", type: "image", strokes: "@foto" }], assets: { foto: PHOTO } } as unknown as Spec), "script");
    const hoisted = hoistPortraitStrokes(doc);
    expect(hoisted.text).not.toContain(PHOTO.slice(0, 40));
    const reply = parsePlaylistText(hoisted.text);
    restorePortraitStrokes(reply, hoisted.blobs);
    expect(itemsOf(reply)[0].spec.assets!.foto).toBe(PHOTO);
  });
});
