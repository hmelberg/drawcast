// A windowed code pane clips its lines with a <clipPath> referenced by
// url(#id) — and url(#id) resolves to the FIRST element in the document with
// that id. Every mount numbered its clips from cs-clip-1, so a second mount
// in the same page (the next part of a lecture, a frames contact sheet)
// clipped its window with the first mount's rectangle: lines spilled above
// the bezel and the newest rows were cut away.
import { describe, expect, test } from "vitest";
import { rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const code = (n: number) => Array.from({ length: n }, (_, i) => `x${i} = ${i}`).join("\n");
const spec = (n: number, lines: number, y: number) => ({
  elements: [{ id: "md", type: "code", language: "python", show: "code", code: code(n), lines, x: 500, y }],
  commands: [{ draw: ["md"] }],
});

describe("window clips across mounts", () => {
  test("two mounts in one document get distinct clip ids, each pointing at its own rect", async () => {
    const { restore, doc } = installMiniDom();
    try {
      const ids: string[][] = [];
      for (const s of [spec(10, 4, 300), spec(14, 10, 420)]) {
        const container = new FakeNode("div", doc as never);
        const layout = layoutSpec(s as never, heuristicMeasure);
        await rendererFor("clean").mount(layout, s as never, container as never);
        const clips = container.querySelectorAll("clipPath").map((c) => c.getAttribute("id")!);
        expect(clips.length).toBeGreaterThan(0);
        ids.push(clips);
      }
      expect(ids[0].filter((id) => ids[1].includes(id))).toEqual([]);
    } finally {
      restore();
    }
  });
});
