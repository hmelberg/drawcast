// A paused click on an inset shows its page full size (spec 2026-09-17-inset
// §4.9): the media-modal shell — scrim, box, bar, ✕, Escape, outside click,
// close on honest timeline movement — around a fresh render() of the authored
// source spec at its final frame. "Go to page" asks the playlist session to
// jump there. Player-only by construction: the export never mounts controls.
import type { InsetPicture } from "../layout/inset";
import { render, type RenderHandle } from "../render";
import { h } from "./dom";

export function openInsetModal(stage: HTMLElement, hd: RenderHandle, pic: InsetPicture): { close: () => void } {
  stage.querySelector(".cs-insetmodal")?.remove();
  const host = h("div", { class: "cs-insetmodal-host" });
  const goBtn = h("button", { class: "cs-insetmodal-go", title: "Go to this page" }, "Go to page →");
  const closeBtn = h("button", { class: "cs-mediamodal-close", title: "Close" }, "✕");
  const title = h("span", { class: "cs-insetmodal-title" }, pic.spec.title ?? `Page ${pic.index + 1}`);
  const box = h("div", { class: "cs-mediamodal-box" }, h("div", { class: "cs-mediamodal-bar" }, title, goBtn, closeBtn), host);
  const scrim = h("div", { class: "cs-mediamodal cs-insetmodal" }, box);

  let dead = false;
  let inner: RenderHandle | null = null;
  const close = (): void => {
    if (dead) return;
    dead = true;
    hd.timeline.callbacks.onState = prevOnState;
    hd.timeline.callbacks.onStep = prevOnStep;
    window.removeEventListener("keydown", onKey);
    inner?.destroy();
    scrim.remove();
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
  goBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
    stage.dispatchEvent(new CustomEvent("cs-goto-item", { bubbles: true, detail: { index: pic.index } }));
  });
  window.addEventListener("keydown", onKey);
  stage.appendChild(scrim);

  void render(pic.spec, host, { style: hd.style, mode: "silent" })
    .then((h2) => {
      if (dead) {
        h2.destroy();
        return;
      }
      inner = h2;
      h2.timeline.renderUpTo(h2.plan.steps.length);
    })
    .catch((err: unknown) => {
      host.textContent = `Could not draw this page: ${(err as Error).message}`;
    });
  return { close };
}
