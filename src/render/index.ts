// The renderer module boundary (future web-component contract):
// render(spec, container, options) -> { timeline, update(diff), lint() }.
// Framework-free by design. One SVG renderer, two styles (sketchy/clean).

import { castLang } from "./quiz-words";
import { guessParts, guessSetup, patchFor } from "../guess/handles";
import { marketParts } from "../guess/parts";
import { authoredCards, cardsGeometryIn, type CardsGeometry } from "../spec/cards";
import { authoredScales } from "../spec/scale";
import { formulaBlanks, hasBlanks } from "../formula/blanks";
import type { BBox } from "../layout/geometry";
import type { DecisionTreeParams } from "../scenes/decision_tree/layout";
import { domainMapping, elementBBoxes, elementRings, layoutSpec, type LayoutResult } from "../layout/layout";
import type { MeasureFn } from "../layout/measure";
import { drawablesForId, leafDrawables, type Pt } from "../layout/model";
import type { LintIssue } from "../lint/lint";
import type { Spec, SpecElement } from "../spec/types";
import { placeCaption } from "./caption-place";
import { contentUnderCaption, darkUnderCaption } from "./caption-dark";
import { ensureFigureStyles, PATRICK_HAND_URLS } from "./figure-style";
import { splitVarOverrides, withNewIdsVisible, withOverrides } from "./params";
import { withVarValues } from "../spec/vars";
import { controlsOfFor, planCommands, type Plan, type PlanOptions } from "./plan";
import { withMinted, type MintedSpec } from "./minted";
import { dependentsMap, sourceIds } from "../spec/deps";
import { scratchCards } from "../spec/scratch";
import { boxAnchor } from "../layout/anchors";
import { settleCardsGeometry } from "../layout/settle";
import { isEmptyOverrides, overridesKey, type LayoutOverrides } from "../layout/posed";
import type { LabelPin } from "../layout/labels";
import { Player, type CodePatch, type FormulaRuntime, type PlaybackMode, type PlayerCallbacks } from "./player";
import { applyCodePatches, precomputeSweeps, sweepRunnerFor } from "./sweep-run";
import { stableHash } from "./sweep";
import { scanDataTokens, substituteDataTokens } from "../code/tokens";
import { decodeCodeResult } from "../code/envelope";
import { SpeechManager, type SpeechLike } from "./speech";
import { WebAudioTones, type ToneLike } from "./tones";
import { resolvePortraits } from "./portrait";
import { resolveCode } from "./code";
import { expandedRenderSpec } from "./resolve";
import { scenes } from "../scenes/registry";
import { widgetDemoFor } from "./widget-demo";
import { resolveSources } from "./source";
import { resolveImages } from "./image";
import { resolveLinks } from "./link";
import { resolveTemplatePictures } from "./template-pictures";
import { resolveIcons } from "./icon";
import { loadSettings } from "../store";
import { fontStack, makeBrowserMeasure, rendererFor, type RenderStyle } from "./svg-backend";
import { registerCastTemplates } from "../scenes/cast-templates";
import { isC64Screen } from "../layout/c64-screen";
import { enginesForSpec, enginesLoaded, ensureEnginesForSpecs, ensureMathFont } from "../scenes/engines";
import { applyTextStyle, effectiveTextStyle, scaledMeasure, type TextOverride, withTextStyle } from "../layout/text-style";
import { resolveInsets } from "./inset";

export type { RenderStyle } from "./svg-backend";

export interface RenderOptions {
  style?: RenderStyle;
  /**
   * The viewer's text override (Settings → Playback). The spec's own `text:`
   * block is read here regardless, so callers that never pass this — the
   * editor pane, the export — show the maker's defaults.
   */
  text?: TextOverride;
  mode?: PlaybackMode;
  speed?: number;
  speech?: SpeechLike;
  /** Sound engine for the play command; defaults to a shared speaker-connected WebAudioTones. The exporter passes one bound to its recording destination. */
  tones?: ToneLike;
  callbacks?: PlayerCallbacks;
  /** Viewer preference: skip quiz/ask questions entirely (collect-asks still store their defaults). */
  questions?: "on" | "skip";
  /** Variables carried in from earlier playlist items (playlist/carry.ts) — seeds the player's map. */
  vars?: ReadonlyMap<string, string>;
  /** Questions in earlier playlist items: this item's {_answers.N} continues from here. */
  questionOffset?: number;
  /** The playlist's item specs in order (authored, not the export sequence) — what an `inset` element takes its page from (spec 2026-09-17-inset §4.2). */
  siblings?: readonly Spec[];
}

export interface RenderHandle {
  timeline: Player;
  layout: LayoutResult;
  plan: Plan;
  /** The resolved clone the figure was laid out from (portraits, sources and code results stamped; tokens substituted). */
  spec: Spec;
  /** How this figure is drawn (options.style, defaulted). Read-only: the tray
   *  needs it to re-run a script in the look the drawing has — an unstyled
   *  chart follows the hand (src/code/chart-style.ts). */
  style: RenderStyle;
  /** The spec as passed to render — tokens intact — for previews that re-run a script. */
  authored: Spec;
  lint(): LintIssue[];
  /**
   * M5 stub: applies a shallow spec diff and re-renders in place.
   * Tweened transitions between old and new geometry are not implemented yet.
   */
  update(diff: Partial<Spec>): Promise<RenderHandle>;
  destroy(): void;
}

// One speaker-connected tone engine for all live players — its AudioContext
// is created lazily on the first play command.
let liveTonesSingleton: WebAudioTones | null = null;
function liveTones(): WebAudioTones {
  return (liveTonesSingleton ??= new WebAudioTones());
}

/**
 * The contact address Unpaywall asks its callers for (the OpenAlex fallback
 * on the DOI path). From the user's settings, or a build-time env var for
 * embedded/kiosk builds — never a hardcoded address in the repo. No address =
 * no Unpaywall call; OpenAlex alone covers most open-access papers.
 */
function contactEmail(): string {
  const env = import.meta.env?.VITE_CONTACT_EMAIL;
  if (typeof env === "string" && env.includes("@")) return env;
  try {
    return loadSettings().contactEmail?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * The `planCommands` options that read a layout but touch no DOM:
 * `pieceOf`/`expandId` let a `pieces` parent id (and the zipper arrange it
 * feeds) resolve to its `<id>_1 … <id>_n` children, `attachedTo` carries
 * a label along its target's `move`/`arrange`, and `anchorOf` looks up an
 * element's named points (design §2.1) for anchor-aware targeting. Pulled out
 * of `render()` so a test can plan the way the app does — with `layout.order`
 * alone (as `render()` used to before this option existed), a `pieces` parent
 * id is never in scope (layout.ts skips it: the children are the
 * command-addressable ids), so `draw`/`arrange` naming just the parent
 * silently drops as an unknown id instead of expanding.
 */
/**
 * The planner's `guessParts` hook (spec 2026-10-01-guess-and-reveal §4): the
 * parts an ask's `on` resolves to on this figure and what the question shows.
 * Exported so a test plans exactly as render() does.
 */
export function guessPartsFor(
  spec: Spec,
  layout: LayoutResult,
  measure?: MeasureFn,
): (on: string | string[], from?: number) => { parts: string[]; shows: string[] } {
  return (on, from) => {
    const parts = guessParts(spec, on);
    // A market curve's truth needs the next animate, which the plan has not
    // laid out yet: the curve itself is what the question shows.
    const market = marketParts(spec, parts);
    if (market.length > 0) return { parts: market, shows: market };
    const setup = guessSetup(spec, spec.params ?? {}, layout, parts, { from, ...(measure ? { measure } : {}) });
    return { parts: setup.handles.length > 0 ? parts : [], shows: setup.handles.flatMap((h) => h.shows) };
  };
}

/**
 * What the plan needs of a cards question (PlanOptions.cardsFor): the cards,
 * each one's offset to its true place, the numbers the answer shows, and
 * the cards the answer takes away. A formula's tiles all go: the right ones
 * give way to the truth's own glyphs in the boxes, the wrong ones slide home
 * and leave (fix wave 2026-10-03: none may stay to the end of the cast).
 */
export function cardsPlanFor(g: CardsGeometry | null): { cards: string[]; offsets: Record<string, Pt>; shows: string[]; hides?: string[]; gotos?: string[] } | null {
  if (!g) return null;
  const offsets: Record<string, Pt> = {};
  g.cards.forEach((c, i) => (offsets[c] = [g.truth[i][0] - g.home[i][0], g.truth[i][1] - g.home[i][1]]));
  // What follows a card (a compare value, a label attached to it) stands where its card does (page frame 2026-10-04).
  for (const [c, fs] of Object.entries(g.followers ?? {})) for (const f of fs) offsets[f] ??= offsets[c];
  const gotos = g.mode === "decide" ? (g.gotos ?? []).filter((l): l is string => l !== undefined) : [];
  return { cards: g.cards, offsets, shows: [...(g.valueIds ?? []), ...(g.arrows ?? [])], ...(g.mode === "fill" ? { hides: [...g.cards] } : {}), ...(gotos.length > 0 ? { gotos } : {}) };
}

/**
 * A formula's blanks (design 2026-10-03 §5), read off the mounted layout:
 * the math element's runtime (its blanks, a `fills` patch, its boxes), and
 * the cards an ask's `on` answers with — a cards element, or a formula's
 * tiles (`<id>_tiles`) with the blank boxes as the drop targets and the
 * tiles where layout drew them (under the formula as placed,
 * layout/tier2.ts placeFormulaTiles). Without the boxes the reveal would
 * move nothing. Pure, so a test can wire it the way render() does.
 */
export function formulaHooksFor(
  spec: Spec,
  bboxes: Map<string, BBox>,
  boxesIn: (layout: LayoutResult) => Map<string, BBox>,
  settle = 0,
): { cardsOn: (id: string) => CardsGeometry | null; formula: (id: string) => FormulaRuntime | null } {
  const texOf = (id: string): string | null => {
    const el = (spec.elements ?? []).find((e) => e.id === id);
    return el && el.type === "math" && typeof el.tex === "string" && hasBlanks(el.tex) ? el.tex : null;
  };
  const blanksOf = (mathId: string): BBox[] | null => {
    const tex = texOf(mathId);
    if (tex === null) return null;
    const boxes = formulaBlanks(mathId, tex).map((b) => bboxes.get(b.part) ?? null);
    return boxes.every((b): b is BBox => b !== null) ? boxes : null;
  };
  const homesOf = (cardId: string): Pt | null => {
    const b = bboxes.get(cardId);
    return b ? [b.x + b.w / 2, b.y + b.h / 2] : null;
  };
  return {
    // A cards element's geometry is the spec's: on a settled page
    // (layout/settle.ts) it moves with the ink. A formula's tiles are read
    // off the layout's boxes, which already moved.
    cardsOn: (id) => (texOf(id) !== null ? cardsGeometryIn(spec, `${id}_tiles`, blanksOf, homesOf) : settleCardsGeometry(cardsGeometryIn(spec, id), settle)),
    formula: (id) => {
      const tex = texOf(id);
      if (tex === null) return null;
      const blanks = formulaBlanks(id, tex);
      return {
        blanks,
        patch: (fills, base) => (base ?? spec.elements ?? []).map((e) => (e.id === id ? ({ ...e, fills } as SpecElement) : e)),
        boxes: (onScreen) => {
          const b = onScreen ? boxesIn(onScreen) : bboxes;
          return blanks.map((bl) => b.get(bl.part) ?? null);
        },
      };
    },
  };
}

/** Elements that live in a page's domain: they move in its units. */
const DATA_KINDS = new Set<string>(["point", "curve", "region", "arrow", "edge", "line", "axes"]);

export function planOptionsFor(
  spec: Spec,
  layout: LayoutResult,
): Pick<PlanOptions, "attachedTo" | "ownedBy" | "drawnWith" | "drawnAfter" | "partsOf" | "isPaper" | "pieceOf" | "expandId" | "expandGroup" | "anchorOf" | "leafPointsOf" | "measureOf" | "measuresDependingOn" | "dependentsOf" | "sourceIds" | "mathOf" | "isElement" | "controlsOf" | "dataToLogical" | "inDataUnits" | "pictureOf" | "labelOf"> {
  // Definitions hold (design 2026-09-10 §2.5): what is defined in terms of
  // what. A source that is a group or a pieces cut is moved through its
  // members (the planner expands it), so its dependents are attached to every
  // member and the members join the sources — a group's own id never carries
  // a pose (review finding 2).
  const deps = dependentsMap(spec.elements ?? []);
  const leavesOf = (id: string): string[] => layout.groups[id] ?? layout.pieceGroups[id] ?? [id];
  const depsByLeaf = new Map<string, string[]>();
  for (const [src, list] of deps) {
    for (const leaf of [src, ...leavesOf(src)]) depsByLeaf.set(leaf, [...new Set([...(depsByLeaf.get(leaf) ?? []), ...list])]);
  }
  const sources = [...new Set(sourceIds(spec.elements ?? []).flatMap((s) => [s, ...leavesOf(s)]))];
  // Which group each id belongs to: `arrange`/`move` change the resolved
  // CHILDREN of a `pieces` cut, while a measure anchored to the cut names the
  // PARENT — matching ids exactly left that measure stale and unwarned.
  const groupsOf = new Map<string, string[]>();
  for (const [parent, kids] of Object.entries(layout.pieceGroups)) {
    for (const kid of kids) {
      const cur = groupsOf.get(kid);
      if (cur) cur.push(parent);
      else groupsOf.set(kid, [parent]);
    }
  }
  // A scratch card (spec/scratch.ts) is one made thing: its box is the
  // paper each line is written on.
  const parts = new Map<string, string[]>();
  const papers = new Set<string>();
  for (const { box, lines } of scratchCards(layout.groups)) {
    papers.add(box);
    parts.set(box, lines);
    for (const l of lines) parts.set(l, [box]);
  }
  // A scale's answer marker (spec/scale.ts) belongs to its line: it goes
  // when the scale is erased and moves with it.
  const owned = new Map<string, string[]>();
  for (const sc of authoredScales(spec)) {
    const marker = [`${sc.id}_answer_pin`, `${sc.id}_answer_num`].filter((x) => layout.order.includes(x));
    if (marker.length > 0) owned.set(`${sc.id}_line`, marker);
  }
  // A compare card's value (outside the group, so drawing the cards gives
  // nothing away) belongs to its card: erased or hidden with it — the group
  // too — and moved with it.
  for (const cs of authoredCards(spec)) {
    if (cs.compare === undefined && !Array.isArray(cs.pairs)) continue;
    (cs.items ?? []).forEach((_, i) => {
      const v = `${cs.id}_v_${i + 1}`;
      if (layout.order.includes(v)) owned.set(`${cs.id}_${i + 1}`, [...(owned.get(`${cs.id}_${i + 1}`) ?? []), v]);
    });
  }
  /** The words a drawn thing goes by (choose's {c}): its text, its label, or the text it draws. */
  const textIn = (id: string): string | null => {
    const t = leafDrawables(drawablesForId(layout.drawables, id)).find((d) => d.kind === "text");
    return t && t.kind === "text" && typeof t.text === "string" && t.text.trim() !== "" ? t.text.trim() : null;
  };
  return {
    labelOf: (id) => {
      const el = spec.elements?.find((e) => e.id === id);
      for (const v of [el?.text, el?.label]) if (typeof v === "string" && v.trim() !== "") return v.trim();
      return textIn(id) ?? textIn(`label_${id}`);
    },
    ownedBy: (id) => owned.get(id) ?? [],
    partsOf: (id) => parts.get(id) ?? [],
    isPaper: (id) => papers.has(id),
    dependentsOf: (id) => depsByLeaf.get(id) ?? [],
    sourceIds: sources,
    // A sweep reads the AUTHORED control literals: this clone has already
    // rewritten them to their defaults, and `code_src` is where the original
    // was stamped — controlsOfFor reads whichever the spec has.
    controlsOf: controlsOfFor(spec),
    mathOf: (id) => {
      const el = spec.elements?.find((e) => e.id === id);
      return el?.type === "math" && typeof el.tex === "string" ? el.tex : null;
    },
    isElement: (id) => spec.elements?.some((e) => e.id === id) ?? false,
    // `{data: [x, y]}` in a command: the page's frame — its domain, or a
    // chart template's own axes — with the template fit applied.
    ...(layout.frame ? { dataToLogical: domainMapping(layout.frame, layout.fit).toLogical } : {}),
    // A move (and morph.to) is in the units of what it moves: on a page with
    // a domain, a point, a curve or an arrow moves in domain units, anything
    // else — text, a formula, a shape, a path — in canvas units. The page's
    // units used to apply to everything, so a formula copy moved "55 down"
    // travelled 319 (2026-09-25).
    pictureOf: (id) => {
      const meta = layout.pictures?.[id];
      if (!meta) return null;
      const d = leafDrawables(drawablesForId(layout.drawables, id)).find((x) => x.kind === "image" && x.id === `${id}__img`);
      if (!d || d.kind !== "image") return null;
      return { frame: { rect: { x: d.pos[0] - d.w / 2, y: d.pos[1] - d.h / 2, w: d.w, h: d.h }, view: meta.view }, regions: meta.regions };
    },
    inDataUnits: (id) => {
      if (!spec.domain) return false;
      const el = spec.elements?.find((e) => e.id === id);
      // An arrow drawn in canvas units ({canvas: [x, y]} ends) moves in them too.
      const canvasEnd = (v: unknown) => Array.isArray((v as { canvas?: unknown } | undefined)?.canvas);
      if (el && (el.type === "arrow" || el.type === "edge") && (canvasEnd(el.from) || canvasEnd(el.to))) return false;
      return !!el && DATA_KINDS.has(el.type);
    },
    pieceOf: (id) => layout.pieces[id] ?? null,
    measureOf: (id) => layout.measures[id] ?? null,
    // Which measures read this element: the one that measures it outright, and
    // the ones whose segment ends name it (design §2.3) — under either the id
    // itself or the pieces parent it belongs to, since a segment end on the
    // parent re-resolves through the planner's union-box `anchorNow`.
    // (`of: <parent>` stays a layout-time warning: pieces populate no shapes
    // for the parent, so there is nothing to measure — only the ends work.)
    measuresDependingOn: (id) => {
      const names = new Set([id, ...(groupsOf.get(id) ?? [])]);
      return Object.entries(layout.measures)
        .filter(([, m]) => (m.of !== undefined && names.has(m.of)) || (m.from && "ref" in m.from && m.from.ref !== undefined && names.has(m.from.ref)) || (m.to && "ref" in m.to && m.to.ref !== undefined && names.has(m.to.ref)))
        .map(([k]) => k);
    },
    expandId: (id) => layout.pieceGroups[id] ?? null,
    expandGroup: (id) => layout.groups[id] ?? null,
    drawnWith: (id) => (layout.drawnWith?.[id] ?? []).filter((x) => layout.order.includes(x)),
    drawnAfter: (id) => (layout.drawnAfter?.[id] ?? []).filter((x) => layout.order.includes(x)),
    anchorOf: (id, name) => layout.namedAnchors[id]?.[name] ?? null,
    leafPointsOf: (id) => {
      const out: { leafId: string; pts: Pt[]; closed: boolean }[] = [];
      for (const d of leafDrawables(drawablesForId(layout.drawables, id))) {
        if ((d.kind === "stroke" && !d.shapeHint && d.pts.length >= 2) || (d.kind === "area" && d.pts.length >= 3)) out.push({ leafId: d.id, pts: d.pts, closed: d.kind === "area" || d.closed === true });
      }
      return out.length > 0 ? out : null;
    },
    attachedTo: (id) => {
      const out: string[] = [];
      for (const el of spec.elements ?? []) if (el.type === "label" && el.attach_to === id) out.push(el.id, `${el.id}_leader`);
      if (layout.order.includes(`label_${id}`)) out.push(`label_${id}`, `label_${id}_leader`);
      // What the TEMPLATE says outright (scenes/types.ts `attached`), for the
      // labels the `label_<id>` guess above cannot see: `wtp_label` beside
      // `wtp_line`, `label_S` beside `supply_curve`.
      out.push(...(layout.attached[id] ?? []));
      out.push(...(owned.get(id) ?? []));
      // A spec label id can coincide with the implicit label_<id> convention
      // (e.g. {"id": "label_req", "attach_to": "req"}) — dedupe so the same
      // follower id isn't returned twice.
      return [...new Set(out)].filter((x) => layout.order.includes(x));
    },
  };
}

let fontsReady: Promise<void> | null = null;
let c64FontReady: Promise<void> | null = null;
/** The C64 face, only for a figure with a C64 screen on it (2026-10-03: it
 *  was fetched for every figure). Same 900 ms bound as the hand below. */
function ensureC64Font(): Promise<void> {
  if (c64FontReady) return c64FontReady;
  c64FontReady = (async () => {
    if (typeof document === "undefined" || !("fonts" in document)) return;
    try {
      await Promise.race([document.fonts.load("16px 'C64 Pro Mono'"), new Promise((r) => setTimeout(r, 900))]);
    } catch {
      /* measurement falls back gracefully */
    }
  })();
  return c64FontReady;
}
function ensureFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    if (typeof document === "undefined" || !("fonts" in document)) return;
    try {
      // A host that declared no Patrick Hand of its own (the frame harness,
      // a page embedding the engine) gets the bundled copy: without it the
      // labels fall back to a larger face than the one every formula is
      // written in, and formulas look shrunken (figure-style.ts).
      const declared = [...document.fonts].some((f) => f.family.replace(/["']/g, "") === "Patrick Hand");
      if (!declared && typeof FontFace !== "undefined") {
        document.fonts.add(new FontFace("Patrick Hand", PATRICK_HAND_URLS.map((u) => `url(${u}) format('truetype')`).join(", ")));
      }
      await Promise.race([document.fonts.load("26px 'Patrick Hand'"), new Promise((r) => setTimeout(r, 900))]);
    } catch {
      /* measurement falls back gracefully */
    }
  })();
  return fontsReady;
}

export async function render(spec: Spec, container: HTMLElement, options: RenderOptions = {}): Promise<RenderHandle> {
  // Which sibling THIS spec is, by identity, before anything clones or
  // expands it. The export sequence spreads an item's spec to append its
  // exit, so the elements array is the surviving identity there.
  const self = options.siblings ? options.siblings.findIndex((s) => s === spec || (s.elements !== undefined && s.elements === spec.elements)) : -1;
  // A cast that carries its own templates registers them before anything
  // reads the registry (template-on-demand): never shadows a built-in.
  registerCastTemplates(spec);
  ensureFigureStyles();
  await Promise.all([ensureFonts(), (spec.elements ?? []).some(isC64Screen) ? ensureC64Font() : undefined]);
  // Whatever the spec needs to be laid out at all: a template's engines, and
  // the mathjax engine a `math` element (or a TeX label) draws with. Layout is
  // synchronous, so an engine that is not here by now is an element that does
  // not draw — and SAYS so (tier2 pushes a warning per element). A failed
  // chunk fetch must therefore never reject here: that would blank the whole
  // figure instead of dropping the one element that needed the engine.
  await ensureEnginesForSpecs([spec]).catch((err) => {
    console.warn(`engine load failed: ${(err as Error).message}`);
  });
  // Portraits and sources resolve BEFORE layout (layout is synchronous):
  // cache-warm this is milliseconds; cache-cold it fetches + traces (or
  // fetches + renders a PDF page) during figure preparation, so playback never
  // stalls mid-figure and an export always records the finished image.
  // Failures degrade to the element's sketched placeholder, never a throw.
  // Resolved on a CLONE (B11): callers hand render the document's own spec
  // objects, and resolving on those rewrote the author's document as a side
  // effect of viewing it — see render/resolve.ts. Everything below, including
  // handle.spec, reads the resolved clone.
  // The spec as authored, kept on the handle: the code editor re-substitutes
  // "{id.path}" tokens into THESE params (the resolved clone below has the
  // values, not the tokens).
  const authored = spec;
  // A `card` beat (spec/card.ts) becomes its elements and commands here, so
  // layout, plan and lint below never see the verb — the same expansion the
  // compile-time lint applies — in expandedRenderSpec below, after a cards
  // element's item icons are resolved (they decide the cards' size).
  // Sketchy is the app's default look — and the default CHART style follows
  // it (a machine-ruled plot in a hand-drawn figure was the one bit of ink
  // that did not come from the app's own hand). Resolved once here, then
  // handed to every site that starts a run: the resolve pass below, the
  // sweep runner, and the tray (through the handle).
  const style: RenderStyle = options.style ?? "sketchy";
  spec = await expandedRenderSpec(spec, { resolvePortraits, resolveSources, resolveCode, resolveImages, resolveIcons, resolveLinks, resolveTemplatePictures, contactEmail: contactEmail(), style });
  const renderer = rendererFor(style);

  const figure = document.createElement("div");
  figure.className = "cs-figure";
  const stage = document.createElement("div");
  stage.className = "cs-stage";
  const caption = document.createElement("div");
  caption.className = "cs-caption cs-caption-empty";
  // The caption is a band ACROSS the bottom of the drawing, the way a video
  // carries its subtitles — figure chrome, never placed in canvas
  // coordinates, so it cannot collide with the drawing's own layout. The
  // frame carries NO title: the document's title is page furniture under
  // the player (ui/player-meta.ts), and a heading on the canvas is the
  // cast's own ink — a text element, or a `card` beat (2026-09-16).
  stage.appendChild(caption);
  figure.appendChild(stage);
  container.appendChild(figure);
  // Below the drawing when the stage has room, over it when not (caption-place.ts).
  const captionPlacer = placeCaption(stage, caption);

  // One text style for the whole figure (layout/text-style.ts): measured at
  // the size it will be drawn, then stamped on the drawables. The HTML text
  // — caption band, title — follows through two custom properties on the
  // figure, scoped there so the app chrome's own --sketch-font is untouched.
  const textStyle = effectiveTextStyle(spec, options.text);
  // The viewer's math font, hand and text size (Settings → Playback) may
  // differ from the spec's: load the font now — layout is synchronous — and
  // fold all three into the spec every layout below reads (a formula's size
  // and glyphs are decided in layout, not stamped after it like text). A
  // chunk that fails to fetch degrades to the font the engine has (tier2
  // warns per formula), never to a blank figure.
  // Only for a figure that draws math (2026-10-03): unconditionally, every
  // figure fetched MathJax and the Fira glyphs (~1 MB) before its first
  // stroke. Asked of the EXPANDED spec — a card or scratch line can bring a
  // formula with it — and of the engine cache, which ensureEnginesForSpecs
  // above filled for a template that declared mathjax.
  if (enginesLoaded(["mathjax"]) || enginesForSpec(spec).includes("mathjax")) {
    await ensureMathFont(textStyle.mathFont).catch((err) => {
      console.warn(`math font load failed: ${(err as Error).message}`);
    });
  }
  spec = withTextStyle(spec, textStyle);
  figure.style.setProperty("--cs-text-scale", String(textStyle.scale));
  figure.style.setProperty("--sketch-font", fontStack(textStyle.family));
  const measure = scaledMeasure(makeBrowserMeasure({ family: fontStack(textStyle.family), weight: textStyle.weight }), textStyle.scale);
  if ((spec.elements ?? []).some((e) => e.type === "inset")) {
    await resolveInsets(spec, {
      siblings: options.siblings,
      self,
      planOpts: planOptionsFor,
      measureFor: (ts) => scaledMeasure(makeBrowserMeasure({ family: fontStack(ts.family), weight: ts.weight }), ts.scale),
      prepare: async (source) => {
        await ensureEnginesForSpecs([source]);
        const resolved = await expandedRenderSpec(source, { resolvePortraits, resolveSources, resolveCode, resolveImages, resolveIcons, resolveLinks, resolveTemplatePictures, contactEmail: contactEmail(), style });
        const ts = effectiveTextStyle(resolved);
        await ensureMathFont(ts.mathFont).catch(() => undefined);
        return withTextStyle(resolved, ts);
      },
    });
  }
  const layout = applyTextStyle(layoutSpec(spec, measure), textStyle);
  const bboxes = elementBBoxes(layout, measure);

  // Param-state layouts for the animate command. Boundary layouts (commit,
  // plan-time bboxes) are cached; per-frame layouts are NOT (every tween tick
  // is a distinct param set — caching them would hoard hundreds of layouts).
  const boundaryLayouts = new Map<string, LayoutResult>();
  // A `run`'s live patches (spec 2026-09-15 §4.2): the swept script and its
  // fresh envelope, in place of the authored ones. Applied to FRAMES and to
  // BOUNDARY COMMITS alike — a commit that dropped them would snap the figure
  // back to the author's script at the end of every sweep — and part of the
  // boundary cache key, so a patched boundary never gets an unpatched layout
  // back out of the cache.
  const codePatches = new Map<string, CodePatch>();
  // Fields laid over an element for the rest of the cast — a formula's
  // `fills` once its ask has written the truths in (design 2026-10-03 §5.4).
  // Like the code patches: on frames and commits alike, and in the cache key.
  const elementPatches = new Map<string, Record<string, unknown>>();
  const patchesKey = (): string =>
    [
      codePatches.size === 0 ? "" : [...codePatches].map(([id, p]) => `${id}:${p.code.length}:${stableHash(p.code)}`).join("|"),
      elementPatches.size === 0 ? "" : JSON.stringify([...elementPatches]),
    ].join("#");
  const livePatched = (): SpecElement[] | undefined => {
    if (codePatches.size === 0 && elementPatches.size === 0) return undefined;
    const els = codePatches.size > 0 ? applyCodePatches(spec.elements ?? [], codePatches) : (spec.elements ?? []);
    return elementPatches.size === 0 ? els : els.map((e) => (elementPatches.has(e.id) ? ({ ...e, ...elementPatches.get(e.id) } as SpecElement) : e));
  };
  // Minted elements (design §2.1 round 3, §2.5 round 2 — trails, ghosts): set
  // once the plan is known, below — layoutFor and the mounted layout both
  // append them, so a reprojected preview or a scrub carries them too.
  // rawLayoutFor is the plain (unwrapped) layout at a param set, cached the
  // same way as before; layoutFor wraps it with withMinted, and hands
  // withMinted a RAW layoutAt so a ghost's boundary layout (minted under
  // animate) is never itself re-wrapped.
  let minted: MintedSpec[] = [];
  // `overrides` (design 2026-09-10 §2.5): the poses and shapes of the elements
  // something is defined by, at the boundary or frame being laid out. A
  // `vars.<name>` key in params is a var's swept value (design §2.4) and goes
  // to spec.vars, not to the template params.
  // `pins` (labels.ts, LabelPin) is the boundary's label placements, handed to
  // the FRAMES between boundaries so the solver is not re-run per rAF tick.
  // Never cached with one: a cached boundary layout must be the honest solve.
  const rawLayoutFor = (params: Record<string, unknown>, cache: boolean, elements?: SpecElement[], overrides?: LayoutOverrides, pins?: Record<string, LabelPin>): LayoutResult => {
    if (Object.keys(params).length === 0 && !elements && isEmptyOverrides(overrides) && codePatches.size === 0 && elementPatches.size === 0) return layout;
    // An elements override is the code editor's preview: never cached, its
    // key would be the whole patched script. A sweep's patches ARE cached —
    // one entry per run step's tail commit — but only under a key that names
    // them (their ids and script hashes), never the plain param key.
    const key = cache && !elements && !pins ? JSON.stringify([Object.entries(params).sort(), overridesKey(overrides), patchesKey()]) : undefined;
    const hit = key !== undefined ? boundaryLayouts.get(key) : undefined;
    if (hit) return hit;
    // A caller's own element list (the tray's preview) has the last word: it
    // was built from the viewer's edits and already carries whatever it wants
    // to keep. With none, a live sweep's patches stand in.
    const patched = elements ?? livePatched();
    // A `{id.var}` template param is harvested from the script's OUTPUT, so a
    // sweep that changes the output must change the param too — otherwise the
    // CE plane's threshold line walks while the number that labels it stands
    // still. Re-substituted into the AUTHORED params (the resolved clone
    // holds the harvested values, not the tokens), from the PATCHED elements'
    // fresh envelopes — the same reading the tray does in repaint(). The
    // caller's own params are explicit overrides and keep the last word.
    let effective = params;
    if (codePatches.size > 0 && scanDataTokens(authored.params).length > 0) {
      const from = patched ?? spec.elements ?? [];
      const sub = substituteDataTokens(authored.params, (codeId, path) => {
        const env = decodeCodeResult(from.find((e) => e.id === codeId)?.code_result);
        if (!env || !env.ok) return { error: env?.error ?? "the script did not run" };
        if (env.dataErrors && path in env.dataErrors) return { error: env.dataErrors[path] };
        if (env.data && path in env.data) return { value: env.data[path] };
        return { error: "not harvested" };
      }).params;
      effective = { ...sub, ...params };
    }
    const split = splitVarOverrides(effective);
    const l = applyTextStyle(
      layoutSpec(
        { ...spec, params: withOverrides(spec.params, split.params), ...(Object.keys(split.vars).length > 0 ? { vars: withVarValues(spec.vars, split.vars) } : {}), ...(patched ? { elements: patched } : {}) },
        measure,
        overrides,
        pins,
        // Per-frame/boundary layouts here: their .issues are never read (the
        // UI's lint is the mount-time layout above), and every tween tick
        // would otherwise pay for a second nested layoutSpec call for nothing.
        { skipDrawBeatLint: true },
      ),
      textStyle,
    );
    if (key !== undefined) boundaryLayouts.set(key, l);
    return l;
  };
  const layoutFor = (params: Record<string, unknown>, cache: boolean, elements?: SpecElement[], overrides?: LayoutOverrides, trailProgress?: Record<string, number>, pins?: Record<string, LabelPin>): LayoutResult =>
    withMinted(rawLayoutFor(params, cache, elements, overrides, pins), minted, (p, ov) => rawLayoutFor(p, true, undefined, ov), trailProgress);

  const formulas = formulaHooksFor(spec, bboxes, (l) => elementBBoxes(l, measure), layout.fit?.settle ?? 0);

  const plan = planCommands(spec.commands, layout.order, {
    book: spec.book !== undefined,
    ...(spec.feedback !== undefined ? { feedback: spec.feedback } : {}),
    bboxOf: (id) => bboxes.get(id) ?? null,
    // A spot ask's point inside the place (spec/spot.ts): read once, on the first ask that wants it.
    ringsOf: (() => {
      let rings: Map<string, Pt[][]> | null = null;
      return (id: string) => (rings ??= elementRings(layout)).get(id) ?? null;
    })(),
    windows: layout.windows ?? {},
    // The layout's own frame when it has one: it is the RESOLVED domain
    // (`box: "auto"` becomes a rectangle there, and only there).
    ...domainMapping(spec.domain && layout.frame ? layout.frame : spec.domain, layout.fit),
    animateBase: spec.template ? spec.params ?? {} : null,
    cardsFor: (id) => cardsPlanFor(formulas.cardsOn(id)),
    ...(layout.templateIds ? { templateIds: layout.templateIds } : {}),
    formulaFor: (id) => {
      const rt = formulas.formula(id);
      return rt ? { blanks: rt.blanks.length } : null;
    },
    guessParts: guessPartsFor(spec, layout, measure),
    ...(spec.template && scenes[spec.template]?.tweenSpace
      ? { tweenSpace: (key: string) => scenes[spec.template!]!.tweenSpace!(key, spec.params ?? {}) }
      : {}),
    varsBase: spec.vars ?? null,
    // A template's world larger than the page: camera boxes and `reset` are relative to it.
    ...(layout.world ? { world: layout.world } : {}),
    bboxesFor: (params, overrides) => {
      const b = elementBBoxes(layoutFor(params, true, undefined, overrides), measure);
      return (id) => b.get(id) ?? null;
    },
    // `{data: [x, y]}` after an animate: the axes as they then stand (the
    // same cached boundary layout bboxesFor just made).
    dataToLogicalFor: (params, overrides) => {
      const l = layoutFor(params, true, undefined, overrides);
      return l.frame ? domainMapping(l.frame, l.fit).toLogical : null;
    },
    // trail on animate samples 61 of these per sweep: uncached, or the
    // boundary cache would hoard them.
    anchorsAt: (params, overrides) => {
      const l = layoutFor(params, false, undefined, overrides);
      const b = elementBBoxes(l, measure);
      return (id, name) => {
        const named = l.namedAnchors[id]?.[name];
        if (named) return named;
        const box = b.get(id);
        return box ? boxAnchor(box, name) : null;
      };
    },
    ...planOptionsFor(spec, layout),
  });
  minted = plan.minted;
  const mountedLayout = withMinted(layout, minted, (p, ov) => rawLayoutFor(p, true, undefined, ov));

  const mounted = await renderer.mount(mountedLayout, spec, stage);

  const speech = options.speech ?? new SpeechManager();
  const player = new Player(
    plan,
    mounted.elements,
    speech,
    caption,
    { mode: options.mode, speed: options.speed, effects: mounted.effects, questions: options.questions, vars: options.vars, questionOffset: options.questionOffset, world: layout.world },
    options.callbacks,
  );
  player.setNarratorGender(spec.voice ?? null);
  // spec.lang, else what the lines read as: a generated Norwegian cast often has no lang.
  player.setSourceLang(castLang(spec));
  // Its `affirm` and question count: what a right quiz answer hears (render/affirm.ts).
  player.affirmer.configure(spec);
  player.tones = options.tones ?? liveTones();
  // Where a reward (confetti, a picture) bursts from: the answered part's layout box.
  player.partBox = (id) => bboxes.get(id) ?? null;
  // A template-bound ask needs its movie form HERE, on the player, not in the
  // controls layer: the exporter never attaches UI, and it must still see the
  // widget demonstrate itself. (The layout only gains minted trails/ghosts on
  // the way to `mountedLayout` — the widget's own parts sit at the same boxes
  // in both, and a patch re-reads the painted layout anyway.)
  if (spec.template && scenes[spec.template]?.widget) player.widgetDemo = widgetDemoFor(player, spec, layout);
  player.guess = {
    setup: (on, from, params, onScreen, opts) =>
      guessSetup(spec, withOverrides(spec.params ?? {}, params), onScreen ?? layout, guessParts(spec, on), {
        from,
        measure,
        ...(opts?.end ? { end: { params: withOverrides(spec.params ?? {}, opts.end.params), targets: opts.end.targets } } : {}),
      }),
    patch: (setup, values, elements) => patchFor(elements ? { ...spec, elements } : spec, setup, values),
    cards: (id) => formulas.cardsOn(id),
    formula: (id) => formulas.formula(id),
    // A tree ask (spec 2026-10-03 §4): the figure must be a decision tree.
    tree: () =>
      spec.template === "decision_tree"
        ? {
            params: (spec.params ?? {}) as unknown as DecisionTreeParams,
            boxes: (onScreen) => elementBBoxes(onScreen ?? layout, measure),
            edges: (onScreen) => {
              const out: Record<string, Pt[]> = {};
              for (const d of leafDrawables((onScreen ?? layout).drawables)) if (d.id.startsWith("edge_") && d.kind === "stroke") out[d.id] = d.pts;
              return out;
            },
          }
        : null,
  };

  if (mounted.swapGeometry && mounted.remount) {
    // The label placements the last committed boundary solved. A label's spot
    // is an argmin over eight sides at six rings; where the near candidates
    // score alike — a curve's obstacle boxes blanketing the plot area — the
    // winner changes whenever the geometry shifts a pixel, and a frame-by-frame
    // re-solve made labels hop across the figure several times a second
    // (measured on the frequency sweep: 42 jumps in 60 frames, up to 204
    // units). Frames inherit the boundary's choice and ride the anchor; the
    // solver runs at the boundaries only.
    let labelPins = mountedLayout.labelPins;
    let committed: LayoutResult | null = null;
    player.reprojector = {
      frame: (params, scene, o = {}) => {
        const l = layoutFor(params, false, o.elements, o.overrides, o.trailProgress, labelPins);
        // Free-play previews mint element ids the plan never drew (a chess
        // piece moved to a never-visited square) — reveal those, measured
        // against the plan-time layout so honest hidden ids stay hidden.
        // Measured against the MOUNTED layout, which already carries every
        // minted trail and ghost of the storyboard: only ids the frame's own
        // layout mints (a piece a param change adds) are new — a later
        // step's ghost must not appear ahead of time (review finding 3).
        const vis = o.revealNew ? withNewIdsVisible(new Set(mountedLayout.order), l.order, scene.visible) : scene.visible;
        mounted.swapGeometry!(l, vis, scene.offsets, scene.turns, scene.opacities, scene.shapes, scene.texts);
        return l; // what is now PAINTED — the player hands it to anything hit-testing
      },
      commit: (params, overrides) => {
        const l = layoutFor(params, true, undefined, overrides);
        labelPins = l.labelPins;
        committed = l;
        return mounted.remount!(l);
      },
      committed: () => committed,
      setCodePatch: (id, p) => {
        if (p) codePatches.set(id, p);
        else codePatches.delete(id);
      },
      patchedElements: livePatched,
      setElementPatch: (id, fields) => {
        if (fields) elementPatches.set(id, fields);
        else elementPatches.delete(id);
      },
    };
  }

  // The `run` verb's engine. Wired HERE, not in the tray: the exporter drives
  // this same player with no UI at all (src/export/video.ts), and a movie
  // whose sweeps did nothing would be the whole point of the verb missing.
  // The AUTHORED spec, because its control literals are still tuples; the
  // default deps, because that is exactly what resolveCode runs with — same
  // runtime, same cache, and the same render style behind the chart default.
  const sweepRunner = sweepRunnerFor(authored, { style });
  player.sweepRunner = sweepRunner;
  // Words written over dark ground (a photo, a C64 screen) take the band.
  const darkIds = darkUnderCaption(mountedLayout.drawables);
  // …and a cast with words or markers in that strip keeps them uncovered:
  // with CC on and no room below, the drawing shrinks for a strip of its own.
  captionPlacer.setNeedsStrip(contentUnderCaption(mountedLayout.drawables));
  if (darkIds.size > 0) player.captionOnDark = (visible) => visible.some((id) => darkIds.has(id));
  // …and the cache is filled while the viewer watches the opening: every run
  // step's value maps, once, when the drawcast first starts playing. By the
  // time the sweep arrives, each step is a cache read.
  // Set when this figure is torn down or replaced (destroy/update below). The
  // idle precompute below can start after that — it is scheduled on an idle
  // callback and boots a runtime per step — and must stop when it does.
  let disposed = false;
  if (plan.steps.some((s) => s.kind === "run")) {
    let warmed = false;
    const prevOnState = player.callbacks.onState;
    player.callbacks.onState = (s) => {
      prevOnState?.(s);
      if (s !== "playing" || warmed) return;
      warmed = true;
      // Wrapped, never handed over detached: requestIdleCallback is a method
      // of the global and throws "Illegal invocation" when called bare.
      const hasIdle = typeof (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback === "function";
      const idle = hasIdle ? (cb: () => void) => requestIdleCallback(cb) : (cb: () => void) => setTimeout(cb, 300);
      idle(() => {
        if (disposed) return;
        void precomputeSweeps(plan, sweepRunner, () => disposed);
      });
    };
  }

  const handle: RenderHandle = {
    timeline: player,
    layout: mountedLayout,
    plan,
    spec,
    authored,
    style,
    lint: () => layout.issues,
    update: async (diff) => {
      disposed = true;
      captionPlacer.dispose();
      player.dispose();
      mounted.destroy();
      figure.remove();
      const next = await render({ ...spec, ...diff }, container, options);
      Object.assign(handle, next);
      return handle;
    },
    destroy: () => {
      disposed = true;
      captionPlacer.dispose();
      player.dispose();
      mounted.destroy();
      figure.remove();
    },
  };
  return handle;
}
