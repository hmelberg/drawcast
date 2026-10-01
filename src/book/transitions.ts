// How a book's pane empties, or its figure changes (spec 2026-10-01-book-
// layout §6.3, §12.3): TV between chapters and for a cleared text pane — the
// picture squeezes to a bright line, the line to a dot, the dot goes out —
// and a short fade between the parts of one chapter. Web Animations only:
// nothing here reflows.

import type { BookSettings } from "../spec/types";

export type BookTransition = NonNullable<BookSettings["transition"]>;

const EASE = "cubic-bezier(.65, 0, .35, 1)";

const OUT: Record<BookTransition, Keyframe[]> = {
  tv: [
    { transform: "scale(1, 1)", filter: "brightness(1)", opacity: 1, offset: 0 },
    { transform: "scale(1, 0.012)", filter: "brightness(2.2)", opacity: 1, offset: 0.45 },
    { transform: "scale(0.02, 0.012)", filter: "brightness(3)", opacity: 1, offset: 0.8 },
    { transform: "scale(0, 0)", filter: "brightness(3)", opacity: 0, offset: 1 },
  ],
  fade: [{ opacity: 1 }, { opacity: 0 }],
  slide: [
    { transform: "translateY(0)", opacity: 1 },
    { transform: "translateY(-12%)", opacity: 0 },
  ],
  wipe: [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }],
};

const MS: Record<BookTransition, number> = { tv: 650, fade: 400, slide: 550, wipe: 600 };

const reduced = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Play `el` out; resolves when it is gone (it stays gone until cleared). */
export function transitionOut(el: Element, kind: BookTransition): Promise<void> {
  if (reduced() || typeof el.animate !== "function") return Promise.resolve();
  const a = el.animate(OUT[kind], { duration: MS[kind], easing: kind === "tv" ? "ease-in" : EASE, fill: "forwards" });
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

/** Play `el` in: the same frames, reversed. */
export function transitionIn(el: Element, kind: BookTransition): Promise<void> {
  if (reduced() || typeof el.animate !== "function") return Promise.resolve();
  const frames = [...OUT[kind]].reverse().map((f) => ({ ...f, offset: typeof f.offset === "number" ? 1 - f.offset : undefined }));
  const a = el.animate(frames, { duration: MS[kind], easing: kind === "tv" ? "ease-out" : EASE });
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

/** Drop whatever an out-transition left holding (its forwards fill). */
export function settle(el: Element): void {
  for (const a of el.getAnimations?.() ?? []) a.cancel();
}
