// Final fix I3: a linked (lnk1) picture is blank in every rasterised output —
// the host refuses pixel reads — so the export paths draw a placeholder in its
// box, and lint says so while the author can still embed it.
import { describe, expect, test } from "vitest";
import { placeholdLinkedPictures } from "../src/export/linked-pictures";
import { lintCommands } from "../src/lint/lint";
import { encodeLinkedPhoto, encodePhoto } from "../src/spec/trace";

describe("linked pictures in rasterised outputs", () => {
  test("only the https image is replaced, by a box that names its host", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><g><image href="data:image/png;base64,AAAA" x="0" y="0" width="10" height="10"/></g>' +
      '<g><image href="https://microdata.no/a/shot.png?x=1&amp;y=2" preserveAspectRatio="none" x="50" y="60" width="400" height="200"/></g></svg>';
    const out = placeholdLinkedPictures(svg);
    expect(out).toContain('href="data:image/png;base64,AAAA"');
    expect(out).not.toContain("https://microdata.no");
    expect(out).toContain("picture: microdata.no");
    expect(out).toMatch(/<rect[^>]*x="50"[^>]*y="60"[^>]*width="400"[^>]*height="200"/);
    // The label sits at the box's centre.
    expect(out).toMatch(/<text[^>]*x="250"[^>]*y="160"/);
  });
  test("an svg with no linked picture is returned unchanged", () => {
    const svg = '<svg><image href="data:image/png;base64,AAAA" x="0" y="0" width="10" height="10"></image></svg>';
    expect(placeholdLinkedPictures(svg)).toBe(svg);
  });
});

describe("lint: linked-picture", () => {
  test("warns for an lnk1 image, not for an img1 image", () => {
    const spec = {
      elements: [
        { id: "md", type: "image", url: "https://microdata.no/shot.png", strokes: encodeLinkedPhoto(0.5, "https://microdata.no/shot.png") },
        { id: "p", type: "image", of: "pump", strokes: encodePhoto(0.5, "data:image/png;base64,AAAA") },
      ],
      commands: [{ draw: ["md", "p"] }],
    };
    const issues = lintCommands(spec as never).filter((i) => i.rule === "linked-picture");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ ids: ["md"], severity: "warn" });
    expect(issues[0].message).toBe("md is shown by link from microdata.no: it will be blank in a movie or poster until embedded (the host refuses pixel reads)");
  });
  test("a hoisted @asset lnk1 counts too", () => {
    const spec = { assets: { shot: encodeLinkedPhoto(0.5, "https://x.org/a.png") }, elements: [{ id: "md", type: "image", url: "https://x.org/a.png", strokes: "@shot" }], commands: [{ draw: ["md"] }] };
    expect(lintCommands(spec as never).some((i) => i.rule === "linked-picture")).toBe(true);
  });
});
