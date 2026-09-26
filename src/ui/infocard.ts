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
import { activityButtons } from "./activities";
import { activitiesFor } from "./quiz-model";
import { sceneAt } from "../render/plan";
import { wikiSummaryUrl } from "../render/portrait";
import { chessSquareAt, periodicSymbols, pianoKeyAt, pianoOctaves } from "../render/widgets";
import { elementBBoxes } from "../layout/layout";
import { bboxOfText } from "../layout/geometry";
import { leafDrawables, type TextDrawable } from "../layout/model";
import { makeBrowserMeasure } from "../render/svg-backend";
import { scenes } from "../scenes/registry";
import { getLoadedEngines } from "../scenes/engines";
import type { ElementsEngine, ElementNameLang } from "../scenes/elements/types";
import type { SpaceEngine } from "../scenes/space/types";
import type { SkyEngine, SkyLang } from "../scenes/space/sky-types";
import { cardTargets, meaningfulName, searchUrl, type CardTarget } from "./card-model";
import { contextWords, matchWiki, selectedPhrase, type WikiCandidate } from "./wiki-match";
import { linkActionsFor } from "./link-model";
import { openMediaModal } from "./media-modal";
import { sourceEntry } from "./source-view";
import { h, logicalPoint } from "./dom";
import { overCaption } from "./caption";
import { gateIsOpen } from "./gates";
import { hitElement } from "./hit";
import { firstSentence, renderDetails } from "./details-render";
import type { BBox } from "../layout/geometry";
import type { WidgetHost } from "./widget-host";

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

/**
 * Names the SCENE knows for its own parts, for the ids no word on the canvas
 * can speak for (interactivity spec §6). Read off the manifest's declared
 * interactions — the one source the tray and the context menu also read, never
 * sniffed from the template id.
 *
 * The periodic table is the case this exists for: its cells print "Fe" and
 * "26", both of which `meaningfulName` rightly screens out, so without this
 * the richest set of clickable parts in the library would carry no cards at
 * all. With it, all 118 do, named in the figure's own language.
 *
 * `space` and `sky` are the same idea for free play: a planet or a star is
 * drawn as a bare coloured dot, with no printed word `meaningfulName` could
 * ever find, so a paused click needs the engine to say what it is.
 *
 * Exported for `tests/connect-freeplay.test.ts`, which drives it against
 * real `sky_map`/`solar_system` layouts rather than a hand-built fixture —
 * this is the one function that actually knows a "cell_Fe" or a "polaris"
 * from a "frame", so a test that never calls it cannot catch a branch that
 * quietly returns nothing.
 */
export function sceneNamesFor(hd: RenderHandle): { id: string; name: string }[] {
  const interactions = (hd.spec.template && scenes[hd.spec.template]?.manifest.interactions) || [];
  const raw = hd.spec.params?.["names"];
  if (interactions.includes("periodic")) {
    let eng: ElementsEngine;
    try {
      // A periodic figure cannot be on screen unless its engine loaded before
      // layout ran — but a card is not worth throwing at a viewer over.
      eng = getLoadedEngines(["elements"]).elements as ElementsEngine;
    } catch {
      return [];
    }
    const lang: ElementNameLang = raw === "nb" || raw === "la" ? raw : "en";
    const out: { id: string; name: string }[] = [];
    for (const symbol of periodicSymbols(hd.layout.order)) {
      const el = eng.bySymbol(symbol);
      if (el) out.push({ id: "cell_" + symbol, name: eng.nameIn(el, lang) });
    }
    return out;
  }
  if (interactions.includes("space")) {
    try {
      // Same forgiveness as the periodic branch: a card is not worth
      // throwing at a viewer over — widened to the whole lookup, since a
      // body table with a hole in it should fail exactly the same way a
      // missing engine does, not crash the pause.
      const eng = getLoadedEngines(["space"]).space as SpaceEngine;
      const lang: "en" | "nb" = raw === "nb" ? "nb" : "en";
      const out: { id: string; name: string }[] = [];
      for (const id of hd.layout.order) {
        if (id.includes("__")) continue; // group leaves — usable() screens these out too
        const body = eng.body(id);
        if (body) out.push({ id, name: body.name[lang] });
      }
      return out;
    } catch {
      return [];
    }
  }
  if (interactions.includes("sky")) {
    try {
      const loaded = getLoadedEngines(["sky", "space"]);
      const sky = loaded.sky as SkyEngine;
      const spc = loaded.space as SpaceEngine;
      const lang: SkyLang = raw === "nb" || raw === "la" ? raw : "en";
      const out: { id: string; name: string }[] = [];
      for (const id of hd.layout.order) {
        if (id.includes("__")) continue; // group leaves ("stars__hip_…") — usable() screens these out too
        const con = sky.findConstellation(id);
        if (con) { out.push({ id, name: sky.name(con, lang) }); continue; }
        const star = sky.findStar(id);
        if (star) { out.push({ id, name: sky.starName(star, lang) ?? `HIP ${star.hip}` }); continue; }
        const body = spc.body(id);
        if (body) out.push({ id, name: body.name[lang === "nb" ? "nb" : "en"] });
      }
      return out;
    } catch {
      return [];
    }
  }
  return [];
}

export function attachInfoCards(stage: HTMLElement, hd: RenderHandle, widgetHost: WidgetHost | null = null): void {
  // The words a template DREW count too, not just the spec's own elements —
  // otherwise an axis caption, a node's text and a legend entry are all dead.
  // Each word's owning part comes from the drawable tree (the same walk the
  // lint does), because a group's children need not share its id prefix.
  const ownerOf = new Map<string, string>();
  for (const top of hd.layout.drawables) for (const leaf of leafDrawables([top])) ownerOf.set(leaf.id, top.id);
  const drawnTexts = leafDrawables(hd.layout.drawables)
    .filter((d): d is TextDrawable => d.kind === "text")
    .map((d) => ({ id: d.id, text: d.text, owner: ownerOf.get(d.id) }));
  const targets = cardTargets(hd.spec, { order: hd.layout.order, texts: drawnTexts, sceneNames: sceneNamesFor(hd) });
  // A figure of pure geometry carries no card — but it still NARRATES, and a
  // viewer can still select a phrase in that narration, so the caption half is
  // wired regardless. With neither, the scene pays nothing.
  if (targets.size === 0 && !stage.querySelector(".cs-caption")) return;

  const interactions = (hd.spec.template && scenes[hd.spec.template]?.manifest.interactions) || [];
  const editableCode = (hd.spec.elements ?? [])
    .filter((e) => e.type === "code" && e.show !== "none" && typeof e.code === "string" && typeof e.language === "string")
    .map((e) => e.id);
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
   *  visibility (a portrait the storyboard hasn't drawn yet has no card),
   *  standing aside on the instruments' own hit areas, and yielding the whole
   *  stage to an open gate — including the continue gate between playlist
   *  items, where the timeline reads "done" rather than "playing". */
  const targetAt = (e: MouseEvent): CardTarget | null => {
    if (gateIsOpen(stage)) return null;
    // The subtitle band covers the bottom of the canvas — for an axes diagram,
    // exactly where the x-axis label sits. A click on a subtitle is a click on
    // the subtitle, not on what it happens to be hiding.
    if (overCaption(e.target as Element | null)) return null;
    const p = logicalPoint(stage, e);
    if (!p) return null;
    if (interactions.includes("chess") && chessSquareAt(flip, p) !== null) return null;
    if (interactions.includes("piano") && pianoKeyAt(octaves, p) !== null) return null;
    if (widgetHost?.over(p)) return null;
    // A code screen's natural action is EDITING it (the tray's own paused
    // click), so a card never opens on one — the same standing-aside the
    // instruments get above.
    if (editableCode.length > 0) {
      const box = hitElement(new Map([...hitBoxes()].filter(([id]) => editableCode.includes(id))), p, 12);
      if (box !== null) return null;
    }
    // Hit-test only what is on screen at this boundary: an invisible
    // element's smaller box must never shadow a visible card element (the
    // cameo-over-undrawn-table bug), and a card never opens for something
    // the viewer cannot see. A drawn word inherits the visibility of the part
    // that owns it — it appears and is erased with that part, never alone.
    const n = hd.timeline.position;
    const visibleIds = new Set(sceneAt(hd.plan, n).visible);
    const visBoxes = new Map<string, BBox>();
    for (const [id, b] of hitBoxes()) {
      if (visibleIds.has(targets.get(id)?.owner ?? id)) visBoxes.set(id, b);
    }
    const id = hitElement(visBoxes, p, 12);
    return (id !== null && targets.get(id)) || null;
  };

  // ---- formal details: near the stroke, a hover preview -------------------
  // The two NEW ways in (a click while playing, a hover) must not fire from
  // anywhere inside a curve's bounding box — for an open stroke (a curve, a
  // line, an arrow) the pointer has to be near the ink itself.
  const strokesOf = new Map<string, [number, number][][]>();
  for (const top of hd.layout.drawables) {
    const t = targets.get(top.id);
    if (!t?.details) continue;
    const lines = leafDrawables([top])
      .filter((d) => d.kind === "stroke" && !d.closed && !d.shapeHint && d.pts.length >= 2)
      .map((d) => (d as { pts: [number, number][] }).pts);
    if (lines.length > 0) strokesOf.set(top.id, lines);
  }
  const nearInk = (id: string, p: [number, number], slop = 16): boolean => {
    const lines = strokesOf.get(id);
    if (!lines) return true; // a shape or a word: its box is its body
    for (const pts of lines) {
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        const u = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
        if (Math.hypot(p[0] - (ax + u * dx), p[1] - (ay + u * dy)) <= slop) return true;
      }
    }
    return false;
  };
  // Tested only among the elements that CARRY details: a guide line or a
  // shifted curve with no card of its own must not shadow the curve the
  // author explained (the card's smallest-box rule would let it).
  const detailsIds = [...targets.values()].filter((t) => t.details).map((t) => t.id);
  const detailsAt = (e: MouseEvent): CardTarget | null => {
    if (detailsIds.length === 0 || gateIsOpen(stage) || overCaption(e.target as Element | null)) return null;
    const p = logicalPoint(stage, e);
    if (!p) return null;
    const visible = new Set(sceneAt(hd.plan, hd.timeline.position).visible);
    const all = hitBoxes();
    const boxes = new Map<string, BBox>();
    for (const id of detailsIds) {
      const b = all.get(id);
      if (b && visible.has(targets.get(id)?.owner ?? id) && nearInk(id, p)) boxes.set(id, b);
    }
    const id = hitElement(boxes, p, 16);
    return (id !== null && targets.get(id)) || null;
  };

  let tip: HTMLElement | null = null;
  let tipFor: string | null = null;
  let tipTimer = 0;
  let leaveTimer = 0;
  function hideTip(): void {
    window.clearTimeout(tipTimer);
    window.clearTimeout(leaveTimer);
    leaveTimer = 0;
    tip?.remove();
    tip = null;
    tipFor = null;
  }
  const showTip = (t: CardTarget, clientX: number, clientY: number): void => {
    hideTip();
    tipFor = t.id;
    const more = h("button", { class: "cs-details-more" }, "More ▸");
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      if (hd.timeline.state === "playing") hd.timeline.pause();
      openCard(t, clientX, clientY);
    });
    const body = h("div", { class: "cs-details-tip-text" });
    renderDetails(body, firstSentence(t.details ?? ""));
    tip = h("div", { class: "cs-details-tip" }, body, more);
    tip.addEventListener("click", (e) => e.stopPropagation());
    tip.addEventListener("pointerenter", () => {
      window.clearTimeout(leaveTimer);
      leaveTimer = 0;
    });
    tip.addEventListener("pointerleave", () => {
      leaveTimer = window.setTimeout(hideTip, 300);
    });
    const sr = stage.getBoundingClientRect();
    tip.style.left = `${Math.max(4, Math.min(clientX - sr.left + 12, sr.width - 290))}px`;
    tip.style.top = `${Math.max(4, clientY - sr.top + 14)}px`;
    stage.appendChild(tip);
  };
  // Hover is a mouse thing: on touch, long-press already opens the card.
  stage.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || card) return;
    if (tip && e.target instanceof Node && tip.contains(e.target)) return; // reaching for More
    const t = detailsAt(e);
    if (t?.id === tipFor) {
      window.clearTimeout(leaveTimer);
      return;
    }
    if (!t) {
      // Off the ink: a moment's grace, so the pointer can travel to More ▸.
      if (tip && leaveTimer === 0) leaveTimer = window.setTimeout(hideTip, 450);
      else if (!tip) hideTip();
      return;
    }
    hideTip();
    tipFor = t.id;
    const { clientX, clientY } = e;
    tipTimer = window.setTimeout(() => showTip(t, clientX, clientY), 350);
  });
  stage.addEventListener("pointerleave", hideTip);

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
    // The author's formal details come first: they are why this element is
    // offered at all, and the card widens to hold a formula.
    const details = t.details ? h("div", { class: "cs-infocard-details" }) : null;
    if (details && t.details) renderDetails(details, t.details);
    // The studies behind the element, next: title (linked when the author
    // knew a link), who and when, and what it found.
    const cites = (t.cites ?? []).map((src) => sourceEntry(src, link));
    card = h("div", { class: `cs-infocard${details ? " cs-infocard-wide" : ""}` }, closeBtn, title, ...(details ? [details] : []), ...cites, summary, actions);
    card.addEventListener("click", (e) => e.stopPropagation());
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    // The figure's activities come first (design 2026-09-24-music §6.4): a
    // periodic cell's card offers the table's drills, as the tray does.
    for (const b of activityButtons(stage, hd, activitiesFor(interactions, 0), closeCard)) actions.appendChild(b);

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
    } else if (!t.details && meaningfulName(t.name)) {
      // (An element the author gave details already says what it is: a
      // guessed encyclopedia sense under them would only compete.)
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
    const cardW = details ? 350 : 250;
    card.style.left = `${Math.max(4, Math.min(clientX - sr.left + 10, sr.width - cardW))}px`;
    card.style.top = `${Math.min(clientY - sr.top + 10, sr.height - 90)}px`;
    stage.appendChild(card);
    // A tall card (details with a formula) must not run off the stage.
    const over = card.offsetTop + card.offsetHeight - (sr.height - 4);
    if (over > 0) card.style.top = `${Math.max(4, card.offsetTop - over)}px`;
    hideTip();
    window.addEventListener("keydown", onKey);
  };

  // ---- selecting a phrase in the caption -----------------------------------
  // The narration says things the canvas never draws — "the dismal science",
  // "regression to the mean" — and no phrase detector finds those reliably:
  // English does not capitalize its concepts, and a run of capitals glues
  // "Norway Sweden Denmark Finland" into one word. So the VIEWER draws the
  // boundary, which is both exact and a gesture they already know.
  //
  // This used to be free of the play/pause conflict by construction — the
  // caption was a SIBLING of the stage, and togglePlay is bound to the stage
  // alone. As a band ON the drawing it is inside the stage, so the drag's
  // trailing click reaches togglePlay and the rule is stated instead: see
  // isTextDrag in ui/caption.ts, checked in the stage's click handler.
  const caption = stage.querySelector<HTMLElement>(".cs-caption");
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
      if (hd.timeline.state === "playing") {
        // An element the author gave details is an explicit offer: one click
        // from the movie pauses and opens them. Any other click stays the pause.
        const d = detailsAt(e);
        if (!d) return;
        e.stopPropagation();
        hd.timeline.pause();
        openCard(d, e.clientX, e.clientY);
        return;
      }
      if (e.target instanceof Element && e.target.closest("button, a")) return;
      const t = detailsAt(e) ?? targetAt(e);
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
        if (detailsAt(e) === null && targetAt(e) === null) return;
        hd.timeline.pause();
      }
      const t = detailsAt(e) ?? targetAt(e);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      openCard(t, e.clientX, e.clientY);
    },
    true,
  );

  // Quiet affordance while paused: the cursor knows what carries a card —
  // OR a widget part, so a pad and a card element share the one class
  // (the sole toggle for it; widget-host.ts does not touch it, or the two
  // add-ons would fight over the same class within a single pointermove).
  const overWidget = (e: MouseEvent): boolean => {
    const p = logicalPoint(stage, e);
    return widgetHost !== null && p !== null && widgetHost.over(p);
  };
  stage.addEventListener("pointermove", (e) => {
    // The short-circuit ORDER is the point: asking the widget host builds its
    // scene, and this handler runs on every pointer move. While the movie
    // plays nothing is clickable, so the question is never asked — except
    // under the widget's OWN gate, where working the figure IS the question.
    // targetAt still returns null under any open gate (kept, below), so
    // under that gate only overWidget can turn the hand on, which is right.
    const own = stage.querySelector(".cs-widgetgate") !== null;
    const on = (hd.timeline.state !== "playing" || own) && (targetAt(e) !== null || overWidget(e));
    // …and while playing, an element with details: a click on it opens them.
    stage.classList.toggle("cs-cardable", on || (hd.timeline.state === "playing" && detailsAt(e) !== null));
  });
}
