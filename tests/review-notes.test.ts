import { describe, expect, it } from "vitest";
import { describeNote, formatNotes, noteLabel } from "../src/review/notes";

describe("describeNote", () => {
  it("puts the position before the ask", () => {
    expect(describeNote({ text: "the axis is mislabelled", part: 3, item: "Parallel trends", caption: "Watch 1992" })).toBe(
      'Part 3 "Parallel trends", at "Watch 1992": the axis is mislabelled',
    );
  });

  it("copes with a part but no caption", () => {
    expect(describeNote({ text: "too fast", part: 1, item: "Setup" })).toBe('Part 1 "Setup": too fast');
  });

  it("copes with a single-figure drawcast, which has no part number", () => {
    expect(describeNote({ text: "wrong colour", item: "Supply and demand" })).toBe('"Supply and demand": wrong colour');
  });

  it("falls back to the bare note when nothing is known", () => {
    expect(describeNote({ text: "make it shorter" })).toBe("make it shorter");
  });
});

describe("formatNotes", () => {
  const notes = [
    { text: "the axis is mislabelled", part: 3, item: "Parallel trends" },
    { text: "add a multiple-choice question about the assumption", part: 4, item: "When it breaks" },
  ];

  it("numbers them and asks for them to be reconciled", () => {
    const out = formatNotes(notes);
    expect(out).toContain("1. Part 3");
    expect(out).toContain("2. Part 4");
    expect(out).toContain("reconciling any that pull against each other");
  });

  it("sends a single note as itself, with no list ceremony", () => {
    expect(formatNotes([notes[0]])).toBe('Part 3 "Parallel trends": the axis is mislabelled');
  });

  it("ignores blank notes", () => {
    expect(formatNotes([{ text: "   " }, notes[0]])).toBe(formatNotes([notes[0]]));
  });

  it("is empty when there is nothing to say", () => {
    expect(formatNotes([])).toBe("");
    expect(formatNotes([{ text: "" }])).toBe("");
  });
});

describe("noteLabel", () => {
  it("labels a part note", () => {
    expect(noteLabel({ text: "x", part: 2, item: "DiD" })).toBe("2. DiD");
  });

  it("is empty when the note has no position", () => {
    expect(noteLabel({ text: "x" })).toBe("");
  });
});
