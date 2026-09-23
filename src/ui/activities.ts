// Starting a named activity, and the doors to it (interactivity spec §13's
// "scheduled convergence", finished in design 2026-09-24-music §6.4): the
// tray's pill row, an explore beat's `activity`, the right-click (or
// long-press) card — all start the same thing through startActivity, so
// they cannot drift.

import type { RenderHandle } from "../render";
import { mountChessDrill } from "./chessdrill";
import { mountChessVs } from "./chessvs";
import { h, logicalPoint } from "./dom";
import { gateIsOpen } from "./gates";
import { mountQuiz, type ActivityClose } from "./quiz";
import type { Activity } from "./quiz-model";

/** Start `act` on the figure; `onClose` hears when it ends (and its score). */
export function startActivity(stage: HTMLElement, hd: RenderHandle, act: Activity, onClose?: ActivityClose): void {
  if (act.id === "vs_computer") mountChessVs(stage, hd, onClose);
  else if (act.id === "openings_drill") mountChessDrill(stage, hd, onClose);
  else mountQuiz(stage, hd, act, onClose);
}

/** One card button per activity; `before` runs first (close a card, restore the lesson). */
export function activityButtons(stage: HTMLElement, hd: RenderHandle, acts: Activity[], before: () => void): HTMLElement[] {
  return acts.map((a) => {
    const b = h("button", { class: "cs-infocard-act" }, a.label);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      before();
      startActivity(stage, hd, a);
    });
    return b;
  });
}

/**
 * The figure's own card: a right-click on a figure that offers activities,
 * where no info card claims the point, opens a card AT the pointer with its
 * activities and a way to the tray — on the figure first (decision 3.3),
 * the tray one click further. `openTray` presses the ⊕.
 */
export function attachActivityCard(stage: HTMLElement, hd: RenderHandle, acts: Activity[], openTray: () => void): void {
  if (acts.length === 0) return;
  let card: HTMLElement | null = null;
  const close = (): void => {
    card?.remove();
    card = null;
  };
  stage.addEventListener(
    "contextmenu",
    (e) => {
      if (e.defaultPrevented || gateIsOpen(stage)) return; // an info card took it, or a question is open
      if (!logicalPoint(stage, e)) return;
      if (hd.timeline.state === "playing") hd.timeline.pause();
      e.preventDefault();
      e.stopPropagation();
      close();
      const sr = stage.getBoundingClientRect();
      const more = h("button", { class: "cs-infocard-act" }, "⊕ All controls");
      more.addEventListener("click", (ev) => {
        ev.stopPropagation();
        close();
        openTray();
      });
      const x = h("button", { class: "cs-infocard-close", title: "Close" }, "✕");
      x.addEventListener("click", (ev) => {
        ev.stopPropagation();
        close();
      });
      card = h("div", { class: "cs-infocard" }, x, h("div", { class: "cs-infocard-title" }, "Try it"), h("div", { class: "cs-infocard-actions" }, ...activityButtons(stage, hd, acts, close), more));
      card.addEventListener("click", (ev) => ev.stopPropagation());
      card.style.left = `${Math.min(e.clientX - sr.left + 10, sr.width - 250)}px`;
      card.style.top = `${Math.min(e.clientY - sr.top + 10, sr.height - 160)}px`;
      stage.appendChild(card);
    },
    true,
  );
  stage.addEventListener("pointerdown", (e) => {
    if (card && !(e.target instanceof Element && e.target.closest(".cs-infocard"))) close();
  });
  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing") close();
  };
}

/**
 * Touch has no right-click: a long press (550 ms, a finger that stays put)
 * sends the same contextmenu event at that point, so every card and the
 * tray answer it exactly as they answer a right-click.
 */
export function attachLongPress(stage: HTMLElement): void {
  let timer = 0;
  let start: [number, number] | null = null;
  const cancel = (): void => {
    window.clearTimeout(timer);
    start = null;
  };
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    start = [e.clientX, e.clientY];
    const target = e.target as Element;
    const { clientX, clientY } = e;
    timer = window.setTimeout(() => {
      start = null;
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY }));
    }, 550);
  });
  stage.addEventListener("pointermove", (e) => {
    if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) cancel();
  });
  stage.addEventListener("pointerup", cancel);
  stage.addEventListener("pointercancel", cancel);
}
