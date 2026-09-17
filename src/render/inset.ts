// src/render/inset.ts
// Building an inset's picture (spec 2026-09-17-inset §4.3): the source item's
// final frame as drawables. Runs ONCE per render, in render() after the
// resolve pass and before layout — layoutSpec is synchronous and re-runs per
// tween frame, so the picture cannot be built inside it; tier2.ts only fits
// what is stored here. `pictureOf` is pure (no DOM, no fetch) so vitest can
// exercise the whole path; `resolveInsets` is the thin async wrapper that
// finds the sibling, prepares it the way render() prepares its own spec, and
// writes the result — or the reason there is none — on the element clone.
// Nothing here throws: a bad reference draws an empty frame and warns.
import { boxAnchor } from "../layout/anchors";
import { unionBoxes } from "../layout/boxes";
import type { InsetError, InsetPicture } from "../layout/inset";
import { elementBBoxes, layoutSpec, type LayoutResult } from "../layout/layout";
import type { MeasureFn } from "../layout/measure";
import type { LayoutOverrides } from "../layout/posed";
import { applyTextStyle, effectiveTextStyle, type TextStyle } from "../layout/text-style";
import { resolveSibling } from "../playlist/inset-ref";
import type { Spec } from "../spec/types";
import { frameDrawables } from "./frame";
import { withMinted } from "./minted";
import { splitVarOverrides, withOverrides } from "./params";
import { planCommands, sceneAt, type PlanOptions } from "./plan";

export type PlanOptsFor = (spec: Spec, layout: LayoutResult) => Partial<PlanOptions>;

/** The source, already prepared (engines, cards, assets, text block), as its held final frame. */
export function pictureOf(source: Spec, measure: MeasureFn, planOpts: PlanOptsFor, prefix: string): Pick<InsetPicture, "drawables" | "ink" | "boxes"> {
  // No pictures of pictures: the source is drawn without its own insets.
  const src: Spec = { ...source, elements: (source.elements ?? []).filter((e) => e.type !== "inset") };
  const style = effectiveTextStyle(src);
  const layoutAt = (params: Record<string, unknown>, overrides?: LayoutOverrides): LayoutResult => {
    const split = splitVarOverrides(params);
    const withVars = Object.keys(split.vars).length > 0 ? { vars: { ...(src.vars ?? {}), ...split.vars } } : {};
    return layoutSpec({ ...src, params: withOverrides(src.params, split.params), ...withVars }, measure, overrides, undefined, { skipDrawBeatLint: true });
  };
  const layout = layoutAt({});
  const boxesOf = (l: LayoutResult) => elementBBoxes(l, measure);
  const bboxes = boxesOf(layout);
  const plan = planCommands(src.commands, layout.order, {
    bboxOf: (id) => bboxes.get(id) ?? null,
    windows: layout.windows ?? {},
    animateBase: src.template ? (src.params ?? {}) : null,
    varsBase: src.vars ?? null,
    bboxesFor: (params, overrides) => {
      const b = boxesOf(layoutAt(params, overrides));
      return (id) => b.get(id) ?? null;
    },
    anchorsAt: (params, overrides) => {
      const l = layoutAt(params, overrides);
      const b = boxesOf(l);
      return (id, name) => l.namedAnchors[id]?.[name] ?? (b.get(id) ? boxAnchor(b.get(id)!, name) : null);
    },
    ...planOpts(src, layout),
  });
  const state = sceneAt(plan, plan.steps.length);
  // The layout as it stood at that frame: the state's params and vars, its
  // formulas, clones and morphed shapes — then the plan's minted elements
  // (trails, ghosts, copies) so the frame can name them.
  const overrides: LayoutOverrides = {
    math: Object.fromEntries(Object.entries(state.tex).map(([id, tex]) => [id, { tex }])),
    copies: state.copies,
    shapes: state.shapes,
  };
  const final = applyTextStyle(withMinted(layoutAt(state.params, overrides), plan.minted, (p, ov) => layoutAt(p, ov)), style);
  const frame = frameDrawables(final, state, prefix, measure);
  return { drawables: frame.drawables, ink: unionBoxes(Object.values(frame.boxes)), boxes: frame.boxes };
}

export interface InsetDeps {
  /** The playlist's item specs in order (authored, not the export sequence). */
  siblings?: readonly Spec[];
  /** This spec's index among them; -1 when it is not one of them. */
  self: number;
  /** What render() does to a spec before laying it out: engines, cards, portraits/images/code, math font, text block. */
  prepare: (spec: Spec) => Promise<Spec>;
  /** The measurer for a text style — the host's own recipe, so the picture is measured as it would be drawn. */
  measureFor: (style: TextStyle) => MeasureFn;
  planOpts: PlanOptsFor;
}

/** Fills `picture` on every inset element of `spec` (the render clone), in place. */
export async function resolveInsets(spec: Spec, deps: InsetDeps): Promise<void> {
  const insets = (spec.elements ?? []).filter((e) => e.type === "inset");
  if (insets.length === 0) return;
  const cache = new Map<number, Promise<Pick<InsetPicture, "drawables" | "ink" | "boxes">>>();
  await Promise.all(
    insets.map(async (el) => {
      const fail = (error: string): void => {
        el.picture = { error } satisfies InsetError;
      };
      if (!deps.siblings || deps.siblings.length === 0) return fail("an inset needs a playlist to take its page from");
      const ref = resolveSibling(String(el.of ?? ""), deps.siblings, deps.self);
      if ("error" in ref) return fail(ref.error);
      const source = deps.siblings[ref.index];
      try {
        // Two insets of the same page share one build — but each needs its
        // own prefix, so the cached drawables are re-prefixed per element.
        let build = cache.get(ref.index);
        if (!build) {
          build = deps.prepare(source).then((prepared) => pictureOf(prepared, deps.measureFor(effectiveTextStyle(prepared)), deps.planOpts, "src"));
          cache.set(ref.index, build);
        }
        const pic = await build;
        el.picture = { ...pic, drawables: reprefix(structuredClone(pic.drawables), "src", el.id), spec: source, index: ref.index };
      } catch (err) {
        fail(`could not draw "${source.title ?? `item ${ref.index + 1}`}": ${(err as Error).message}`);
      }
    }),
  );
}

/**
 * Same job as `resolveInsets` — fills `picture` on every inset element, in
 * place — but synchronous, and built straight off the AUTHORED sibling: no
 * `prepare` (no engines, no assets, no cards — a source whose final frame
 * needs those still lays out as far as layout can without them). A source
 * whose frame needs code output, traced assets or card expansion is laid
 * out here in its unresolved form; the live app draws it resolved. For a
 * node-side caller that already holds every sibling's spec and has no event
 * loop to await across (spec 2026-09-17-inset §9: the examples gate resolves
 * insets so a `point` at a part inside one is exercised, not just the frame).
 */
export function resolveInsetsSync(spec: Spec, siblings: readonly Spec[], self: number, measure: MeasureFn, planOpts: PlanOptsFor): void {
  const insets = (spec.elements ?? []).filter((e) => e.type === "inset");
  if (insets.length === 0) return;
  const cache = new Map<number, Pick<InsetPicture, "drawables" | "ink" | "boxes">>();
  for (const el of insets) {
    const fail = (error: string): void => {
      el.picture = { error } satisfies InsetError;
    };
    if (siblings.length === 0) {
      fail("an inset needs a playlist to take its page from");
      continue;
    }
    const ref = resolveSibling(String(el.of ?? ""), siblings, self);
    if ("error" in ref) {
      fail(ref.error);
      continue;
    }
    const source = siblings[ref.index];
    try {
      // Two insets of the same page share one build — but each needs its
      // own prefix, so the cached drawables are re-prefixed per element.
      let pic = cache.get(ref.index);
      if (!pic) {
        pic = pictureOf(source, measure, planOpts, "src");
        cache.set(ref.index, pic);
      }
      el.picture = { ...pic, drawables: reprefix(structuredClone(pic.drawables), "src", el.id), spec: source, index: ref.index };
    } catch (err) {
      fail(`could not draw "${source.title ?? `item ${ref.index + 1}`}": ${(err as Error).message}`);
    }
  }
}

function reprefix<T extends { id: string; kind: string; children?: T[] }>(ds: T[], from: string, to: string): T[] {
  for (const d of ds) {
    if (d.id.startsWith(`${from}__p`)) d.id = `${to}__p${d.id.slice(from.length + 3)}`;
    if (d.children) reprefix(d.children, from, to);
  }
  return ds;
}
