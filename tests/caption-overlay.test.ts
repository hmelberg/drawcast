// The caption became an overlay ON the stage, which put it inside the stage's
// own gesture area for the first time. Two things the stage does would now
// happen on top of it: a click toggles play/pause like a video, and a click
// hit-tests the drawing for an info card. Both must let the caption through —
// dragging across a subtitle to look a phrase up would otherwise pause the
// drawcast, and clicking a word would open the card of whatever the band
// happens to be covering.
import { describe, expect, test } from "vitest";
import { captionVisibility, isTextDrag, overCaption } from "../src/ui/caption";

/** Stands in for an Element, which node has none of. */
const at = (...classes: string[]) => ({
  closest: (sel: string) => (classes.some((c) => sel.includes(c)) ? {} : null),
});

const collapsed = { isCollapsed: true };
const dragged = { isCollapsed: false };

describe("isTextDrag — what playback must ignore", () => {
  test("a live selection counts wherever the pointer was released", () => {
    // Selecting a phrase and releasing over the drawing still ends in a click
    // on the stage. Without this the lookup gesture pauses playback.
    expect(isTextDrag(dragged)).toBe(true);
  });

  test("a plain click is not a drag — the band toggles play like the picture", () => {
    expect(isTextDrag(collapsed)).toBe(false);
  });

  test("a browser that reports no selection at all is not a drag", () => {
    expect(isTextDrag(null)).toBe(false);
  });
});

describe("overCaption — what must not open an info card", () => {
  test("a click on the band is on the band, not on what it covers", () => {
    expect(overCaption(at("cs-caption"))).toBe(true);
  });

  test("a click on the drawing is on the drawing", () => {
    expect(overCaption(at("cs-stage"))).toBe(false);
    expect(overCaption(null)).toBe(false);
  });
});

describe("captionVisibility", () => {
  test("on and non-empty: shown", () => {
    expect(captionVisibility({ on: true, text: "Supply meets demand." })).toBe("shown");
  });

  test("an empty line hides the band instead of leaving an empty box floating", () => {
    expect(captionVisibility({ on: true, text: "" })).toBe("empty");
    expect(captionVisibility({ on: true, text: "   " })).toBe("empty");
  });

  test("CC off hides it whatever the line says", () => {
    expect(captionVisibility({ on: false, text: "Supply meets demand." })).toBe("off");
    expect(captionVisibility({ on: false, text: "" })).toBe("off");
  });
});
