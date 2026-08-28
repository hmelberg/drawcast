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
import { bboxOfText } from "../layout/geometry";
import { leafDrawables, type TextDrawable } from "../layout/model";
import { makeBrowserMeasure } from "../render/svg-backend";
import { scenes } from "../scenes/registry";
import { cardTargets, meaningfulName, searchUrl, type CardTarget } from "./card-model";
import { contextWords, matchWiki, selectedPhrase, type WikiCandidate } from "./wiki-match";
import { linkActionsFor } from "./link-model";
import { openMediaModal } from "./media-modal";
import { h, logicalPoint } from "./dom";
import { hitElement } from "./hit";
import type { BBox } from "../layout/geometry";

const SUMMARY_MAX = 200;

/**
 * Wikipedia's keyless search: title, one-line description and thumbnail for
 * each hit, in ONE request, CORS-open. `origin=*` is what makes the action API
 * answer `access-control-allow-origin: *` for an anonymous browser caller.
 */
async function searchWiki(term: string, limit = 6): Promise<WikiCandidate[]> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search` +
    `&gsrsearch=${encodeURIComponent(term)}&gsrlimit=${limit}&prop=description|pageimages&piprop=thumbnail&pithumbsize=320`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const j = (await res.json()) as { query?: { pages?: Record<string, { title?: string; description?: string; thumbnail?: { source?: string } }> } };
  const pages = Object.values(j.query?.pages ?? {});
  return pages
    .filter((p): p is { title: string; description?: string; thumbnail?: { source?: string } } => typeof p.title === "string")
    .map((p) => ({ title: p.title, description: p.description ?? "", thumbnail: p.thumbnail?.source }));
}

function trimExtract(s: string): string {
  if (s.length <= SUMMARY_MAX) return s;
  const cut = s.slice(0, SUMMARY_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), SUMMARY_MAX - 30))}…`;
}

export function attachInfoCards(stage: HTMLElement, hd: RenderHandle): void {
  // The words a template DREW count too, not just the spec's own elements —
  // otherwise an axis caption, a node's text and a legend entry are all dead.
  // Each word's owning part comes from the drawable tree (the same walk the
  // lint does), because a group's children need not share its id prefix.
  const ownerOf = new Map<string, string>();
  for (const top of hd.layout.drawables) for (const leaf of leafDrawables([top])) ownerOf.set(leaf.id, top.id);
  const drawnTexts = leafDrawables(hd.layout.drawables)
    .filter((d): d is TextDrawable => d.kind === "text")
    .map((d) => ({ id: d.id, text: d.text, owner: ownerOf.get(d.id) }));
  const targets = cardTargets(hd.spec, { order: hd.layout.order, texts: drawnTexts });
  // A figure of pure geometry carries no card — but it still NARRATES, and a
  // viewer can still select a phrase in that narration, so the caption half is
  // wired regardless. With neither, the scene pays nothing.
  if (targets.size === 0 && !stage.parentElement?.querySelector(".cs-caption")) return;

  const interactions = (hd.spec.template && scenes[hd.spec.template]?.manifest.interactions) || [];
  const flip = hd.spec.params?.["flip"] === true;
  const octaves = pianoOctaves(hd.spec.params);
  let boxes: ReadonlyMap<string, BBox> | null = null;

  /**
   * Hit boxes for every card target: the command-addressable elements, plus
   * a box around each DRAWN WORD that carries a card of its own. The word's
   * own box is what gets clicked — a caption belonging to `axes` must not
   * make the whole coordinate cross clickable — and since hitElement picks
   * the SMALLEST containing box, a word always wins over the part behind it.
   */
  const hitBoxes = (): ReadonlyMap<string, BBox> => {
    if (boxes) return boxes;
    const measure = makeBrowserMeasure();
    const map = new Map<string, BBox>(elementBBoxes(hd.layout, measure));
    for (const d of leafDrawables(hd.layout.drawables)) {
      if (d.kind !== "text" || !targets.has(d.id) || map.has(d.id)) continue;
      map.set(d.id, bboxOfText(d, measure));
    }
    boxes = map;
    return map;
  };

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
    // Hit-test only what is on screen at this boundary: an invisible
    // element's smaller box must never shadow a visible card element (the
    // cameo-over-undrawn-table bug), and a card never opens for something
    // the viewer cannot see. A drawn word inherits the visibility of the part
    // that owns it — it appears and is erased with that part, never alone.
    const n = hd.timeline.position;
    const visibleIds = new Set(n > 0 ? hd.plan.states[n - 1].visible : INITIAL_STATE.visible);
    const visBoxes = new Map<string, BBox>();
    for (const [id, b] of hitBoxes()) {
      if (visibleIds.has(targets.get(id)?.owner ?? id)) visBoxes.set(id, b);
    }
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

    /** Fill the summary line (and Read more) from a REST summary endpoint. */
    const fillSummary = (restUrl: string, into: HTMLElement): void => {
      const mine = card;
      void fetch(restUrl)
        .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
        .then((j) => {
          if (card !== mine || !j) return;
          const s = j as { extract?: string; content_urls?: { desktop?: { page?: string } } };
          if (typeof s.extract === "string" && s.extract.trim() !== "") {
            into.textContent = trimExtract(s.extract.trim());
            into.hidden = false;
          }
          const page = s.content_urls?.desktop?.page;
          if (typeof page === "string" && readMore) readMore.href = page;
        })
        .catch(() => undefined);
    };

    if (summaryRest) {
      fillSummary(summaryRest, summary);
    } else if (meaningfulName(t.name)) {
      // No authored identity: ask Wikipedia what this WORD could mean, and let
      // the figure's own words decide which sense (src/ui/wiki-match.ts). One
      // keyless search call, only on a click, and no model is involved —
      // scoring is string arithmetic, so this costs nothing per card.
      const mine = card;
      void searchWiki(t.name)
        .then((candidates) => {
          if (card !== mine || candidates.length === 0) return;
          const match = matchWiki(candidates, contextWords(hd.spec), t.name);
          if (match.kind === "confident") showSense(match.page, mine);
          else if (match.kind === "choice") offerSenses(match.pages, mine);
        })
        .catch(() => undefined);
    }

    /** A settled sense: its picture, its summary, and Read more. */
    function showSense(page: { title: string; thumbnail?: string }, mine: HTMLElement): void {
      if (card !== mine) return;
      if (page.thumbnail) {
        const img = h("img", { class: "cs-infocard-thumb", src: page.thumbnail, alt: page.title, loading: "lazy" });
        mine.insertBefore(img, summary);
      }
      readMore = link(`https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/\s+/g, "_"))}`, "📖 Read more ↗");
      actions.insertBefore(readMore, actions.firstChild);
      fillSummary(wikiSummaryUrl(page.title), summary);
    }

    /**
     * Several senses fit: ask instead of guessing. Picking one replaces the
     * row with that sense — the same card, one click deeper, never a wrong
     * summary presented as fact.
     */
    function offerSenses(pages: { title: string; description: string; thumbnail?: string }[], mine: HTMLElement): void {
      if (card !== mine) return;
      const row = h("div", { class: "cs-infocard-senses" }, h("span", { class: "cs-infocard-senseslabel" }, "Did you mean"));
      for (const p of pages) {
        const b = h("button", { class: "cs-infocard-sense", title: p.description }, p.title);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          row.remove();
          showSense(p, mine);
        });
        row.appendChild(b);
      }
      mine.insertBefore(row, actions);
    }

    // At the pointer, clamped inside the stage.
    const sr = stage.getBoundingClientRect();
    card.style.left = `${Math.min(clientX - sr.left + 10, sr.width - 250)}px`;
    card.style.top = `${Math.min(clientY - sr.top + 10, sr.height - 90)}px`;
    stage.appendChild(card);
    window.addEventListener("keydown", onKey);
  };

  // ---- selecting a phrase in the caption -----------------------------------
  // The narration says things the canvas never draws — "the dismal science",
  // "regression to the mean" — and no phrase detector finds those reliably:
  // English does not capitalize its concepts, and a run of capitals glues
  // "Norway Sweden Denmark Finland" into one word. So the VIEWER draws the
  // boundary, which is both exact and a gesture they already know.
  //
  // Free of the play/pause conflict by construction: the caption is a SIBLING
  // of the stage, and togglePlay is bound to the stage alone, so dragging to
  // select never touches playback.
  const caption = stage.parentElement?.querySelector<HTMLElement>(".cs-caption") ?? null;
  if (caption) {
    let chip: HTMLElement | null = null;
    const hideChip = (): void => {
      chip?.remove();
      chip = null;
    };

    const offerLookup = (): void => {
      const sel = window.getSelection();
      const phrase = sel ? selectedPhrase(sel.toString()) : null;
      if (!sel || sel.rangeCount === 0 || !caption.contains(sel.anchorNode) || phrase === null) {
        hideChip();
        return;
      }
      hideChip();
      // The phrase is captured NOW, not when the chip is clicked: pressing a
      // button collapses the selection in some browsers.
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const cr = caption.getBoundingClientRect();
      chip = h("button", { class: "cs-lookup", title: `Look up "${phrase}"` }, `🔍 ${phrase.length > 28 ? `${phrase.slice(0, 27)}…` : phrase}`);
      chip.style.left = `${Math.min(Math.max(rect.left + rect.width / 2 - cr.left, 40), cr.width - 40)}px`;
      chip.style.top = `${Math.max(rect.top - cr.top - 4, 4)}px`;
      chip.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection alive
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        hideChip();
        openCard({ id: "__selection", name: phrase, kind: "plain", links: [] }, e.clientX, e.clientY);
      });
      caption.appendChild(chip);
    };

    caption.addEventListener("mouseup", () => setTimeout(offerLookup, 0));
    caption.addEventListener("touchend", () => setTimeout(offerLookup, 0));
    // The caption is rewritten on every narrated beat, which destroys the
    // selection — the offer must go with it.
    const prevStep = hd.timeline.callbacks.onStep;
    hd.timeline.callbacks.onStep = (completed, total) => {
      prevStep?.(completed, total);
      hideChip();
    };
    const prevState = hd.timeline.callbacks.onState;
    hd.timeline.callbacks.onState = (s) => {
      prevState?.(s);
      if (s === "playing") hideChip();
    };
  }

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
