// "Test me" (spec 2026-10-01-guess-and-reveal §7): a chip ON THE FIGURE, while
// paused or at the end, on a chart the viewer can guess (bars, lines, a pie).
// Pressed, the chart's numbers go back to a starting guess, the viewer sets
// them by hand, presses Answer, and the chart moves to the truth with the
// ghost and the gap left on it. Nothing is recorded — it is the viewer's own
// play. Playing on closes it.

import type { RenderHandle } from "../render";
import { h } from "./dom";
import { gateIsOpen } from "./gates";
import { guessGateFor } from "./guess-gate";

export function attachTestMe(stage: HTMLElement, hd: RenderHandle): void {
  const player = hd.timeline;
  if (!player.guess) return;
  const gate = guessGateFor(stage, hd);
  const chip = h("button", { class: "cs-cardgate-pill cs-testme", type: "button", title: "Guess the numbers yourself, then see how close you were" }, "Test me");
  chip.hidden = true;
  let busy = false;
  const refresh = (): void => {
    chip.hidden = busy || player.state === "playing" || player.state === "idle" || gateIsOpen(stage) || !player.canSelfTest();
  };
  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    busy = true;
    refresh();
    void player
      .selfTest((signal, session) => gate(signal, { question: "", retry: false, required: false, guess: session }))
      .finally(() => {
        busy = false;
        refresh();
      });
  });
  // CHAIN, never replace (controls.ts explains why).
  const prev = player.callbacks;
  player.callbacks = {
    ...prev,
    onState: (s) => {
      prev.onState?.(s);
      if (s === "playing") player.cancelSelfTest();
      refresh();
    },
    onStep: (done, total) => {
      prev.onStep?.(done, total);
      refresh();
    },
  };
  stage.appendChild(chip);
  refresh();
}
