// The Sky section of the explore tray: click a star, a body or a
// constellation on the chart to read about it, pills for the hour, the date
// and where you stand. Every action is a PREVIEW through the tray's
// overrides → repaint, so Continue restores the lesson. The rules and the
// wording live in sky-model.
//
// The click overlay does NOT use hitElement, even though a shown body IS its
// own separate drawable (`kit.ball(b.id, …)` in space.yaml) and so is
// something hitElement could already resolve on its own — unlike the star
// field, which is the one-element case that argument is really about (`draw`
// has no wildcard, and a click inside it would only ever answer "the
// stars"). This section builds ONE field (stars, bodies, constellation
// lines) and hit-tests all of it the same way, so a star, a body and a line
// all answer to the same click overlay — see targetAt and visibleField in
// sky-model.ts, which hold the rules for what is actually on the page (a
// line only when it is drawn, a faint star only when a drawn line reaches it
// or the author named it, `focus`'s own magnifying-glass transform, and every
// SHOWN body regardless — bodies carry no magnitude cutoff to exempt). This
// file only resolves the author's strings (`show`, `focus`, `mark`,
// `highlight`) against the engines' own name indexes — visibleField cannot do
// that lookup itself without importing an engine, which sky-model.ts may
// never do.

import type { RenderHandle } from "../render";
import { getLoadedEngines } from "../scenes/engines";
import { SKY_DEFAULTS, limitMag } from "../scenes/space/sky-rules";
import type { Constellation, SkyEngine, SkyLang } from "../scenes/space/sky-types";
import type { SpaceEngine } from "../scenes/space/types";
import { h, logicalPoint } from "./dom";
import { loadWikiSummary } from "./space-explore";
import type { SpaceSection } from "./space-explore";
import { bodyLabel, cardFacts, phaseLine, wikiSummaryUrl, type Choice } from "./space-model";
import {
  DAY_CHOICES, HOUR_CHOICES, bodyLang, conWikiTitle, constellationFacts, starFacts, starWikiTitle, targetAt, visibleField,
  type ConstellationMode, type SkyTarget,
} from "./sky-model";

const HINT: Record<"en" | "nb", string> = {
  en: "Click a star, a planet or a constellation to read about it; the pills move the hour, the date and where you are standing.",
  nb: "Klikk på en stjerne, en planet eller et stjernebilde for å lese om det; knappene flytter timen, datoen og stedet du står.",
};
const ROW: Record<"hour" | "date" | "place", Record<"en" | "nb", string>> = {
  hour: { en: "Hour", nb: "Time" },
  date: { en: "Date", nb: "Dato" },
  place: { en: "Place", nb: "Sted" },
};
const CREDIT = "Wikipedia, CC BY-SA";
const CON_MODES = ["both", "lines", "names", "none"] as const;
// The nine ids the sky's ephemeris knows, what `show` defaults to, where the
// chart stands and how faint it goes: SKY_DEFAULTS, the same object the
// template reads as `engines.sky.defaults`. Not a copy of the template's
// numbers — the numbers themselves, so the click overlay's candidate set
// cannot drift from what is on screen.
const { ids: SKY_IDS, show: DEFAULT_SHOW } = SKY_DEFAULTS;

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function mountSkySection(opts: { hd: RenderHandle; stage: HTMLElement | null; overrides: Record<string, unknown>; repaint(): void }): SpaceSection {
  const { hd, stage, overrides, repaint } = opts;
  const loaded = getLoadedEngines(["sky", "space"]);
  const eng = loaded.sky as SkyEngine;
  const spc = loaded.space as SpaceEngine;
  const authored = (hd.spec.params ?? {}) as Record<string, unknown>;
  const current = (): Record<string, unknown> => ({ ...authored, ...overrides });
  const lang = (): SkyLang => {
    const n = current().names;
    return n === "nb" || n === "la" ? n : "en";
  };
  const uiLang = (): "en" | "nb" => (lang() === "nb" ? "nb" : "en");
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const where = (): { lat: number; lon: number } => ({ lat: num(current().lat, SKY_DEFAULTS.lat), lon: num(current().lon, SKY_DEFAULTS.lon) });
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
    let name: string, facts: { label: string; value: string }[], title: string, note: string | null = null;
    if (target.kind === "star") {
      const s = eng.star(target.hip);
      // Defensive, not reachable in practice: `target.hip` always came out of
      // this same engine's own `eng.stars()`/`visibleField`, which never mint
      // a hip the catalogue does not have. Kept in case that ever changes.
      if (!s) { target = null; renderCard(); return; }
      const at = eng.starPositions(moment(), w.lat, w.lon).get(s.hip) ?? null;
      name = eng.starName(s, L) ?? `HIP ${s.hip}`;
      facts = starFacts(s, at, L);
      title = starWikiTitle(s, L);
    } else if (target.kind === "body") {
      const b = spc.body(target.id);
      // Defensive, not reachable in practice: `target.id` always came out of
      // `engines.space.bodies()`'s own resolution, which only returns real
      // ids. Kept in case that ever changes.
      if (!b) { target = null; renderCard(); return; }
      const bl = bodyLang(L);
      name = bodyLabel(spc.all(), b.id, bl);
      facts = cardFacts(b, spc.all(), bl);
      title = b.wiki[bl];
      // Round 1's own Moon card: the phase as a sentence, not a fact row —
      // and the body a viewer is most likely to click, since it is the one
      // drawn with a phase in the first place.
      if (b.id === "moon") note = phaseLine(spc.phase(moment()), bl);
    } else {
      const c = eng.findConstellation(target.abbr);
      // Defensive, not reachable in practice: `target.abbr` always came out
      // of this same engine's own `eng.constellations()`/`visibleField`.
      // Kept in case that ever changes.
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
    const key = `${target.kind}:${target.kind === "star" ? target.hip : target.kind === "body" ? target.id : target.abbr}`;
    cardFor = key;
    card.appendChild(h("div", { class: "cs-space-name" }, name));
    const dl = h("dl", { class: "cs-space-facts" });
    for (const f of facts) { dl.appendChild(h("dt", {}, f.label)); dl.appendChild(h("dd", {}, f.value)); }
    card.appendChild(dl);
    if (note) card.appendChild(h("div", { class: "cs-space-note" }, note));
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
      const at = moment();
      const pos = eng.starPositions(at, w.lat, w.lon);
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
      // `show`'s own group words ("planets"/"inner"/"outer"/"all") are
      // engines.space's to expand, the same call space.yaml's `skyBodies`
      // makes — narrowed to the nine ids the sky's ephemeris actually knows.
      const skyBodies = (q: string): string[] => spc.bodies([q]).bodies.filter((b) => SKY_IDS.includes(b.id)).map((b) => b.id);
      // `take`'s own precedence — constellation, then star, then body — so an
      // ambiguous key ("Men" is both Mensa and a catalogue star) resolves the
      // same way here as it does in mark/highlight/limit_mag exemption below.
      const markStars = new Set<number>();
      const markBodyIds = new Set<string>();
      for (const q of [...listOf(current().mark), ...listOf(current().highlight)]) {
        if (eng.findConstellation(q)) continue;
        const s = eng.findStar(q);
        if (s) { markStars.add(s.hip); continue; }
        for (const id of skyBodies(q)) markBodyIds.add(id);
      }
      // `show`, resolved the same way: the default seven bodies, or the
      // author's own list (group words included) — a marked/highlighted body
      // is drawn (and so clickable) even when `show` never names it, same as
      // the template's own addBody loop.
      const asked = listOf(current().show);
      const showIds: string[] = [];
      const addBody = (id: string): void => { if (!showIds.includes(id)) showIds.push(id); };
      if (asked.length === 0) for (const id of DEFAULT_SHOW) addBody(id);
      else for (const q of asked) for (const id of skyBodies(q)) addBody(id);
      for (const id of markBodyIds) addBody(id);

      const field = visibleField({
        stars: eng.stars(),
        constellations: eng.constellations(),
        pos,
        chart: eng.chart,
        // Through the engine's own clamp, not a bare default: the template
        // clamps to 2…4.5, so an override or a hand-edited spec of 9 would
        // otherwise put stars in the click field that the page never drew.
        limitMag: limitMag(current().limit_mag),
        mode,
        markStars,
        focus,
        bodies: eng.bodyPositions(showIds, at, w.lat, w.lon),
      });
      const t = targetAt(p, field.stars, field.segs, undefined, field.bodies);
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
