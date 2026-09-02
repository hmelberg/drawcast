// The pure "can this be saved, and if not why" decision (Task 3's ruling:
// all three Save destinations — disk/Drive/GitHub — refuse instead of
// silently shipping stale content when the editor's text doesn't parse).
// See src/ui/save-gate.ts's own doc comment for the bug this replaces.
import { describe, expect, it } from "vitest";
import { checkSaveable } from "../src/ui/save-gate";

const VALID_SPEC = "title: Part one\nelements:\n  - {id: t, type: text, text: hi, x: 500, y: 375}\ncommands: []";

describe("checkSaveable", () => {
  it("accepts a valid spec and hands back the parsed playlist", () => {
    const d = checkSaveable(VALID_SPEC);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.playlist.entries).toHaveLength(1);
      expect(d.playlist.entries[0]).toMatchObject({ kind: "item" });
    }
  });

  it("refuses text that doesn't parse as YAML or JSON — 'Spec unreadable'", () => {
    const d = checkSaveable("title: [unterminated");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/^Spec unreadable:/);
  });

  it("refuses a playlist stream with no drawable items", () => {
    const d = checkSaveable("chapter: Foo\n---\nchapter: Bar");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("The playlist has no drawable items.");
  });

  it("refuses a spec that parses but fails schema validation — 'Spec invalid'", () => {
    const d = checkSaveable(`${VALID_SPEC}\nnonsense: 1`);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/^Spec invalid:/);
  });

  it("names which item is invalid once a playlist has more than one", () => {
    const broken = `${VALID_SPEC}\nnonsense: 1`;
    const d = checkSaveable(`${VALID_SPEC}\n---\n${broken}`);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/^Spec invalid: item 2: /);
  });
});

describe("the blank page (＋ New, 2026-09-02)", () => {
  it("is adoptable and saveable in the editor, exactly as ＋ New writes it", () => {
    const d = checkSaveable("elements: []\ncommands: []");
    expect(d.ok).toBe(true);
  });

  it("does not loosen anything else — commands with nothing to draw still refuse", () => {
    const d = checkSaveable('commands:\n  - {speak: "hello"}');
    expect(d.ok).toBe(false);
  });
});
