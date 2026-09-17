// The paused click that opens an inset's page (spec 2026-09-17-inset §4.9).
// Capture phase like the info cards, so the stage's play/pause toggle never
// sees it; stands aside while a gate is up, while playing, on chrome, and for
// an inset that carries `link` OR that infocard.ts's own targeting would
// otherwise claim (a label's attach_to naming the inset is an ordinary way to
// caption a picture — that one gets an info card instead, never both: both
// modules register capture-phase click listeners on the same stage node, and
// stopPropagation() only stops the event reaching the NEXT node, not a
// sibling listener already bound to this one — attachInfoCards runs first and
// only e.stopPropagation()s once it actually opens a card, so a click that
// slips past it still reaches this listener unless the target is excluded
// here too). Only what is on screen at this boundary is hit-tested (the R9
// lesson, infocard.ts).
import { leafDrawables, type TextDrawable } from "../layout/model";
import { elementBBoxes } from "../layout/layout";
import type { InsetPicture } from "../layout/inset";
import type { BBox } from "../layout/geometry";
import type { RenderHandle } from "../render";
import { sceneAt } from "../render/plan";
import { makeBrowserMeasure } from "../render/svg-backend";
import { cardTargets } from "./card-model";
import { logicalPoint } from "./dom";
import { gateIsOpen } from "./gates";
import { hitElement } from "./hit";
import { sceneNamesFor } from "./infocard";
import { openInsetModal } from "./inset-modal";

export function attachInsetZoom(stage: HTMLElement, hd: RenderHandle): void {
  // The identical LayoutFacts infocard.ts:157 builds — order, the drawn
  // words, and the scene's own names — so this excludes exactly the ids
  // attachInfoCards would claim for itself, not an approximation of them.
  const ownerOf = new Map<string, string>();
  for (const top of hd.layout.drawables) for (const leaf of leafDrawables([top])) ownerOf.set(leaf.id, top.id);
  const drawnTexts = leafDrawables(hd.layout.drawables)
    .filter((d): d is TextDrawable => d.kind === "text")
    .map((d) => ({ id: d.id, text: d.text, owner: ownerOf.get(d.id) }));
  const cards = cardTargets(hd.spec, { order: hd.layout.order, texts: drawnTexts, sceneNames: sceneNamesFor(hd) });

  const pictures = new Map<string, InsetPicture>();
  for (const el of hd.spec.elements ?? []) {
    if (el.type === "inset" && el.picture && !("error" in el.picture) && el.link === undefined && !cards.has(el.id)) pictures.set(el.id, el.picture);
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
