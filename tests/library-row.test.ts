// What the library's ▤ marker is allowed to claim.
//
// The marker used to key off `SavedDrawing.playlist` being present, which was
// an honest signal only as long as a header meant "several parts". B9 gave a
// single generated figure a header too (it carries its founding prompt), so
// field presence now over-claims: every generated one-figure drawing would
// wear ▤ and offer to "Load this playlist".

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isMultiPart } from "../src/store";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

describe("isMultiPart — what the ▤ marker means", () => {
  it("a generated single figure carrying its founding prompt is NOT multi-part", () => {
    expect(isMultiPart({ parts: 1, playlist: "playlist:\n  prompt: draw a curve\n---\ntitle: A curve\n" })).toBe(false);
  });

  it("a real playlist is", () => {
    expect(isMultiPart({ parts: 3, playlist: "playlist:\n  title: T\n---\na\n---\nb\n---\nc\n" })).toBe(true);
  });

  it("a bare single spec is not", () => {
    expect(isMultiPart({ parts: 1, playlist: undefined })).toBe(false);
  });

  // A row written before B9 has no `parts`, and for those the old signal was
  // the correct reading of the data it does have: nothing but a real playlist
  // stored header text back then.
  it("falls back to the stored text for a row written before parts existed", () => {
    expect(isMultiPart({ parts: undefined, playlist: "playlist:\n  title: T\n---\na\n---\nb\n" })).toBe(true);
    expect(isMultiPart({ parts: undefined, playlist: undefined })).toBe(false);
  });
});

describe("the library row asks the helper, not the field (drift)", () => {
  it("row() marks ▤ by part count", () => {
    expect(main).toMatch(/isMultiPart\(item\)/);
  });

  it("row() no longer treats the presence of playlist text as 'multi-part'", () => {
    expect(main).not.toMatch(/item\.playlist \?/);
  });
});
