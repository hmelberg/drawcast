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

export function widgetDemoFor(player: Player, spec: Spec, layout: LayoutResult): (signal: AbortSignal, step: Extract<PlanStep, { kind: "ask" }>) => Promise<void> {
  return async (signal, step) => {
    const module = spec.template ? scenes[spec.template] : undefined;
    if (!module?.widget || step.answer === undefined) return;
    const params = { ...(spec.params ?? {}), ...player.getParamOverrides() };
    const { effects, errors } = demoWidget(module, params, step.answer, { domain: spec.domain, layout });
    for (const m of errors) console.warn(`[widget ${spec.template}] demo: ${m}`);
    let patches: Record<string, unknown> = {};
    let scene = buildWidgetScene(module, params, { domain: spec.domain, layout });
    for (const e of effects) {
      if (signal.aborted) return;
      if (e.sound && player.tones) {
        if ("hz" in e.sound) player.tones.beep(e.sound.hz, e.sound.ms, signal);
        else player.tones.play([{ notes: e.sound.notes }], e.sound.tempo ?? 120, signal);
      }
      if (e.caption !== undefined) player.caption(e.caption);
      if (e.patch) {
        patches = { ...patches, ...e.patch };
        player.previewParams(patches, { revealNew: true });
        scene = buildWidgetScene(module, { ...params, ...patches }, { domain: spec.domain, layout: player.paintedLayout() ?? layout });
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
