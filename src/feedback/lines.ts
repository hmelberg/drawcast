/**
 * The bundled feedback lines (spec 2026-10-03-looks-feedback-account §4.2):
 * an ENGLISH-ONLY fallback, used only when an English cast asks for a style
 * but wrote no line of its own for the band. Generic on purpose — no topic,
 * no role, no {vars}: the cast's author writes the flavoured ones ("Good
 * thing you're not a pharmacist.") in the cast's own language.
 */
import type { Band } from "./bands";

export const FALLBACK_LINES: Record<"warm" | "dry", Record<Band, string[]>> = {
  warm: {
    perfect: ["Spot on — every one.", "All of it. Nicely done.", "Exactly right."],
    good: ["Nearly all of them. Nicely done.", "Close — very close.", "Most of the way there."],
    poor: ["A tricky one — most people miss these.", "Some of it. The rest comes with practice.", "Not quite, but you're on the way."],
    none: ["Everyone starts somewhere. Now you know.", "A hard one. Now you've seen how it goes.", "Not this time — but now you know why."],
  },
  dry: {
    perfect: ["Suspiciously good. Have you done this before?", "Flawless. Almost annoying.", "Right on. Show-off."],
    good: ["Not bad. Not bad at all.", "Close enough to brag about.", "Respectable. Mostly."],
    poor: ["Let's call that a warm-up.", "Some of it. Some.", "Well, it wasn't nothing."],
    none: ["Bold. Wrong, but bold.", "Confident. Also wrong.", "An interesting approach. Not a right one."],
  },
};
