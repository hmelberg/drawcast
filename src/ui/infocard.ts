// The info card's stage wiring (interactivity spec §9.5, §13): while paused,
// a left-click on a card-bearing element opens its card at the pointer —
// the inert object's natural action — and a right-click on one does the
// same (the gesture pair's element scope; background right-clicks fall
// through to the tray's handler). Cards close on outside click, Esc, ✕,
// or any honest timeline movement. Never mounted by export (controls are
// not either), so none of this can appear in a movie.
//
// V1 actions: Search (always) and, for portraits, a Wikipedia summary line
// with Read more — fetched from the CORS-open REST summary endpoint the
// portrait pipeline already uses for the image itself.

import type { RenderHandle } from "../render";
import { INITIAL_STATE } from "../render/plan";
import { wikiSummaryUrl } from "../render/portrait";
import { chessSquareAt, pianoKeyAt, pianoOctaves } from "../render/widgets";
import { elementBBoxes } from "../layout/layout";
import { makeBrowserMeasure } from "../render/svg-backend";
import { scenes } from "../scenes/registry";
import { cardTargets, searchUrl, type CardTarget } from "./card-model";
import { linkActionsFor } from "./link-model";
import { openMediaModal } from "./media-modal";
import { h, logicalPoint } from "./dom";
import { hitElement } from "./hit";
import type { BBox } from "../layout/geometry";

const SUMMARY_MAX = 200;

function trimExtract(s: string): string {
  if (s.length <= SUMMARY_MAX) return s;
  const cut = s.slice(0, SUMMARY_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), SUMMARY_MAX - 30))}…`;
}

export function attachInfoCards(stage: HTMLElement, hd: RenderHandle): void {
  const targets = cardTargets(hd.spec);
  if (targets.size === 0) return; // scenes without cards pay nothing

  const interactions = (hd.spec.template && scenes[hd.spec.template]?.manifest.interactions) || [];
  const flip = hd.spec.params?.["flip"] === true;
  const octaves = pianoOctaves(hd.spec.params);
  let boxes: ReadonlyMap<string, BBox> | null = null;

  let card: HTMLElement | null = null;
  const closeCard = (): void => {
    card?.remove();
    card = null;
    window.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") closeCard();
  };

  // Honest timeline movement closes the card (chained, like every add-on).
  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing") closeCard();
  };
  const prevOnStep = hd.timeline.callbacks.onStep;
  hd.timeline.callbacks.onStep = (completed, total) => {
    prevOnStep?.(completed, total);
    closeCard();
  };

  /** The card target under a pointer event, respecting the paused boundary's
   *  visibility (a portrait the storyboard hasn't drawn yet has no card)
   *  and standing aside on the instruments' own hit areas. */
  const targetAt = (e: MouseEvent): CardTarget | null => {
    if (stage.querySelector(".cs-figgate, .cs-cardgate")) return null;
    const p = logicalPoint(stage, e);
    if (!p) return null;
    if (interactions.includes("chess") && chessSquareAt(flip, p) !== null) return null;
    if (interactions.includes("piano") && pianoKeyAt(octaves, p) !== null) return null;
    boxes ??= elementBBoxes(hd.layout, makeBrowserMeasure());
    // Hit-test only what is on screen at this boundary: an invisible
    // element's smaller box must never shadow a visible card element (the
    // cameo-over-undrawn-table bug), and a card never opens for something
    // the viewer cannot see.
    const n = hd.timeline.position;
    const visibleIds = new Set(n > 0 ? hd.plan.states[n - 1].visible : INITIAL_STATE.visible);
    const visBoxes = new Map<string, BBox>();
    for (const [id, b] of boxes) if (visibleIds.has(id)) visBoxes.set(id, b);
    const id = hitElement(visBoxes, p, 12);
    return (id !== null && targets.get(id)) || null;
  };

  const openCard = (t: CardTarget, clientX: number, clientY: number): void => {
    closeCard();
    const title = h("div", { class: "cs-infocard-title" }, t.name);
    const closeBtn = h("button", { class: "cs-infocard-close", title: "Close" }, "✕");
    closeBtn.addEventListener("click", closeCard);
    const summary = h("div", { class: "cs-infocard-summary", hidden: "" });
    const actions = h("div", { class: "cs-infocard-actions" });
    const link = (href: string, label: string): HTMLAnchorElement => {
      const a = h("a", { href, target: "_blank", rel: "noopener" }, label);
      a.addEventListener("click", (e) => e.stopPropagation());
      return a;
    };
    card = h("div", { class: "cs-infocard" }, closeBtn, title, summary, actions);
    card.addEventListener("click", (e) => e.stopPropagation());
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    // Authored links first (the author's intent), then Read more, then the
    // zero-authoring Search. YouTube and PDF open the modal surface; wiki
    // and plain urls are honest anchors.
    const linkActs = linkActionsFor(t.links);
    for (const a of linkActs) {
      if (a.link.kind === "youtube") {
        const id = a.link.id;
        const b = h("button", { class: "cs-infocard-act" }, `${a.label} ▸`);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          closeCard();
          openMediaModal(stage, hd, {
            src: `https://www.youtube-nocookie.com/embed/${id}`,
            href: a.url,
            allow: "encrypted-media; picture-in-picture; fullscreen",
          });
        });
        actions.appendChild(b);
      } else if (a.link.kind === "pdf") {
        const b = h("button", { class: "cs-infocard-act" }, `${a.label} ▸`);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          closeCard();
          openMediaModal(stage, hd, { src: a.url, href: a.url });
        });
        actions.appendChild(b);
      } else {
        actions.appendChild(link(a.url, `${a.label} ↗`));
      }
    }

    // One summary per card: the portrait's person wins; else the first
    // authored wiki link feeds the same REST endpoint in its own language.
    const wikiAct = linkActs.find((a) => a.link.kind === "wiki");
    let readMore: HTMLAnchorElement | null = null;
    let summaryRest: string | null = null;
    if (t.kind === "portrait" && t.wikiName) {
      readMore = link(`https://en.wikipedia.org/wiki/${encodeURIComponent(t.wikiName.replace(/\s+/g, "_"))}`, "📖 Read more ↗");
      actions.appendChild(readMore);
      summaryRest = wikiSummaryUrl(t.wikiName);
    } else if (wikiAct && wikiAct.link.kind === "wiki") {
      summaryRest = `https://${wikiAct.link.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiAct.link.title)}`;
    }
    actions.appendChild(link(searchUrl(t.name, hd.spec.title), "🔍 Search ↗"));

    if (summaryRest) {
      const mine = card;
      void fetch(summaryRest)
        .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
        .then((j) => {
          if (card !== mine || !j) return;
          const s = j as { extract?: string; content_urls?: { desktop?: { page?: string } } };
          if (typeof s.extract === "string" && s.extract.trim() !== "") {
            summary.textContent = trimExtract(s.extract.trim());
            summary.hidden = false;
          }
          const page = s.content_urls?.desktop?.page;
          if (typeof page === "string" && readMore) readMore.href = page;
        })
        .catch(() => undefined);
    }

    // At the pointer, clamped inside the stage.
    const sr = stage.getBoundingClientRect();
    card.style.left = `${Math.min(clientX - sr.left + 10, sr.width - 250)}px`;
    card.style.top = `${Math.min(clientY - sr.top + 10, sr.height - 90)}px`;
    stage.appendChild(card);
    window.addEventListener("keydown", onKey);
  };

  // Left-click, paused: a card element's natural action IS its card (§13).
  // Capture phase so the stage's play/pause toggle never fires for it; an
  // open card absorbs the closing click too (closing must not resume).
  stage.addEventListener(
    "click",
    (e) => {
      if (card && e.target instanceof Element && !card.contains(e.target)) {
        closeCard();
        e.stopPropagation();
        return;
      }
      if (hd.timeline.state === "playing") return;
      if (e.target instanceof Element && e.target.closest("button, a")) return;
      const t = targetAt(e);
      if (!t) return;
      e.stopPropagation();
      openCard(t, e.clientX, e.clientY);
    },
    true,
  );

  // Right-click on a card element: the gesture pair's element scope. Pauses
  // first when playing; background right-clicks fall through to the tray.
  stage.addEventListener(
    "contextmenu",
    (e) => {
      if (hd.timeline.state === "playing") {
        // Pausing changes what is on stage under the pointer, so pause
        // BEFORE hit-testing; a background right-click stays the tray's
        // (or, on tray-less scenes, the browser's) to handle.
        if (targetAt(e) === null) return;
        hd.timeline.pause();
      }
      const t = targetAt(e);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      openCard(t, e.clientX, e.clientY);
    },
    true,
  );

  // Quiet affordance while paused: the cursor knows what carries a card.
  stage.addEventListener("pointermove", (e) => {
    const on = hd.timeline.state !== "playing" && targetAt(e) !== null;
    stage.classList.toggle("cs-cardable", on);
  });
}
