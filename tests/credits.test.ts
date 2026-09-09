import { describe, expect, test } from "vitest";
import { creditsOf } from "../src/export/credits";
import { foldedControls } from "../src/ui/controls";

describe("credits", () => {
  test("collects image and icon credits once each, in element order", () => {
    expect(creditsOf([{ elements: [{ id: "a", type: "image", of: "x", credit: "A · CC0" }, { id: "b", type: "icon", of: "y", credit: "lucide · ISC" }, { id: "c", type: "image", of: "x", credit: "A · CC0" }], commands: [] }] as never)).toEqual(["A · CC0", "lucide · ISC"]);
  });
  test("credits slot is folded only when there are credits", () => {
    expect(foldedControls(false, true, true).folded).not.toContain("credits");
    expect(foldedControls(false, true, true, true).folded).toContain("credits");
    expect(foldedControls(false, true, true, true).inline).not.toContain("credits");
  });
});
