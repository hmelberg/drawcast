// Reading-instead-of-the-figure surface (interactivity spec §7.4, §13): a
// modal over the stage for link kinds that frame — YouTube's embed domain
// exists to allow it; PDFs from friendly hosts do too, and the permanent
// "Open in new tab ↗" escape covers hosts that silently refuse (an
// X-Frame-Options block fires no JS event, so it cannot be detected).
// Player-only by construction: the export never mounts controls.

import type { RenderHandle } from "../render";
import { h } from "./dom";

export interface MediaModalOpts {
  /** What the iframe loads (embed URL for YouTube, the document for PDF). */
  src: string;
  /** Where "Open in new tab ↗" goes — the original link, always shown. */
  href: string;
  /** iframe allow attribute (YouTube wants fullscreen etc.). */
  allow?: string;
  /** Called once, however the modal went away — a gate that parked the run
   *  on it resolves here. */
  onClose?: () => void;
}

export function openMediaModal(stage: HTMLElement, hd: RenderHandle, opts: MediaModalOpts): { close: () => void } {
  stage.querySelector(".cs-mediamodal")?.remove();

  const frame = h("iframe", { class: "cs-mediamodal-frame", src: opts.src, ...(opts.allow ? { allow: opts.allow } : {}) });
  const newTab = h("a", { class: "cs-mediamodal-open", href: opts.href, target: "_blank", rel: "noopener" }, "Open in new tab ↗");
  const closeBtn = h("button", { class: "cs-mediamodal-close", title: "Close" }, "✕");
  const box = h("div", { class: "cs-mediamodal-box" }, h("div", { class: "cs-mediamodal-bar" }, newTab, closeBtn), frame);
  const scrim = h("div", { class: "cs-mediamodal" }, box);

  let dead = false;
  const close = (): void => {
    if (dead) return;
    dead = true;
    hd.timeline.callbacks.onState = prevOnState;
    hd.timeline.callbacks.onStep = prevOnStep;
    window.removeEventListener("keydown", onKey);
    scrim.remove();
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing") close();
  };
  const prevOnStep = hd.timeline.callbacks.onStep;
  hd.timeline.callbacks.onStep = (completed, total) => {
    prevOnStep?.(completed, total);
    close();
  };

  scrim.addEventListener("click", (e) => {
    e.stopPropagation(); // never the stage's play/pause toggle
    if (e.target === scrim) close();
  });
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });
  window.addEventListener("keydown", onKey);
  stage.appendChild(scrim);
  return { close };
}
