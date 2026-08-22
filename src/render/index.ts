// The renderer module boundary (future web-component contract):
// render(spec, container, options) -> { timeline, update(diff), lint() }.
// Framework-free by design. One SVG renderer, two styles (sketchy/clean).

import { domainMapping, elementBBoxes, layoutSpec, type LayoutResult } from "../layout/layout";
import type { LintIssue } from "../lint/lint";
import type { Spec } from "../spec/types";
import { planCommands, type Plan } from "./plan";
import { Player, type PlaybackMode, type PlayerCallbacks } from "./player";
import { SpeechManager } from "./speech";
import { makeBrowserMeasure, rendererFor, type RenderStyle } from "./svg-backend";

export type { RenderStyle } from "./svg-backend";

export interface RenderOptions {
  style?: RenderStyle;
  mode?: PlaybackMode;
  speed?: number;
  speech?: SpeechManager;
  callbacks?: PlayerCallbacks;
}

export interface RenderHandle {
  timeline: Player;
  layout: LayoutResult;
  plan: Plan;
  spec: Spec;
  lint(): LintIssue[];
  /**
   * M5 stub: applies a shallow spec diff and re-renders in place.
   * Tweened transitions between old and new geometry are not implemented yet.
   */
  update(diff: Partial<Spec>): Promise<RenderHandle>;
  destroy(): void;
}

let fontsReady: Promise<void> | null = null;
function ensureFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    if (typeof document === "undefined" || !("fonts" in document)) return;
    try {
      await Promise.race([
        document.fonts.load("26px 'Patrick Hand'"),
        new Promise((r) => setTimeout(r, 900)),
      ]);
    } catch {
      /* measurement falls back gracefully */
    }
  })();
  return fontsReady;
}

export async function render(spec: Spec, container: HTMLElement, options: RenderOptions = {}): Promise<RenderHandle> {
  await ensureFonts();
  const renderer = rendererFor(options.style ?? "sketchy");

  const figure = document.createElement("div");
  figure.className = "cs-figure";
  const stage = document.createElement("div");
  stage.className = "cs-stage";
  const caption = document.createElement("div");
  caption.className = "cs-caption cs-caption-empty";
  // Title above, caption below — figure chrome, never inside the canvas
  // coordinates (so it can never collide with the drawing).
  if (spec.title) {
    const title = document.createElement("div");
    title.className = "cs-title";
    title.textContent = spec.title;
    figure.appendChild(title);
  }
  figure.append(stage, caption);
  container.appendChild(figure);

  const measure = makeBrowserMeasure();
  const layout = layoutSpec(spec, measure);
  const bboxes = elementBBoxes(layout, measure);
  const plan = planCommands(spec.commands, layout.order, {
    bboxOf: (id) => bboxes.get(id) ?? null,
    ...domainMapping(spec.domain),
  });

  const mounted = await renderer.mount(layout, spec, stage);

  const speech = options.speech ?? new SpeechManager();
  const player = new Player(
    plan,
    mounted.elements,
    speech,
    caption,
    { mode: options.mode, speed: options.speed, effects: mounted.effects },
    options.callbacks,
  );

  const handle: RenderHandle = {
    timeline: player,
    layout,
    plan,
    spec,
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
