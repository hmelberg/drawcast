// Stepping a widget body, and the node harness authors and the examples gate
// run a click sequence through (spec §2.8). Nothing here touches the DOM.
import { hitElement } from "../ui/hit";
import { validateEffects, type WidgetEffect } from "./widget-effects";
import { buildWidgetScene, paramNamesOf, type WidgetSceneOpts } from "./widget-scene";
import type { SceneModule } from "./types";
import type { WidgetBody, WidgetEvent, WidgetScene } from "./widget-types";

export function stepWidget(body: WidgetBody, state: unknown, event: WidgetEvent, scene: WidgetScene, paramNames: string[]): { state: unknown; effects: WidgetEffect[]; errors: string[] } {
  let out: unknown;
  try {
    out = body.on(event, state, scene);
  } catch (err) {
    return { state, effects: [], errors: [`widget on() threw: ${(err as Error).message}`] };
  }
  const r = out as { state?: unknown; effects?: unknown } | null;
  if (typeof r !== "object" || r === null || !("state" in r) || !("effects" in r)) {
    return { state, effects: [], errors: ["widget on() must return { state, effects }"] };
  }
  const v = validateEffects(r.effects, { ids: scene.ids, paramNames });
  return { state: r.state, effects: v.effects, errors: v.issues };
}

/** A key event for the harness and the tests: the key, held `ms`. */
export const keyEvent = (key: string, ms: number): WidgetEvent => ({ type: "key", key, ms });

export interface WidgetRun {
  states: unknown[];
  effects: WidgetEffect[][];
  errors: string[];
  answer: string | null;
  params: Record<string, unknown>;
}

/** Click the parts in order (an id clicks the part's box centre; a full event
 *  is used as given). After each patch the scene is rebuilt at the patched params. */
export function runWidget(module: SceneModule, params: Record<string, unknown>, clicks: (string | WidgetEvent)[], opts: WidgetSceneOpts = {}): WidgetRun {
  const run: WidgetRun = { states: [], effects: [], errors: [], answer: null, params: { ...params } };
  if (!module.widget) return { ...run, errors: ["template has no widget body"] };
  const names = paramNamesOf(module);
  let scene = buildWidgetScene(module, run.params, opts);
  if (!scene) return { ...run, errors: ["template has no layout"] };
  let body: WidgetBody;
  let state: unknown;
  try {
    // Construction runs the author's `return { init, on }` line; init() runs
    // their setup. Both are reported, never raised — the harness and the
    // examples gate must say what broke, not crash on it.
    body = module.widget();
    state = body.init(scene);
  } catch (err) {
    return { ...run, errors: [`widget init() threw: ${(err as Error).message}`] };
  }
  for (const c of clicks) {
    const ev: WidgetEvent | null =
      typeof c === "string"
        ? (() => {
            const b = scene!.boxes.get(c);
            if (!b) return null;
            const point: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
            return { type: "click", id: c, point, domain: scene!.toDomain(point) };
          })()
        : c;
    if (!ev) {
      run.errors.push(`click: "${String(c)}" is not a part (${scene.ids.join(", ")})`);
      continue;
    }
    const r = stepWidget(body, state, ev, scene, names);
    state = r.state;
    run.states.push(state);
    run.effects.push(r.effects);
    run.errors.push(...r.errors);
    let patched = false;
    for (const e of r.effects) {
      if (e.patch) {
        Object.assign(run.params, e.patch);
        patched = true;
      }
      if (e.answer !== undefined) run.answer = e.answer;
    }
    if (patched) scene = buildWidgetScene(module, run.params, opts) ?? scene;
  }
  return run;
}

/** The movie form: the body's demo effects, validated — or one tap on the first part. */
export function demoWidget(module: SceneModule, params: Record<string, unknown>, answer: string, opts: WidgetSceneOpts = {}): { effects: WidgetEffect[]; errors: string[] } {
  const scene = buildWidgetScene(module, params, opts);
  if (!scene || !module.widget) return { effects: [], errors: ["template has no widget body"] };
  let raw: unknown;
  try {
    const body = module.widget();
    if (!body.demo) return { effects: scene.ids.length > 0 ? [{ pointer: scene.ids[0] }] : [], errors: [] };
    raw = body.demo(scene, answer);
  } catch (err) {
    return { effects: [], errors: [`widget demo() threw: ${(err as Error).message}`] };
  }
  const v = validateEffects(raw, { ids: scene.ids, paramNames: paramNamesOf(module) });
  return { effects: v.effects, errors: v.issues };
}

/**
 * Where a click at `p` lands on the widget's SURFACE, with the click gates'
 * fat-finger slop.
 *
 * The surface is the parts that have a closed outline (`scene.rings`) — the
 * thing you can point at and be inside of: a pad, a peg's zone, a switch.
 * Texts, open strokes and axes are not tappable, so the info card keeps them
 * (spec §2.3): every top-level part standing the card aside made a title or a
 * legend dead to the viewer. `scene.ids` stays the full part list — a body
 * may still glow or point at a label it never gets clicks from.
 */
export function partAt(scene: WidgetScene, p: [number, number], slop = 18): string | null {
  const surface = new Map([...scene.boxes].filter(([id]) => scene.rings.has(id)));
  return hitElement(surface, p, slop, scene.rings);
}
