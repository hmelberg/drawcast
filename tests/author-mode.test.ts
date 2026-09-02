import { describe, expect, it } from "vitest";
import { authorButtonLabel, authoringMode, promptPlaceholder } from "../src/ui/author-mode";

const BLANK = "title: Untitled drawcast\nelements: []\ncommands: []\n";

describe("authoringMode — one button, state-determined (B7/D3)", () => {
  it("the blank document means Generate; whitespace and emptiness count as blank", () => {
    expect(authoringMode(BLANK, BLANK)).toBe("generate");
    expect(authoringMode(`\n${BLANK}\n`, BLANK)).toBe("generate");
    expect(authoringMode("", BLANK)).toBe("generate");
    expect(authoringMode("   \n", BLANK)).toBe("generate");
  });

  it("any loaded or hand-edited document means Revise", () => {
    expect(authoringMode("title: Supply and demand\ncommands: []", BLANK)).toBe("revise");
    // A hand-edited blank flips by itself — the edits are the thing to revise.
    expect(authoringMode(BLANK.replace("Untitled drawcast", "My tax figure"), BLANK)).toBe("revise");
  });

  it("the placeholder carries the mode", () => {
    expect(promptPlaceholder("generate")).toContain("Describe a drawcast");
    expect(promptPlaceholder("revise")).toBe("What should change?");
  });

  it("busy wins, then viewing, then the derived mode", () => {
    expect(authorButtonLabel("generate", { busy: true, viewing: false })).toBe("Cancel");
    expect(authorButtonLabel("revise", { busy: true, viewing: true })).toBe("Cancel");
    expect(authorButtonLabel("generate", { busy: false, viewing: true })).toBe("Revise from here");
    expect(authorButtonLabel("generate", { busy: false, viewing: false })).toBe("Generate with AI");
    expect(authorButtonLabel("revise", { busy: false, viewing: false })).toBe("Revise with AI");
  });
});
