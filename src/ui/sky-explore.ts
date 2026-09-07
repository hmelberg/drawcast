// The Sky section of the explore tray: click a star or a constellation on the
// chart to read about it, pills for the hour, the date and where you stand.
// Every action is a PREVIEW through the tray's overrides → repaint, so
// Continue restores the lesson. The rules and the wording live in sky-model.
//
// The click overlay does NOT use hitElement: the star field is one element and
// a click inside it would only ever answer "the stars". This section has the
// engine and the same `chart` the template drew at, so it projects the
// positions itself — see targetAt and visibleField in sky-model.ts, which
// hold the rules for what is actually on the page (a line only when it is
// drawn, a faint star only when a drawn line reaches it or the author named
// it, `focus`'s own magnifying-glass transform). This file only resolves the
// author's strings (`focus`, `mark`, `highlight`) against the engine's name
// index — visibleField cannot do that lookup itself without importing the
// engine, which sky-model.ts may never do.

import type { RenderHandle } from "../render";
import { getLoadedEngines } from "../scenes/engines";
import type { Constellation, SkyEngine, SkyLang } from "../scenes/space/sky-types";
import { h, logicalPoint } from "./dom";
import { loadWikiSummary } from "./space-explore";
import type { SpaceSection } from "./space-explore";
import { wikiSummaryUrl, type Choice } from "./space-model";
import {
  DAY_CHOICES, HOUR_CHOICES, conWikiTitle, constellationFacts, starFacts, starWikiTitle, targetAt, visibleField,
  type ConstellationMode, type SkyTarget,
} from "./sky-model";

const HINT: Record<"en" | "nb", string> = {
  en: "Click a star or a constellation to read about it; the pills move the hour, the date and where you are standing.",
  nb: "Klikk på en stjerne eller et stjernebilde for å lese om det; knappene flytter timen, datoen og stedet du står.",
};
const ROW: Record<"hour" | "date" | "place", Record<"en" | "nb", string>> = {
  hour: { en: "Hour", nb: "Time" },
  date: { en: "Date", nb: "Dato" },
  place: { en: "Place", nb: "Sted" },
};
const CREDIT = "Wikipedia, CC BY-SA";
const CON_MODES = ["both", "lines", "names", "none"] as const;

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function mountSkySection(opts: { hd: RenderHandle; stage: HTMLElement | null; overrides: Record<string, unknown>; repaint(): void }): SpaceSection {
  const { hd, stage, overrides, repaint } = opts;
  const eng = getLoadedEngines(["sky"]).sky as SkyEngine;
  const authored = (hd.spec.params ?? {}) as Record<string, unknown>;
  const current = (): Record<string, unknown> => ({ ...authored, ...overrides });
  const lang = (): SkyLang => {
    const n = current().names;
    return n === "nb" || n === "la" ? n : "en";
  };
  const uiLang = (): "en" | "nb" => (lang() === "nb" ? "nb" : "en");
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const where = (): { lat: number; lon: number } => ({ lat: num(current().lat, 59.91), lon: num(current().lon, 10.75) });
  const moment = (): Date => {
    const w = where();
    return eng.resolveTime(current().time, current().hours, current().days, w.lon);
  };

  const el = h("div", { class: "cs-tray-body" });
  const hint = h("div", { class: "cs-tray-hint" });
  const pills = h("div", { class: "cs-body-pills" });
  const card = h("div", { class: "cs-space-card" });
  el.append(hint, pills, card);

  let target: SkyTarget | null = null;

  const pillRow = <T,>(title: string, choices: Choice<T>[], selected: (v: T) => boolean, pick: (v: T) => void): HTMLElement => {
    const row = h("div", { class: "cs-tray-row cs-body-pillrow" });
    row.appendChild(h("span", { class: "cs-tray-label" }, title));
    for (const c of choices) {
      const b = h("button", { class: `cs-cardgate-pill cs-tray-pill${selected(c.value) ? " selected" : ""}` }, c.label[uiLang()]);
      b.addEventListener("click", () => { pick(c.value); repaint(); render(); });
      row.appendChild(b);
    }
    return row;
  };

  /** Which target the card shows, so a summary that arrives late for another one is dropped. */
  let cardFor = "";
  const renderCard = (): void => {
    const L = lang(), U = uiLang();
    card.replaceChildren();
    if (!target) {
      card.appendChild(h("div", { class: "cs-space-note" }, U === "nb" ? "Ingenting valgt ennå." : "Nothing picked yet."));
      cardFor = "";
      return;
    }
    const w = where();
    let name: string, facts: { label: string; value: string }[], title: string;
    if (target.kind === "star") {
      const s = eng.star(target.hip);
      if (!s) { target = null; renderCard(); return; }
      const at = eng.starPositions(moment(), w.lat, w.lon).get(s.hip) ?? null;
      name = eng.starName(s, L) ?? `HIP ${s.hip}`;
      facts = starFacts(s, at, L);
      title = starWikiTitle(s, L);
    } else {
      const c = eng.findConstellation(target.abbr);
      if (!c) { target = null; renderCard(); return; }
      const hips = eng.edgeStars(c);
      let brightest: ReturnType<SkyEngine["star"]> = undefined;
      for (const hip of hips) {
        const st = eng.star(hip);
        if (st && (!brightest || st.mag < brightest.mag)) brightest = st;
      }
      name = eng.name(c, L);
      facts = constellationFacts(c, brightest ?? null, hips.length, L);
      title = conWikiTitle(c, L);
    }
    const key = `${target.kind}:${target.kind === "star" ? target.hip : target.abbr}`;
    cardFor = key;
    card.appendChild(h("div", { class: "cs-space-name" }, name));
    const dl = h("dl", { class: "cs-space-facts" });
    for (const f of facts) { dl.appendChild(h("dt", {}, f.label)); dl.appendChild(h("dd", {}, f.value)); }
    card.appendChild(dl);
    const wiki = h("div", { class: "cs-space-wiki" });
    card.appendChild(wiki);
    // The table's own facts are already on screen above; the summary is an
    // enrichment, never a dependency — a slow or failed fetch leaves a
    // complete card, just without this panel.
    const wl = L === "nb" ? "nb" : "en";
    void loadWikiSummary(wl, title).then((s) => {
      if (!s || cardFor !== key || lang() !== L) return;
      if (s.thumb) wiki.appendChild(h("img", { src: s.thumb, alt: "", class: "cs-space-thumb" }));
      wiki.appendChild(h("p", { class: "cs-space-extract" }, s.extract));
      const credit = h("div", { class: "cs-space-credit" });
      credit.append(CREDIT, " · ");
      credit.appendChild(h("a", { href: s.page ?? wikiSummaryUrl(wl, title), target: "_blank", rel: "noopener" }, s.title || title));
      wiki.appendChild(credit);
    });
  };

  const render = (): void => {
    const U = uiLang();
    hint.textContent = HINT[U];
    pills.replaceChildren();
    const hours = num(current().hours, 0), days = num(current().days, 0);
    pills.appendChild(pillRow(ROW.hour[U], HOUR_CHOICES, (v) => v === hours, (v) => { overrides.hours = v; }));
    pills.appendChild(pillRow(ROW.date[U], DAY_CHOICES, (v) => v === days, (v) => { overrides.days = v; }));
    const w = where();
    pills.appendChild(
      pillRow(
        ROW.place[U],
        eng.places().map((p) => ({ value: p.id, label: p.name })),
        (id) => { const p = eng.places().find((q) => q.id === id)!; return Math.abs(p.lat - w.lat) < 0.01 && Math.abs(p.lon - w.lon) < 0.01; },
        (id) => {
          const p = eng.places().find((q) => q.id === id)!;
          overrides.lat = p.lat;
          overrides.lon = p.lon;
          overrides.place = eng.placeName(p, lang());
        },
      ),
    );
    renderCard();
  };

  // The click overlay: a layer over the stage, exempt from the tray's freeze
  // (tray.ts's freezeClick keeps .cs-spaceexplore's own clicks), resolving a
  // point against the SAME projection the template drew with — including,
  // under `focus`, the same magnifying-glass transform.
  let overlay: HTMLElement | null = null;
  if (stage) {
    overlay = h("div", { class: "cs-spaceexplore" });
    overlay.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = logicalPoint(stage, e);
      if (!p) return;
      const w = where();
      const pos = eng.starPositions(moment(), w.lat, w.lon);
      const conModeRaw = current().constellations;
      const mode: ConstellationMode = (CON_MODES as readonly string[]).includes(conModeRaw as string) ? (conModeRaw as ConstellationMode) : "both";
      const bothUp = (a: number, b: number): boolean => {
        const pa = pos.get(a), pb = pos.get(b);
        return !!pa && !!pb && pa.alt >= 0 && pb.alt >= 0;
      };

      // `focus`, resolved exactly as the template resolves it: a named
      // constellation with at least one fully-visible edge — else the whole
      // sky draws (and is hit-tested) instead, the fallback space.yaml itself
      // takes when the focused figure has fully set.
      const fq = current().focus;
      let focus: Constellation | undefined;
      if (typeof fq === "string" && fq.trim() !== "") {
        const c = eng.findConstellation(fq);
        if (c && c.edges.some(([a, b]) => bothUp(a, b))) focus = c;
      }
      // A star named in `mark` or `highlight` is drawn (and so clickable)
      // whatever `limit_mag` says — the constellation index wins an
      // ambiguous key ("Men" is both Mensa and a catalogue star), same as
      // the template's own `take`.
      const markStars = new Set<number>();
      for (const q of [...listOf(current().mark), ...listOf(current().highlight)]) {
        if (eng.findConstellation(q)) continue;
        const s = eng.findStar(q);
        if (s) markStars.add(s.hip);
      }

      const field = visibleField({
        stars: eng.stars(),
        constellations: eng.constellations(),
        pos,
        chart: eng.chart,
        limitMag: num(current().limit_mag, 4.5),
        mode,
        markStars,
        focus,
      });
      const t = targetAt(p, field.stars, field.segs);
      if (!t) return;
      target = t;
      render();
    });
    stage.appendChild(overlay);
  }

  render();
  return {
    el,
    destroy() {
      cardFor = "";
      target = null;
      overlay?.remove();
      overlay = null;
    },
  };
}
