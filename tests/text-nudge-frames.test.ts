// A text nudged in from the canvas edge stays nudged on a tween frame
// (2026-10-05: the heading sprang up and back on every step, morph and re-run).
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { textNudge } from "../src/render/svg-backend";

const PAGE = { left: 0, right: 1000, top: 0, bottom: 750 };

test("a text over the top edge moves down to 3 inside; one inside stays", () => {
  expect(textNudge({ x: 300, y: -3, width: 400, height: 54 }, PAGE)).toEqual([0, 6]);
  expect(textNudge({ x: 300, y: 40, width: 400, height: 54 }, PAGE)).toEqual([0, 0]);
  expect(textNudge({ x: 900, y: 40, width: 200, height: 20 }, PAGE)).toEqual([-103, 0]);
});

test("the tween frame (swapGeometry) re-nudges the leaves the last full pass moved", () => {
  const src = readFileSync("src/render/svg-backend.ts", "utf8");
  const swap = src.slice(src.indexOf("swapGeometry: ("), src.indexOf("remount: (l) =>"));
  expect(swap).toMatch(/nudgeTextsIntoCanvas\(svg, world, nudged\)/);
  const remount = src.slice(src.indexOf("remount: (l) =>"));
  expect(remount).toMatch(/nudged = nudgeTextsIntoCanvas\(svg, world\)/);
});
