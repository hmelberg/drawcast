// The renderer module boundary (future web-component contract):
// render(spec, container, options) -> { timeline, update(diff), lint() }.
// Framework-free by design. One SVG renderer, two styles (sketchy/clean).

import { domainMapping, elementBBoxes, layoutSpec, type LayoutResult } from "../layout/layout";
import type { LintIssue } from "../lint/lint";
import type { Spec, SpecElement } from "../spec/types";
import { ensureFigureStyles } from "./figure-style";
import { withNewIdsVisible, withOverrides } from "./params";
import { planCommands, type Plan } from "./plan";
import { Player, type PlaybackMode, type PlayerCallbacks } from "./player";
import { SpeechManager, type SpeechLike } from "./speech";
import { WebAudioTones, type ToneLike } from "./tones";
import { resolvePortraits } from "./portrait";
import { resolveCode } from "./code";
import { resolvedRenderSpec } from "./resolve";
import { titleIsDrawn } from "./title";
import { resolveSources } from "./source";
import { loadSettings } from "../store";
import { fontStack, makeBrowserMeasure, rendererFor, type RenderStyle } from "./svg-backend";
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
  ensureFigureStyles();
  await ensureFonts();
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
  spec = await resolvedRenderSpec(spec, { resolvePortraits, resolveSources, resolveCode, contactEmail: contactEmail() });
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
  const layoutFor = (params: Record<string, unknown>, cache: boolean, elements?: SpecElement[]): LayoutResult => {
    if (Object.keys(params).length === 0 && !elements) return layout;
    // An elements override is the code editor's preview: never cached, its
    // key would be the whole patched script.
    const key = cache && !elements ? JSON.stringify(Object.entries(params).sort()) : undefined;
    const hit = key !== undefined ? boundaryLayouts.get(key) : undefined;
    if (hit) return hit;
    const l = applyTextStyle(
      layoutSpec({ ...spec, params: withOverrides(spec.params, params), ...(elements ? { elements } : {}) }, measure),
      textStyle,
    );
    if (key !== undefined) boundaryLayouts.set(key, l);
    return l;
  };

  const plan = planCommands(spec.commands, layout.order, {
    bboxOf: (id) => bboxes.get(id) ?? null,
    windows: layout.windows ?? {},
    ...domainMapping(spec.domain),
    animateBase: spec.template ? spec.params ?? {} : null,
    bboxesFor: (params) => {
      const b = elementBBoxes(layoutFor(params, true), measure);
      return (id) => b.get(id) ?? null;
    },
  });

  const mounted = await renderer.mount(layout, spec, stage);

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
      frame: (params, visible, offsets, revealNew, elements) => {
        const l = layoutFor(params, false, elements);
        // Free-play previews mint element ids the plan never drew (a chess
        // piece moved to a never-visited square) — reveal those, measured
        // against the plan-time layout so honest hidden ids stay hidden.
        const vis = revealNew ? withNewIdsVisible(new Set(layout.order), l.order, visible) : visible;
        mounted.swapGeometry!(l, vis, offsets);
        return l; // what is now PAINTED — the player hands it to anything hit-testing

      },
      commit: (params) => mounted.remount!(layoutFor(params, true)),
    };
  }

  const handle: RenderHandle = {
    timeline: player,
    layout,
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
