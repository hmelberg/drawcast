import { describe, expect, it } from "vitest";
import { parsePlaylistText, itemsOf } from "../src/playlist/playlist";
import { portraitInsert } from "../src/ui/insert";

const one = () => parsePlaylistText('{"elements": [], "commands": [{"draw": []}, {"pause": 1}]}');

describe("portraitInsert", () => {
  it("emits a draw command instead of leaving the element to the implicit\n     tail-draw that dumped it in a corner at the end", () => {
    const out = portraitInsert(one(), { source: { of: "David Ricardo" }, part: 0, cameo: true, afterStep: 1 });
    const spec = itemsOf(out)[0].spec;
    const drawn = (spec.commands ?? []).flatMap((c: any) => (typeof c.draw === "string" ? [c.draw] : (c.draw ?? [])));
    expect(drawn).toContain("portrait_1");
  });

  it("puts the draw at the chosen step, not at the end", () => {
    const out = portraitInsert(one(), { source: { of: "Keynes" }, part: 0, cameo: true, afterStep: 1 });
    const cmds = itemsOf(out)[0].spec.commands ?? [];
    expect(JSON.stringify(cmds[1])).toContain("portrait_1");
  });

  it("omits x/y/width in cameo mode — the schema says to", () => {
    const out = portraitInsert(one(), { source: { of: "Keynes" }, part: 0, cameo: true, afterStep: 0 });
    const el: any = (itemsOf(out)[0].spec.elements ?? [])[0];
    expect(el.cameo).toBe(true);
    expect(el.x).toBeUndefined();
    expect(el.width).toBeUndefined();
  });

  it("keeps the corner defaults when it is not a cameo", () => {
    const out = portraitInsert(one(), { source: { url: "https://x/y.jpg" }, part: 0, cameo: false, afterStep: 0 });
    const el: any = (itemsOf(out)[0].spec.elements ?? [])[0];
    expect([el.x, el.y, el.width]).toEqual([170, 550, 170]);
    expect(el.url).toBe("https://x/y.jpg");
  });

  it("numbers portraits per part", () => {
    let pl = portraitInsert(one(), { source: { of: "A" }, part: 0, cameo: true, afterStep: 0 });
    pl = portraitInsert(pl, { source: { of: "B" }, part: 0, cameo: true, afterStep: 0 });
    const ids = (itemsOf(pl)[0].spec.elements ?? []).map((e: any) => e.id);
    expect(ids).toEqual(["portrait_1", "portrait_2"]);
  });

  // Fix round 1, finding 2: a file upload has no regenerable source, so the
  // strokes arm of PortraitSource optionally carries the filename-derived
  // caption (`of`, drawn under the portrait — layout/tier2.ts) and provenance
  // (`source`) alongside the strokes themselves, and portraitInsert builds
  // the whole element from that one call — no separate patch step needed.
  it("carries a file upload's caption and provenance alongside its strokes", () => {
    const out = portraitInsert(one(), {
      source: { strokes: "STROKES_DATA", of: "vacation-photo", source: "vacation-photo.jpg" },
      part: 0,
      cameo: true,
      afterStep: 0,
    });
    const el: any = (itemsOf(out)[0].spec.elements ?? [])[0];
    expect(el.strokes).toBe("STROKES_DATA");
    expect(el.of).toBe("vacation-photo");
    expect(el.source).toBe("vacation-photo.jpg");
  });
});
