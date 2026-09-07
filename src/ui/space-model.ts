// The Space section's rules, DOM-free: which body a click on the figure
// means, the way back out, the pills' choices, and the fact card's lines.
// tray.ts and space-explore.ts render them; tests hold them against the real
// table. Imports only the light types and rules — never ephemeris.ts, so
// astronomy-engine stays in the engine's lazy chunk.

import { AU_KM, THIN, fmtInt } from "../scenes/space/rules";
import type { Body, MoonPhaseInfo, ScaleMode } from "../scenes/space/types";

export type SpaceLang = "en" | "nb";

export const ROOT_LABEL: Record<SpaceLang, string> = { en: "Solar system", nb: "Solsystemet" };

export interface Choice<T> {
  value: T;
  label: Record<SpaceLang, string>;
}

export const SCALE_CHOICES: Choice<ScaleMode>[] = [
  { value: "schematic", label: { en: "Schematic", nb: "Skjematisk" } },
  { value: "sizes", label: { en: "Sizes", nb: "Størrelser" } },
  { value: "distances", label: { en: "Distances", nb: "Avstander" } },
  { value: "log", label: { en: "Log", nb: "Log" } },
];
export const NAME_CHOICES: Choice<"en" | "nb" | "none">[] = [
  { value: "en", label: { en: "English", nb: "Engelsk" } },
  { value: "nb", label: { en: "Norwegian", nb: "Norsk" } },
  { value: "none", label: { en: "None", nb: "Ingen" } },
];
/** Day offsets from today. */
export const DATE_CHOICES: Choice<number>[] = [
  { value: 0, label: { en: "Today", nb: "I dag" } },
  { value: -365, label: { en: "−1 year", nb: "−1 år" } },
  { value: 365, label: { en: "+1 year", nb: "+1 år" } },
];

/** The body an element id stands for — itself, its orbit or its name; null for notes, frame, axis, unknown. */
export function bodyOfElement(bodies: Record<string, Body>, elementId: string): string | null {
  const id = elementId.replace(/^(orbit_|label_)/, "");
  return bodies[id] ? id : null;
}

/**
 * Where a click lands the viewer: on the clicked body. The Sun is the way
 * out (back to the whole system); anything that is not a body keeps the
 * current focus.
 */
export function focusTargetFor(bodies: Record<string, Body>, clicked: string, currentFocus: string | null): string | null {
  const id = bodyOfElement(bodies, clicked);
  if (id === null) return currentFocus;
  if (id === "sun") return null;
  return id;
}

/** The parent chain root-first, ending at the focus. The Sun belongs to the root crumb and is omitted unless it IS the focus. */
export function breadcrumbFor(bodies: Record<string, Body>, focus: string | null): string[] {
  const out: string[] = [];
  let cur: string | null = focus;
  while (cur && bodies[cur]) {
    out.unshift(cur);
    cur = bodies[cur].parent;
  }
  return out.length > 1 && out[0] === "sun" ? out.slice(1) : out;
}

export function bodyLabel(bodies: Record<string, Body>, id: string, lang: SpaceLang): string {
  const b = bodies[id];
  return b ? (b.name[lang] ?? b.name.en) : id;
}

const dec = (s: string, lang: SpaceLang): string => (lang === "nb" ? s.replace(".", ",") : s);

export function fmtKm(km: number, lang: SpaceLang): string {
  if (km >= 1e6) {
    const m = km / 1e6;
    return `${dec(m >= 1000 ? fmtInt(m) : m.toFixed(1), lang)}${THIN}${lang === "nb" ? "mill. km" : "million km"}`;
  }
  return `${fmtInt(km)}${THIN}km`;
}

export function fmtPeriod(days: number, lang: SpaceLang): string {
  const d = Math.abs(days);
  if (d >= 800) return `${dec((d / 365.25).toFixed(1), lang)}${THIN}${lang === "nb" ? "år" : "years"}`;
  return `${dec(d < 10 ? d.toFixed(2) : d.toFixed(d < 100 ? 1 : 0), lang)}${THIN}${lang === "nb" ? "dager" : "days"}`;
}

export function fmtRotation(h: number, lang: SpaceLang): string {
  const a = Math.abs(h);
  const s = a < 48 ? `${dec(a.toFixed(1), lang)}${THIN}h` : `${dec((a / 24).toFixed(1), lang)}${THIN}${lang === "nb" ? "dager" : "days"}`;
  return h < 0 ? `${s} (${lang === "nb" ? "retrograd" : "retrograde"})` : s;
}

export function fmtMass(kg: number, lang: SpaceLang): string {
  let e = Math.floor(Math.log10(kg));
  let mantissa = kg / 10 ** e;
  // Math.log10 of an exact power of ten can land a hair under or over the
  // integer (Math.log10(1e21) === 20.999999999999996), which would otherwise
  // print "10.00 × 10^20" or "0.10 × 10^22" instead of "1.00 × 10^21".
  if (mantissa >= 10) { mantissa /= 10; e += 1; }
  else if (mantissa < 1) { mantissa *= 10; e -= 1; }
  return `${dec(mantissa.toFixed(2), lang)} × 10^${e}${THIN}kg`;
}

const KIND: Record<Body["kind"], Record<SpaceLang, string>> = {
  star: { en: "Star", nb: "Stjerne" },
  planet: { en: "Planet", nb: "Planet" },
  dwarf: { en: "Dwarf planet", nb: "Dvergplanet" },
  moon: { en: "Moon of", nb: "Måne rundt" },
};

export interface Fact {
  label: string;
  value: string;
}

/** The table's numbers as the card's lines: type, radius, distance from the parent and period (not for the Sun), rotation, tilt, mass. */
export function cardFacts(body: Body, bodies: Record<string, Body>, lang: SpaceLang): Fact[] {
  const t = (en: string, nb: string): string => (lang === "nb" ? nb : en);
  const facts: Fact[] = [];
  const kind = body.kind === "moon" && body.parent ? `${KIND.moon[lang]} ${bodyLabel(bodies, body.parent, lang)}` : KIND[body.kind][lang];
  facts.push({ label: t("Type", "Type"), value: kind });
  facts.push({ label: t("Radius", "Radius"), value: fmtKm(body.r_km, lang) });
  if (body.parent) {
    const parent = bodyLabel(bodies, body.parent, lang);
    const dist = body.parent === "sun" ? `${dec((body.a_km / AU_KM).toFixed(2), lang)}${THIN}AU (${fmtKm(body.a_km, lang)})` : fmtKm(body.a_km, lang);
    facts.push({ label: t(`Distance from ${parent}`, `Avstand fra ${parent}`), value: dist });
    facts.push({ label: t("Orbital period", "Omløpstid"), value: fmtPeriod(body.period_d, lang) + (body.period_d < 0 ? t(" (retrograde)", " (retrograd)") : "") });
  }
  facts.push({ label: t("Rotation", "Rotasjon"), value: fmtRotation(body.rot_h, lang) });
  facts.push({ label: t("Axial tilt", "Aksehelning"), value: typeof body.tilt_deg === "number" ? `${dec(body.tilt_deg.toFixed(1), lang)}°` : "—" });
  facts.push({ label: t("Mass", "Masse"), value: fmtMass(body.mass_kg, lang) });
  return facts;
}

export function positionNote(schematic: boolean, lang: SpaceLang): string | null {
  if (!schematic) return null;
  return lang === "nb" ? "Posisjonen er skjematisk — en sirkelbane, ikke en efemeride." : "Position schematic — a circular orbit, not an ephemeris.";
}

export function phaseLine(p: MoonPhaseInfo, lang: SpaceLang): string {
  const pct = Math.round(p.fraction * 100);
  return lang === "nb" ? `Fase: ${p.name_nb}, ${pct} % opplyst` : `Phase: ${p.name}, ${pct} % lit`;
}

/** Wikipedia's REST summary — CORS-open, 2 KB, CC BY-SA. Norwegian Bokmål lives at no.wikipedia.org. */
export function wikiSummaryUrl(lang: SpaceLang, title: string): string {
  return `https://${lang === "nb" ? "no" : "en"}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.trim().replace(/\s+/g, "_"))}`;
}

export interface WikiSummary {
  title: string;
  extract: string;
  thumb: string | null;
  page: string | null;
}

export function readWikiSummary(json: unknown): WikiSummary | null {
  const o = json as { title?: unknown; extract?: unknown; thumbnail?: { source?: unknown }; content_urls?: { desktop?: { page?: unknown } } } | null;
  if (!o || typeof o.extract !== "string" || o.extract.trim() === "") return null;
  return {
    title: typeof o.title === "string" ? o.title : "",
    extract: o.extract.trim(),
    thumb: typeof o.thumbnail?.source === "string" ? o.thumbnail.source : null,
    page: typeof o.content_urls?.desktop?.page === "string" ? o.content_urls.desktop.page : null,
  };
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The Date pill's choices as ISO dates — `offsetDays` from `now` (the real clock unless a test injects one). */
export function dateChoiceIso(offsetDays: number, now: Date = new Date()): string {
  return isoDate(new Date(now.getTime() + offsetDays * 86400000));
}
