// The renderer module boundary (future web-component contract):
// render(spec, container, options) -> { timeline, update(diff), lint() }.
// Framework-free by design. One SVG renderer, two styles (sketchy/clean).

import { domainMapping, elementBBoxes, layoutSpec, type LayoutResult } from "../layout/layout";
import { drawablesForId, leafDrawables, type Pt } from "../layout/model";
import type { LintIssue } from "../lint/lint";
import type { Spec, SpecElement } from "../spec/types";
import { ensureFigureStyles } from "./figure-style";
import { splitVarOverrides, withNewIdsVisible, withOverrides } from "./params";
import { planCommands, type Plan, type PlanOptions } from "./plan";
import { withMinted, type MintedSpec } from "./minted";
import { dependentsMap, sourceIds } from "../spec/deps";
import { boxAnchor } from "../layout/anchors";
import { isEmptyOverrides, overridesKey, type LayoutOverrides } from "../layout/posed";
import { Player, type PlaybackMode, type PlayerCallbacks } from "./player";
import { SpeechManager, type SpeechLike } from "./speech";
import { WebAudioTones, type ToneLike } from "./tones";
import { resolvePortraits } from "./portrait";
import { resolveCode } from "./code";
import { resolvedRenderSpec } from "./resolve";
import { titleIsDrawn } from "./title";
import { resolveSources } from "./source";
import { resolveImages } from "./image";
import { resolveIcons } from "./icon";
import { loadSettings } from "../store";
import { fontStack, makeBrowserMeasure, rendererFor, type RenderStyle } from "./svg-backend";
import { registerCastTemplates } from "../scenes/cast-templates";
import { ensureEnginesForSpecs } from "../scenes/engines";
import { applyTextStyle, effectiveTextStyle, scaledMeasure, type TextOverride } from "../layout/text-style";

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
}

export interface RenderHandle {
  timeline: Player;
  layout: LayoutResult;
  plan: Plan;
  /** The resolved clone the figure was laid out from (portraits, sources and code results stamped; tokens substituted). */
  spec: Spec;
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
export function planOptionsFor(
  spec: Spec,
  layout: LayoutResult,
): Pick<PlanOptions, "attachedTo" | "pieceOf" | "expandId" | "expandGroup" | "anchorOf" | "leafPointsOf" | "measureOf" | "measuresDependingOn" | "dependentsOf" | "sourceIds"> {
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
  return {
    dependentsOf: (id) => depsByLeaf.get(id) ?? [],
    sourceIds: sources,
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
      // A spec label id can coincide with the implicit label_<id> convention
      // (e.g. {"id": "label_req", "attach_to": "req"}) — dedupe so the same
      // follower id isn't returned twice.
      return [...new Set(out)].filter((x) => layout.order.includes(x));
    },
  };
}

let fontsReady: Promise<void> | null = null;
function ensureFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    if (typeof document === "undefined" || !("fonts" in document)) return;
    try {
      await Promise.race([
        document.fonts.load("26px 'Patrick Hand'"),
        document.fonts.load("16px 'C64 Pro Mono'"),
        new Promise((r) => setTimeout(r, 900)),
      ]);
    } catch {
      /* measurement falls back gracefully */
    }
  })();
  return fontsReady;
}

export async function render(spec: Spec, container: HTMLElement, options: RenderOptions = {}): Promise<RenderHandle> {
  // A cast that carries its own templates registers them before anything
  // reads the registry (template-on-demand): never shadows a built-in.
  registerCastTemplates(spec);
  ensureFigureStyles();
  await ensureFonts();
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
  spec = await resolvedRenderSpec(spec, { resolvePortraits, resolveSources, resolveCode, resolveImages, resolveIcons, contactEmail: contactEmail() });
  const renderer = rendererFor(options.style ?? "sketchy");

  const figure = document.createElement("div");
  figure.className = "cs-figure";
  const stage = document.createElement("div");
  stage.className = "cs-stage";
  const caption = document.createElement("div");
  caption.className = "cs-caption cs-caption-empty";
  // The caption is a band ACROSS the bottom of the drawing, the way a video
  // carries its subtitles — figure chrome, never placed in canvas
  // coordinates, so it cannot collide with the drawing's own layout. The
  // TITLE is added after layout below: it only appears when the drawing
  // does not draw it itself (C9 as Hans clarified it).
  stage.appendChild(caption);
  figure.appendChild(stage);
  container.appendChild(figure);

  // One text style for the whole figure (layout/text-style.ts): measured at
  // the size it will be drawn, then stamped on the drawables. The HTML text
  // — caption band, title — follows through two custom properties on the
  // figure, scoped there so the app chrome's own --sketch-font is untouched.
  const textStyle = effectiveTextStyle(spec, options.text);
  figure.style.setProperty("--cs-text-scale", String(textStyle.scale));
  figure.style.setProperty("--sketch-font", fontStack(textStyle.family));
  const measure = scaledMeasure(makeBrowserMeasure({ family: fontStack(textStyle.family), weight: textStyle.weight }), textStyle.scale);
  const layout = applyTextStyle(layoutSpec(spec, measure), textStyle);
  const bboxes = elementBBoxes(layout, measure);

  // A title that is PART of the drawcast — drawn ink, the opening beat the
  // compiler prompt asks for — goes on top of the canvas, and then the app
  // adds NO title text of its own: a chrome title duplicating the drawn one
  // is exactly what Hans didn't want (C9, clarified 2026-09-02). The HTML
  // title above the drawing is the fallback for casts that never draw theirs.
  if (spec.title && !titleIsDrawn(spec.title, layout.drawables)) {
    const title = document.createElement("div");
    title.className = "cs-title";
    title.textContent = spec.title;
    figure.insertBefore(title, stage);
  }

  // Param-state layouts for the animate command. Boundary layouts (commit,
  // plan-time bboxes) are cached; per-frame layouts are NOT (every tween tick
  // is a distinct param set — caching them would hoard hundreds of layouts).
  const boundaryLayouts = new Map<string, LayoutResult>();
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
  const rawLayoutFor = (params: Record<string, unknown>, cache: boolean, elements?: SpecElement[], overrides?: LayoutOverrides): LayoutResult => {
    if (Object.keys(params).length === 0 && !elements && isEmptyOverrides(overrides)) return layout;
    // An elements override is the code editor's preview: never cached, its
    // key would be the whole patched script.
    const key = cache && !elements ? JSON.stringify([Object.entries(params).sort(), overridesKey(overrides)]) : undefined;
    const hit = key !== undefined ? boundaryLayouts.get(key) : undefined;
    if (hit) return hit;
    const split = splitVarOverrides(params);
    const l = applyTextStyle(
      layoutSpec(
        { ...spec, params: withOverrides(spec.params, split.params), ...(Object.keys(split.vars).length > 0 ? { vars: { ...(spec.vars ?? {}), ...split.vars } } : {}), ...(elements ? { elements } : {}) },
        measure,
        overrides,
      ),
      textStyle,
    );
    if (key !== undefined) boundaryLayouts.set(key, l);
    return l;
  };
  const layoutFor = (params: Record<string, unknown>, cache: boolean, elements?: SpecElement[], overrides?: LayoutOverrides, trailProgress?: Record<string, number>): LayoutResult =>
    withMinted(rawLayoutFor(params, cache, elements, overrides), minted, (p, ov) => rawLayoutFor(p, true, undefined, ov), trailProgress);

  const plan = planCommands(spec.commands, layout.order, {
    bboxOf: (id) => bboxes.get(id) ?? null,
    windows: layout.windows ?? {},
    ...domainMapping(spec.domain),
    animateBase: spec.template ? spec.params ?? {} : null,
    varsBase: spec.vars ?? null,
    bboxesFor: (params, overrides) => {
      const b = elementBBoxes(layoutFor(params, true, undefined, overrides), measure);
      return (id) => b.get(id) ?? null;
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
    { mode: options.mode, speed: options.speed, effects: mounted.effects, questions: options.questions },
    options.callbacks,
  );
  player.setNarratorGender(spec.voice ?? null);
  player.tones = options.tones ?? liveTones();

  if (mounted.swapGeometry && mounted.remount) {
    player.reprojector = {
      frame: (params, scene, o = {}) => {
        const l = layoutFor(params, false, o.elements, o.overrides, o.trailProgress);
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
      commit: (params, overrides) => mounted.remount!(layoutFor(params, true, undefined, overrides)),
    };
  }

  const handle: RenderHandle = {
    timeline: player,
    layout: mountedLayout,
    plan,
    spec,
    authored,
    lint: () => layout.issues,
    update: async (diff) => {
      player.dispose();
      mounted.destroy();
      figure.remove();
      const next = await render({ ...spec, ...diff }, container, options);
      Object.assign(handle, next);
      return handle;
    },
    destroy: () => {
      player.dispose();
      mounted.destroy();
      figure.remove();
    },
  };
  return handle;
}
