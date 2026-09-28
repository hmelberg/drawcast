// The click half of the `link` element (spec 2026-09-28-drawcast-links §3):
// a press on a visible link opens its target — a new tab, this page, or a
// window over the video — and never also toggles play/pause. Hit-tested on
// the stage like the info cards (logicalPoint through the live viewBox, so
// the camera never puts the click somewhere the ink is not), against the
// link group's own box. The ink is layout/tier2.ts's linkDrawable.

import type { BBox } from "../layout/geometry";
import type { Drawable } from "../layout/model";
import type { RenderHandle } from "../render";
import { sceneAt } from "../render/plan";
import type { PlayerState } from "../render/player";
import type { SpecElement } from "../spec/types";
import { resolveLink, type Resolved } from "../links/resolve";
import { linkBase, openDrawingLink, viewerBase } from "../links/base";
import { registerControlRegion } from "./control-press";
import { logicalPoint } from "./dom";
import { gateIsOpen } from "./gates";
import { openMediaModal } from "./media-modal";

export type OpenMode = "tab" | "here" | "window";

/** How a click opens: `auto` is this page once the drawcast has finished
 *  (the end page), a new tab before — the viewer keeps their place. A
 *  modified click keeps the browser's own meaning: a new tab. */
export function openModeFor(open: SpecElement["open"], state: PlayerState, modified: boolean): OpenMode {
  if (modified) return "tab";
  if (open === "tab" || open === "here" || open === "window") return open;
  return state === "done" ? "here" : "tab";
}

/** The visible link whose box holds `p` — the smallest, when boxes nest. */
export function linkAt(links: { id: string; box: BBox }[], visible: ReadonlySet<string>, p: [number, number]): string | null {
  let best: { id: string; area: number } | null = null;
  for (const { id, box } of links) {
    if (!visible.has(id)) continue;
    if (p[0] < box.x || p[0] > box.x + box.w || p[1] < box.y || p[1] > box.y + box.h) continue;
    const area = box.w * box.h;
    if (!best || area < best.area) best = { id, area };
  }
  return best?.id ?? null;
}

/** Only a hash changed: the viewer does not remount on that, so reload. */
function navigate(href: string): void {
  const next = new URL(href, location.href);
  const sameDoc = next.origin === location.origin && next.pathname === location.pathname && next.search === location.search;
  location.assign(next.href);
  if (sameDoc) location.reload();
}

export function attachLinks(stage: HTMLElement, hd: RenderHandle): void {
  const els = (hd.spec.elements ?? []).filter((e) => e.type === "link");
  if (els.length === 0) return;
  const byId = new Map(els.map((e) => [e.id, e]));

  const boxes = (): { id: string; box: BBox }[] => {
    const drawables: Drawable[] = (hd.timeline.paintedLayout() ?? hd.layout).drawables;
    const out: { id: string; box: BBox }[] = [];
    for (const d of drawables) if (d.kind === "group" && d.box && byId.has(d.id)) out.push({ id: d.id, box: d.box });
    return out;
  };
  const hitAt = (e: MouseEvent): SpecElement | null => {
    if (gateIsOpen(stage)) return null;
    const p = logicalPoint(stage, e);
    if (!p) return null;
    // What is on screen: the boundary's ink, and — while a step is under
    // way (playing, or paused inside it) — what that step is drawing: an
    // end page draws its cards and speaks in one step, and the card under
    // the pointer is there to be clicked while the voice goes on.
    const n = hd.timeline.position;
    const visible = new Set(sceneAt(hd.plan, n).visible);
    if (hd.timeline.state !== "done" && n < hd.plan.steps.length) for (const id of sceneAt(hd.plan, n + 1).visible) visible.add(id);
    const id = linkAt(boxes(), visible, p);
    return id ? (byId.get(id) ?? null) : null;
  };

  const open = (el: SpecElement, mode: OpenMode): void => {
    const r: Resolved | null = resolveLink(el.href, linkBase(), viewerBase());
    if (!r) return;
    if (hd.timeline.state === "playing") hd.timeline.pause();
    // An app lecture has no address to put in a tab or a frame: it opens here.
    if (r.drawingId !== undefined) {
      openDrawingLink(r.drawingId);
      return;
    }
    if (!r.href) return;
    if (mode === "tab") window.open(r.href, "_blank", "noopener");
    else if (mode === "window") openMediaModal(stage, hd, { src: r.href, href: r.href });
    else navigate(r.href);
  };

  registerControlRegion(stage, (e) => hitAt(e) !== null);
  stage.addEventListener(
    "click",
    (e: MouseEvent) => {
      if (e.button !== 0) return;
      const el = hitAt(e);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation(); // never also the stage's play/pause toggle
      open(el, openModeFor(el.open, hd.timeline.state, e.metaKey || e.ctrlKey || e.shiftKey));
    },
    { capture: true },
  );
  stage.addEventListener("auxclick", (e: MouseEvent) => {
    if (e.button !== 1) return;
    const el = hitAt(e);
    if (!el) return;
    e.preventDefault();
    open(el, "tab");
  });
  stage.addEventListener("pointermove", (e: PointerEvent) => {
    stage.classList.toggle("cs-link-hover", hitAt(e) !== null);
  });
}
