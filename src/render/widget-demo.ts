// The movie form of a template-bound ask (spec §2.4): perform the widget's
// demo effects on the player — taps awaited, sounds through the tones seam
// (which the exporter records), patches previewed so the figure follows.
import type { Player } from "./player";
import type { PlanStep } from "./plan";
import type { LayoutResult } from "../layout/layout";
import type { Spec } from "../spec/types";
import { scenes } from "../scenes/registry";
import { demoWidget } from "../scenes/widget-run";
import { buildWidgetScene } from "../scenes/widget-scene";
import { makeBrowserMeasure } from "./svg-backend";

export function widgetDemoFor(player: Player, spec: Spec, layout: LayoutResult): (signal: AbortSignal, step: Extract<PlanStep, { kind: "ask" }>) => Promise<void> {
  return async (signal, step) => {
    const module = spec.template ? scenes[spec.template] : undefined;
    if (!module?.widget || step.answer === undefined) return;
    const params = { ...(spec.params ?? {}), ...player.getParamOverrides() };
    // The demo must read the SAME scene the live host would (ui/widget-host.ts):
    // the painted geometry, the player's vars and one text measure. Build them
    // from one place so the laser never taps a box the viewer cannot see.
    // makeBrowserMeasure falls back to the heuristic when there is no document,
    // so the exporter and plain-node tests get a measure too.
    const measure = makeBrowserMeasure();
    const sceneOpts = () => ({ domain: spec.domain, vars: Object.fromEntries(player.vars), layout: player.paintedLayout() ?? layout, measure });
    const { effects, errors } = demoWidget(module, params, step.answer, sceneOpts());
    for (const m of errors) console.warn(`[widget ${spec.template}] demo: ${m}`);
    let patches: Record<string, unknown> = {};
    let scene = buildWidgetScene(module, params, sceneOpts());
    for (const e of effects) {
      if (signal.aborted) return;
      if (e.sound && player.tones) {
        if ("hz" in e.sound) player.tones.beep(e.sound.hz, e.sound.ms, signal);
        else player.tones.play([{ notes: e.sound.notes }], e.sound.tempo ?? 120, signal);
      }
      if (e.caption !== undefined) player.caption(e.caption);
      // An all-rejected patch ({} after validation) would otherwise repaint the
      // figure for nothing — and, worse, reveal ids on a frame that changed
      // nothing. The host guards the same branch the same way.
      if (e.patch && Object.keys(e.patch).length > 0) {
        patches = { ...patches, ...e.patch };
        player.previewParams(patches, { revealNew: true });
        scene = buildWidgetScene(module, { ...params, ...patches }, sceneOpts());
      }
      if (e.glow) await player.glow(e.glow, undefined, e.color);
      if (e.pointer) {
        const b = scene?.boxes.get(e.pointer);
        if (b) await player.tapAt(b, 900);
      }
    }
    if (effects.some((e) => e.caption !== undefined)) player.caption(null);
  };
}
