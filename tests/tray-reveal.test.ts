import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { withNewIdsVisible } from "../src/render/params";

describe("revealing ids a preview mints", () => {
  test("ids absent from the plan-time layout become visible; ids the plan knew but hid stay hidden", () => {
    const planTime = new Set(["body_outline", "hand_left", "femur_left", "heart"]);
    const previewed = ["body_outline", "carpals_left", "metacarpals_left", "femur_left", "heart"];
    const visible = new Set(["body_outline", "femur_left"]); // the storyboard has not drawn the heart yet
    const out = withNewIdsVisible(planTime, previewed, visible);
    expect(out.has("carpals_left")).toBe(true);
    expect(out.has("metacarpals_left")).toBe(true);
    expect(out.has("heart"), "known at plan time and deliberately hidden — stays hidden").toBe(false);
    expect(out.has("body_outline")).toBe(true);
  });

  test("the tray's slider repaint asks for that reveal", () => {
    // A source-level pin: the one-line fix that makes anatomy's detail slider
    // do anything. If someone drops the option again, this fails with a
    // message that says why it was there.
    const src = readFileSync("src/ui/tray.ts", "utf8");
    expect(src, "previewParams must pass { revealNew: true } — templates whose element set depends on a param (anatomy's detail) mint ids the plan never drew").toMatch(/previewParams\(overrides,\s*\{\s*revealNew:\s*true\s*\}\)/);
  });
});
