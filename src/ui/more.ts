// The corner list on the stage (Hans 2026-09-29): a small "Sources" chip in
// a corner of the figure that opens, upward from a bottom corner and
// downward from a top one, into a list of the works the cast draws on and
// anything else worth a click — a thumbnail, a title (a link when there is
// one), who and when, a line. Model in ui/more-model.ts.
//
// It is DOM over the stage, never ink on it: the video and PNG exports draw
// the svg, so the chip is in no frame. It is a child of the stage, so it
// goes with the figure at every playlist cut and scales with it in
// fullscreen; `.cs-more` is in CONTROL_SELECTOR (ui/gates.ts), so a press on
// it is never the stage's play/pause, and the stage's own capture handlers
// (link elements, info cards, insets) step aside for it.
//
// Opening pauses a playing cast — a list is read, not watched — and it closes
// on an outside press, on Escape (focus back on the chip) and when play
// resumes. A link opens in a new tab.

import type { RenderHandle } from "../render";
import { h } from "./dom";
import { icon } from "./icons";
import { moreModel, opensUp, type MoreEntry } from "./more-model";

/** Class on the stage while a bottom corner holds the chip: the caption band
 *  keeps clear of it (styles.css, `--cs-more-reserve`). */
const BOTTOM_CLASS = "cs-more-bottom";

let seq = 0;

function entryView(e: MoreEntry, onOpen: () => void): HTMLElement {
  const body = h("div", { class: "cs-more-body" });
  if (e.href) {
    const a = h("a", { class: "cs-more-title", href: e.href, target: "_blank", rel: "noopener noreferrer" }, e.title);
    a.addEventListener("click", onOpen);
    body.appendChild(a);
  } else {
    body.appendChild(h("span", { class: "cs-more-title" }, e.title));
  }
  if (e.byline) body.appendChild(h("div", { class: "cs-more-by" }, e.byline));
  if (e.text) body.appendChild(h("div", { class: "cs-more-text" }, e.text));
  if (e.hint) body.appendChild(h("div", { class: "cs-more-hint", "aria-hidden": "true" }, e.hint));
  const li = h("li", { class: "cs-more-entry" });
  if (e.image) {
    // Small, lazy, and gone without a trace when it does not load.
    const img = h("img", { class: "cs-more-thumb", src: e.image, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img.remove());
    li.appendChild(img);
  }
  li.appendChild(body);
  return li;
}

/** Dock the corner list on the stage. No-op when the spec offers nothing. */
export function attachMore(stage: HTMLElement, hd: RenderHandle): void {
  stage.querySelectorAll(".cs-more").forEach((el) => el.remove());
  stage.classList.remove(BOTTOM_CLASS);
  const model = moreModel(hd.spec);
  if (!model) return;

  const id = `cs-more-${++seq}`;
  const up = opensUp(model.corner);
  const root = h("div", { class: `cs-more cs-more-${model.corner}${up ? " cs-more-up" : ""}` });
  const chip = h(
    "button",
    { class: "cs-more-chip", type: "button", "aria-expanded": "false", "aria-controls": id, title: model.label },
    icon("book"),
    h("span", { class: "cs-more-label" }, model.label),
  );
  const list = h("ul", { class: "cs-more-list" }, ...model.entries.map((e) => entryView(e, () => close(false))));
  const pop = h("div", { class: "cs-more-pop", id, role: "region", "aria-label": model.label }, list);
  pop.hidden = true;
  root.append(chip, pop);
  stage.appendChild(root);

  const onDocPress = (e: PointerEvent): void => {
    if (!root.isConnected) return void document.removeEventListener("pointerdown", onDocPress, true);
    if (e.target instanceof Node && root.contains(e.target)) return;
    close(false);
  };
  function open(): void {
    if (!pop.hidden) return;
    if (hd.timeline.state === "playing") hd.timeline.pause();
    // Never taller than the stage leaves it: the list scrolls instead.
    const room = stage.clientHeight - chip.offsetHeight - 24;
    if (room > 0) pop.style.maxHeight = `${Math.min(room, 360)}px`;
    pop.hidden = false;
    root.classList.add("cs-more-open");
    chip.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onDocPress, true);
  }
  function close(refocus: boolean): void {
    if (pop.hidden) return;
    pop.hidden = true;
    root.classList.remove("cs-more-open");
    chip.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDocPress, true);
    if (refocus) chip.focus();
  }

  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pop.hidden) open();
    else close(false);
  });
  root.addEventListener("click", (e) => e.stopPropagation());
  root.addEventListener("contextmenu", (e) => e.stopPropagation());
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || pop.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  });

  // The caption band keeps clear of a bottom chip: as wide as the chip, on
  // both sides, since the band is centred.
  if (up) {
    stage.classList.add(BOTTOM_CLASS);
    const reserve = (): void => {
      const w = root.offsetWidth;
      if (w > 0) stage.style.setProperty("--cs-more-reserve", `${w + 8}px`);
    };
    reserve();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(reserve).observe(root);
  }

  // Play puts the list away. CHAIN, never replace (see controls.ts).
  const prev = hd.timeline.callbacks;
  hd.timeline.callbacks = {
    ...prev,
    onState: (s) => {
      prev.onState?.(s);
      if (s === "playing") close(false);
    },
  };
  if (model.open) open();
}
