// The Sky section's rules, DOM-free: what a click on the chart means, the
// pills' choices, the card's lines and which Wikipedia article to ask for.
// tray.ts and sky-explore.ts render them; tests hold them against the real
// tables. Imports only the light half — never sky.ts, so astronomy-engine
// stays in the engine's lazy chunk.

import { FRAME, edgeStars, project, starColor, STAR_TINTS } from "../scenes/space/sky-rules";
import type { AltAz, Chart, Constellation, SkyLang, Star } from "../scenes/space/sky-types";
import type { Choice, Fact } from "./space-model";

export type Pt = [number, number];

export type SkyTarget =
  | { kind: "star"; hip: number }
  | { kind: "constellation"; abbr: string };

const dist2 = (a: Pt, b: Pt): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Squared distance from a point to a segment. */
function segDist2(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const len = vx * vx + vy * vy;
  if (len === 0) return dist2(p, a);
  let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, [a[0] + t * vx, a[1] + t * vy]);
}

/**
 * What a click on the chart means: the nearest drawn star within `slop`, else
 * the constellation whose lines pass closest within `slop`, else nothing.
 *
 * The section hit-tests itself rather than going through hitElement, because
 * the star field is ONE element (`draw` has no wildcard, so it has to be) and
 * a click inside it would otherwise only ever answer "the stars". A star beats
 * a line at equal distance: the smaller, definite thing is what was aimed at.
 */
export function targetAt(
  p: Pt,
  stars: readonly { hip: number; at: Pt }[],
  segs: readonly { abbr: string; a: Pt; b: Pt }[],
  slop = 14,
): SkyTarget | null {
  const r2 = slop * slop;
  let bestStar: number | null = null, bestStarD = r2;
  for (const s of stars) {
    const d = dist2(p, s.at);
    if (d <= bestStarD) { bestStarD = d; bestStar = s.hip; }
  }
  if (bestStar !== null) return { kind: "star", hip: bestStar };
  let bestCon: string | null = null, bestConD = r2;
  for (const s of segs) {
    const d = segDist2(p, s.a, s.b);
    if (d <= bestConD) { bestConD = d; bestCon = s.abbr; }
  }
  return bestCon === null ? null : { kind: "constellation", abbr: bestCon };
}

/** Offsets in hours from the figure's own moment. */
export const HOUR_CHOICES: Choice<number>[] = [
  { value: 0, label: { en: "Now", nb: "Nå" } },
  { value: 1, label: { en: "+1 hour", nb: "+1 time" } },
  { value: 6, label: { en: "+6 hours", nb: "+6 timer" } },
];

/** Offsets in days — a month and half a year, because half a year is when the
 *  same hour of night shows the opposite sky, and that is the lesson. */
export const DAY_CHOICES: Choice<number>[] = [
  { value: 0, label: { en: "Tonight", nb: "I kveld" } },
  { value: 30, label: { en: "+1 month", nb: "+1 måned" } },
  { value: 182, label: { en: "+6 months", nb: "+6 måneder" } },
];

const COMPASS_16 = {
  en: ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"],
  nb: ["nord", "nordøst", "øst", "sørøst", "sør", "sørvest", "vest", "nordvest"],
};

/** An azimuth as a word: what a viewer needs in order to go outside and look. */
export function directionWord(az: number, lang: SkyLang): string {
  const i = Math.round((((az % 360) + 360) % 360) / 45) % 8;
  return (lang === "nb" ? COMPASS_16.nb : COMPASS_16.en)[i];
}

const COLOUR_WORD: Record<string, { en: string; nb: string }> = {
  "#42618c": { en: "blue", nb: "blå" },
  "#4f6f8e": { en: "blue-white", nb: "blåhvit" },
  "#66697a": { en: "white", nb: "hvit" },
  "#7d6540": { en: "yellow", nb: "gul" },
  "#8d5932": { en: "orange", nb: "oransje" },
  "#94472a": { en: "red", nb: "rød" },
};

/** The colour the dot is drawn in, in words — the same band, so the card can
 *  never disagree with the page. */
export function colourWord(bv: number | null, lang: SkyLang): string {
  const w = COLOUR_WORD[starColor(bv)] ?? COLOUR_WORD[STAR_TINTS[2].color];
  return lang === "nb" ? w.nb : w.en;
}

const dec = (s: string, lang: SkyLang): string => (lang === "nb" ? s.replace(".", ",") : s);

/** A star's card: what the chart cannot draw. `at` is where it is right now,
 *  or null when the section has no position for it. */
export function starFacts(s: Star, at: AltAz | null, lang: SkyLang): Fact[] {
  const t = (en: string, nb: string): string => (lang === "nb" ? nb : en);
  const facts: Fact[] = [
    { label: t("Magnitude", "Lysstyrke"), value: dec(s.mag.toFixed(2), lang) },
    { label: t("Colour", "Farge"), value: colourWord(s.bv, lang) },
    { label: t("Catalogue", "Katalog"), value: `HIP ${s.hip}` },
  ];
  if (at) {
    facts.push({
      label: t("Altitude", "Høyde"),
      value: at.alt < 0
        ? t("below the horizon", "under horisonten")
        : `${Math.round(at.alt)}° ${t("above the horizon", "over horisonten")}`,
    });
    facts.push({ label: t("Direction", "Retning"), value: `${directionWord(at.az, lang)} (${Math.round(at.az)}°)` });
  }
  return facts;
}

/** A constellation's card: the three names side by side — which is the point,
 *  since the same figure is three different words and a question has to say
 *  which one it wants. */
export function constellationFacts(c: Constellation, brightest: Star | null, starCount: number, lang: SkyLang): Fact[] {
  const t = (en: string, nb: string): string => (lang === "nb" ? nb : en);
  const facts: Fact[] = [
    { label: t("Latin", "Latin"), value: c.name.la },
    { label: t("English", "Engelsk"), value: c.name.en },
    { label: t("Norwegian", "Norsk"), value: c.name.nb },
    { label: t("Abbreviation", "Forkortelse"), value: c.abbr },
  ];
  if (brightest && brightest.name) {
    facts.push({ label: t("Brightest star", "Klareste stjerne"), value: `${brightest.name} (${dec(brightest.mag.toFixed(2), lang)})` });
  }
  if (starCount > 0) facts.push({ label: t("Stars in the figure", "Stjerner i figuren"), value: String(starCount) });
  return facts;
}

/** Wikipedia disambiguates constellations, and does it differently per
 *  language. A title that misses gives a 404, which the card already survives:
 *  the table's facts stand alone. */
export function conWikiTitle(c: Constellation, lang: SkyLang): string {
  return lang === "nb" ? `${c.name.la} (stjernebilde)` : `${c.name.la} (constellation)`;
}

export function starWikiTitle(s: Star, lang: SkyLang): string {
  return (lang === "nb" && s.name_nb ? s.name_nb : s.name) ?? `HIP ${s.hip}`;
}

// ---- the focus portrait's own projection, so a click lands on the star the
// eye sees ----------------------------------------------------------------

export interface Frame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The magnifying-glass transform a `focus` portrait applies (space.yaml's
 * sky_map layout, the "Z" closure): fit `points` — the figure's own visible
 * edge stars, already projected through the whole-sky dome (`engines.sky.
 * project`) — inside `frame` with `pad` room, zoom clamped 1…6, centred at
 * (500, 390). Those are the exact numbers the template uses, so the section's
 * click overlay can hit-test a focused chart against the same picture the
 * viewer sees rather than the unfocused whole sky.
 *
 * No points (the figure is entirely below the horizon) is the identity — the
 * template's own fallback in that case is to stop focusing and draw the whole
 * sky instead, which the caller must also do before reaching for this.
 */
export function focusTransform(points: readonly Pt[], frame: Frame = FRAME, pad = 110): (p: Pt) => Pt {
  if (points.length === 0) return (p) => p;
  const xs = points.map((q) => q[0]), ys = points.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const zoom = Math.min(
    6,
    Math.max(
      1,
      Math.min((frame.x1 - frame.x0 - 2 * pad) / Math.max(1, x1 - x0), (frame.y1 - frame.y0 - 2 * pad) / Math.max(1, y1 - y0)),
    ),
  );
  const bx = (x0 + x1) / 2, by = (y0 + y1) / 2;
  return (p) => [500 + (p[0] - bx) * zoom, 390 + (p[1] - by) * zoom];
}

/** Whether a (possibly zoomed) point is inside `frame` — a portrait crops
 *  everything else off the page, and a click out there should find nothing. */
export function inFrame(p: Pt, frame: Frame = FRAME): boolean {
  return p[0] >= frame.x0 && p[0] <= frame.x1 && p[1] >= frame.y0 && p[1] <= frame.y1;
}

export type ConstellationMode = "both" | "lines" | "names" | "none";

export interface VisibleFieldInput {
  stars: readonly Star[];
  constellations: readonly Constellation[];
  /** Alt/az for the moment being drawn, keyed by HIP — `engines.sky.
   *  starPositions`'s own return shape. */
  pos: ReadonlyMap<number, AltAz>;
  chart: Chart;
  limitMag: number;
  mode: ConstellationMode;
  /** Stars named in `mark`/`highlight` — drawn, and so clickable, whatever
   *  `limitMag` says. The caller resolves the names (it needs the engine's
   *  index; this function only draws the consequence). */
  markStars?: ReadonlySet<number>;
  /** A constellation already confirmed to have at least one visible edge —
   *  the caller resolves `focus` the same way, for the same reason. */
  focus?: Constellation;
  frame?: Frame;
}

export interface VisibleField {
  stars: { hip: number; at: Pt }[];
  segs: { abbr: string; a: Pt; b: Pt }[];
}

/**
 * The chart's own drawn field, projected to screen points: which stars and
 * constellation edges are actually ON THE PAGE right now, and where. These
 * are the three rules space.yaml's sky_map layout draws by, reconstructed so
 * a click can never find something the chart does not show:
 *
 * - an edge is a hit target only when it is actually DRAWN — both its stars
 *   above the horizon, and the mode not "names" (names with no lines);
 * - a star fainter than `limitMag` is still on the page when a drawn edge
 *   reaches it, or the author named it in `mark`/`highlight` — but a
 *   `"names"`/`"none"` chart draws no edges, so it exempts no one;
 * - under `focus`, every position goes through the same magnifying-glass
 *   transform (`focusTransform`) the portrait uses, and anything the crop
 *   removes is dropped here too.
 *
 * targetAt then hit-tests a click against exactly this — never against the
 * whole catalogue, and never against last render's field.
 */
export function visibleField(input: VisibleFieldInput): VisibleField {
  const { stars, constellations, pos, chart, limitMag, mode, focus } = input;
  const markStars = input.markStars ?? new Set<number>();
  const frame = input.frame ?? FRAME;

  const bothUp = (a: number, b: number): [AltAz, AltAz] | null => {
    const pa = pos.get(a), pb = pos.get(b);
    return pa && pb && pa.alt >= 0 && pb.alt >= 0 ? [pa, pb] : null;
  };
  const toScreen: (p: Pt) => Pt = focus
    ? focusTransform(
      edgeStars(focus)
        .map((hip) => pos.get(hip))
        .filter((q): q is AltAz => q !== undefined && q.alt >= 0)
        .map((q) => project(q, chart)),
      frame,
    )
    : (p) => p;
  const proj = (q: AltAz): Pt => toScreen(project(q, chart));
  const onPage = (q: Pt): boolean => !focus || inFrame(q, frame);

  const showLines = mode !== "names" || focus !== undefined;
  const cons = focus ? [focus] : mode !== "none" ? constellations : [];
  const lineStars = new Set<number>();
  const segs: { abbr: string; a: Pt; b: Pt }[] = [];
  for (const c of cons) {
    for (const [a, b] of c.edges) {
      const up = bothUp(a, b);
      if (!up) continue;
      const sa = proj(up[0]), sb = proj(up[1]);
      if (!onPage(sa) || !onPage(sb)) continue;
      if (showLines) {
        lineStars.add(a);
        lineStars.add(b);
        segs.push({ abbr: c.abbr, a: sa, b: sb });
      }
    }
  }

  const outStars: { hip: number; at: Pt }[] = [];
  for (const s of stars) {
    const q = pos.get(s.hip);
    if (!q || q.alt < 0) continue;
    if (s.mag > limitMag && !lineStars.has(s.hip) && !markStars.has(s.hip)) continue;
    const sp = proj(q);
    if (!onPage(sp)) continue;
    outStars.push({ hip: s.hip, at: sp });
  }
  return { stars: outStars, segs };
}
