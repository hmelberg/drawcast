// The paused click that opens an inset's page (spec 2026-09-17-inset §4.9).
// Capture phase like the info cards, so the stage's play/pause toggle never
// sees it; stands aside while a gate is up, while playing, on chrome, and for
// an inset that carries `link` (that one gets an info card instead). Only
// what is on screen at this boundary is hit-tested (the R9 lesson, infocard.ts).
import { elementBBoxes } from "../layout/layout";
import type { InsetPicture } from "../layout/inset";
import type { BBox } from "../layout/geometry";
import type { RenderHandle } from "../render";
import { sceneAt } from "../render/plan";
import { makeBrowserMeasure } from "../render/svg-backend";
import { logicalPoint } from "./dom";
import { gateIsOpen } from "./gates";
import { hitElement } from "./hit";
import { openInsetModal } from "./inset-modal";

export function attachInsetZoom(stage: HTMLElement, hd: RenderHandle): void {
  const pictures = new Map<string, InsetPicture>();
  for (const el of hd.spec.elements ?? []) {
    if (el.type === "inset" && el.picture && !("error" in el.picture) && el.link === undefined) pictures.set(el.id, el.picture);
  }
  if (pictures.size === 0) return;
  const measure = makeBrowserMeasure();
  const targetAt = (e: MouseEvent): string | null => {
    if (gateIsOpen(stage)) return null;
    const p = logicalPoint(stage, e);
    if (!p) return null;
    const visible = new Set(sceneAt(hd.plan, hd.timeline.position).visible);
    const layout = hd.timeline.paintedLayout() ?? hd.layout;
    const boxes = new Map<string, BBox>();
    for (const [id, b] of elementBBoxes(layout, measure)) if (pictures.has(id) && visible.has(id)) boxes.set(id, b);
    return hitElement(boxes, p, 8);
  };
  stage.addEventListener(
    "click",
    (e) => {
      if (hd.timeline.state === "playing") return;
      if (e.target instanceof Element && e.target.closest("button, a, .cs-insetmodal")) return;
      const id = targetAt(e);
      if (id === null) return;
      e.stopPropagation();
      openInsetModal(stage, hd, pictures.get(id)!);
    },
    true,
  );
  stage.addEventListener("pointermove", (e) => {
    if (hd.timeline.state === "playing") return;
    stage.classList.toggle("cs-insetable", targetAt(e) !== null);
  });
}
