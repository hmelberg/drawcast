// The Space section of the explore tray: click a body on the figure to focus
// on it (its moons appear), breadcrumbs back out to the whole system, pills
// for scale, names and date, and a fact card — the table's numbers at once,
// Wikipedia's summary when it arrives, the table alone when it does not.
// Every action is a PREVIEW through the tray's overrides → repaint, so
// Continue restores the lesson. The rules and the wording live in space-model.

import type { RenderHandle } from "../render";
import { elementBBoxes, elementRings } from "../layout/layout";
import { makeBrowserMeasure } from "../render/svg-backend";
import { getLoadedEngines } from "../scenes/engines";
import type { SpaceEngine } from "../scenes/space/types";
import { h, logicalPoint } from "./dom";
import { hitElement } from "./hit";
import {
  DATE_CHOICES, NAME_CHOICES, ROOT_LABEL, SCALE_CHOICES, bodyLabel, breadcrumbFor, cardFacts, focusTargetFor, isoDate, phaseLine, positionNote,
  readWikiSummary, wikiSummaryUrl, type Choice, type SpaceLang, type WikiSummary,
} from "./space-model";

export interface SpaceSection {
  el: HTMLElement;
  destroy(): void;
}

const HINT: Record<SpaceLang, string> = {
  en: "Click a planet or moon to look closer; use the crumbs to come back out.",
  nb: "Klikk på en planet eller måne for å se nærmere; bruk stien for å gå ut igjen.",
};
const ROW: Record<"scale" | "names" | "date", Record<SpaceLang, string>> = {
  scale: { en: "Scale", nb: "Målestokk" },
  names: { en: "Names", nb: "Navn" },
  date: { en: "Date", nb: "Dato" },
};
const CREDIT = "Wikipedia, CC BY-SA";

/** One fetch per article per session; a failure caches as null so the card never retries in a loop. */
const wikiCache = new Map<string, Promise<WikiSummary | null>>();
export function loadWikiSummary(lang: SpaceLang, title: string, fetchFn: typeof fetch = fetch): Promise<WikiSummary | null> {
  const key = `${lang}:${title}`;
  let p = wikiCache.get(key);
  if (!p) {
    p = fetchFn(wikiSummaryUrl(lang, title), { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => readWikiSummary(j))
      .catch(() => null);
    wikiCache.set(key, p);
  }
  return p;
}

export function mountSpaceSection(opts: { hd: RenderHandle; stage: HTMLElement | null; overrides: Record<string, unknown>; repaint(): void }): SpaceSection {
  const { hd, stage, overrides, repaint } = opts;
  const eng = getLoadedEngines(["space"]).space as SpaceEngine;
  const bodies = eng.all();
  const authored = (hd.spec.params ?? {}) as Record<string, unknown>;
  /** The figure's params as previewed right now: authored, then the viewer's. */
  const current = (): Record<string, unknown> => ({ ...authored, ...overrides });
  const lang = (): SpaceLang => (current().names === "nb" ? "nb" : "en");
  const focusNow = (): string | null => {
    const f = current().focus;
    return typeof f === "string" && bodies[f] ? f : null;
  };
  const dateNow = (): Date => eng.resolveDate(current().date, current().days);

  const el = h("div", { class: "cs-tray-body cs-tray-space" });
  const hint = h("div", { class: "cs-tray-hint" });
  const crumbs = h("div", { class: "cs-body-crumbs" });
  const pills = h("div", { class: "cs-body-pills" });
  const card = h("div", { class: "cs-space-card" });
  el.append(hint, crumbs, pills, card);

  const setFocus = (focus: string | null): void => {
    if (focus) overrides.focus = focus;
    else delete overrides.focus;
    repaint();
    render();
  };

  const pillRow = <T,>(title: string, choices: Choice<T>[], selected: (v: T) => boolean, pick: (v: T) => void): HTMLElement => {
    const row = h("div", { class: "cs-tray-row cs-body-pillrow" });
    row.appendChild(h("span", { class: "cs-tray-label" }, title));
    for (const c of choices) {
      const b = h("button", { class: `cs-cardgate-pill cs-tray-pill${selected(c.value) ? " selected" : ""}` }, c.label[lang()]);
      b.addEventListener("click", () => {
        pick(c.value);
        repaint();
        render();
      });
      row.appendChild(b);
    }
    return row;
  };

  /** Which body the card shows, so a summary that arrives late for another body is dropped. */
  let cardFor: string | null = null;
  const renderCard = (id: string): void => {
    const L = lang();
    const b = bodies[id];
    cardFor = id;
    card.replaceChildren();
    card.appendChild(h("div", { class: "cs-space-name" }, bodyLabel(bodies, id, L)));
    const facts = h("dl", { class: "cs-space-facts" });
    for (const f of cardFacts(b, bodies, L)) {
      facts.appendChild(h("dt", {}, f.label));
      facts.appendChild(h("dd", {}, f.value));
    }
    card.appendChild(facts);
    if (id === "moon") card.appendChild(h("div", { class: "cs-space-note" }, phaseLine(eng.phase(dateNow()), L)));
    const note = positionNote(eng.schematic(id), L);
    if (note) card.appendChild(h("div", { class: "cs-space-note" }, note));
    const wiki = h("div", { class: "cs-space-wiki" });
    card.appendChild(wiki);
    void loadWikiSummary(L, b.wiki[L]).then((w) => {
      if (!w || cardFor !== id || lang() !== L) return;
      if (w.thumb) wiki.appendChild(h("img", { src: w.thumb, alt: "", class: "cs-space-thumb" }));
      wiki.appendChild(h("p", { class: "cs-space-extract" }, w.extract));
      const credit = h("div", { class: "cs-space-credit" });
      credit.append(CREDIT, " · ");
      credit.appendChild(h("a", { href: w.page ?? wikiSummaryUrl(L, b.wiki[L]), target: "_blank", rel: "noopener" }, w.title || b.wiki[L]));
      wiki.appendChild(credit);
    });
  };

  const render = (): void => {
    const L = lang();
    const focus = focusNow();
    hint.textContent = HINT[L];
    crumbs.replaceChildren();
    const chain = breadcrumbFor(bodies, focus);
    const crumb = (label: string, target: string | null, last: boolean): void => {
      const b = h("button", { class: `cs-body-crumb${last ? " current" : ""}` }, label);
      b.addEventListener("click", () => setFocus(target));
      crumbs.appendChild(b);
      if (!last) crumbs.appendChild(h("span", { class: "cs-body-sep" }, "›"));
    };
    crumb(ROOT_LABEL[L], null, chain.length === 0);
    chain.forEach((id, i) => crumb(bodyLabel(bodies, id, L), id, i === chain.length - 1));

    pills.replaceChildren();
    const scaleNow = typeof current().scale === "string" ? (current().scale as string) : "schematic";
    pills.appendChild(pillRow(ROW.scale[L], SCALE_CHOICES, (v) => v === scaleNow, (v) => { overrides.scale = v; }));
    const namesNow = typeof current().names === "string" ? (current().names as string) : "en";
    pills.appendChild(pillRow(ROW.names[L], NAME_CHOICES, (v) => v === namesNow, (v) => { overrides.names = v; }));
    const dateOf = (offsetDays: number): string => isoDate(new Date(Date.now() + offsetDays * 86400000));
    pills.appendChild(pillRow(ROW.date[L], DATE_CHOICES, (v) => overrides.date === dateOf(v), (v) => { overrides.date = dateOf(v); }));

    renderCard(focus ?? "sun");
  };

  // The click overlay: a layer over the stage, exempt from the tray's freeze,
  // that resolves a click to an element with the click-ask's own hit-testing —
  // against the PAINTED layout, so after a focus the ids are the focused view's.
  let overlay: HTMLElement | null = null;
  if (stage) {
    overlay = h("div", { class: "cs-spaceexplore" });
    overlay.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = logicalPoint(stage, e);
      if (!p) return;
      const layout = hd.timeline.paintedLayout() ?? hd.layout;
      const id = hitElement(elementBBoxes(layout, makeBrowserMeasure()), p, 18, elementRings(layout));
      if (id === null) return;
      const next = focusTargetFor(bodies, id, focusNow());
      if (next !== focusNow()) setFocus(next);
    });
    stage.appendChild(overlay);
  }

  render();
  return {
    el,
    destroy() {
      cardFor = null;
      overlay?.remove();
      overlay = null;
    },
  };
}
