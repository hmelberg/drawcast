// The explore tray (interactivity round 1, spec §7 in
// docs/superpowers/specs/2026-08-27-interactivity-principles.md): a ⊕ button
// on the control bar opens a strip of sliders under the bar. Opening snaps to
// the current step boundary (pausing playback); every drag live-previews via
// Player.previewParams; "Continue ▶" restores the exact boundary and resumes.
// Starting playback any other way also settles the preview (the player self-
// settles at run start). Never mounted by video export or <drawcast-figure> —
// they attach no controls — so none of this can appear in a recording.

import type { RenderHandle } from "../render";
import { INITIAL_STATE } from "../render/plan";
import { readParam, withOverrides } from "../render/params";
import { scenes } from "../scenes/registry";
import { h } from "./dom";
import { mountKeyGuide } from "./controls";
import { pianoOctaves } from "../render/widgets";
import { sliderSpecs, type SliderSpec } from "./tray-model";

/** Sliders whose param has a current numeric value in the mounted spec —
 *  a slider for a param the spec never set would move invisible geometry. */
function liveSliders(hd: RenderHandle): { spec: SliderSpec; value: number }[] {
  const tpl = hd.spec.template;
  if (!tpl) return [];
  const schema = scenes[tpl]?.manifest.params_schema;
  if (!schema) return [];
  const n = hd.timeline.position;
  const boundary = n > 0 ? hd.plan.states[n - 1] : INITIAL_STATE;
  const effective = withOverrides(hd.spec.params, boundary.params);
  // The viewer's own committed numbers (a {var} animate) win over the plan's
  // fallbacks — exploration continues from where THEY left the figure.
  const runtime = hd.timeline.getParamOverrides();
  return sliderSpecs(schema)
    .map((spec) => ({ spec, value: runtime[spec.path] ?? readParam(effective, spec.path) }))
    .filter((s): s is { spec: SliderSpec; value: number } => s.value !== null);
}

function fmt(x: number): string {
  return Math.abs(x) >= 10 ? String(Math.round(x)) : String(Math.round(x * 100) / 100);
}

export function attachParamsTray(host: HTMLElement, hd: RenderHandle): void {
  host.querySelector(".cs-paramtray")?.remove();
  host.querySelector(".cs-tray-btn")?.remove();
  const bar = host.querySelector<HTMLElement>(".cs-controlbar");
  if (!bar) return; // no control bar (author preview, embeds): no tray
  // The ⊕ signals ANY intrinsic capability of the scene — explore-sliders,
  // or an instrument (a piano figure is playable while paused).
  const playable = hd.spec.template === "piano_keys";
  if (liveSliders(hd).length === 0 && !playable) return;

  const tray = h("div", { class: "cs-paramtray", hidden: "" });
  tray.addEventListener("click", (e) => e.stopPropagation());
  bar.insertAdjacentElement("afterend", tray);

  // While exploring, the stage is a workbench, not a play button: the big
  // centered ▶ would sit over the very figure being explored, and a stray
  // click must not resume. The tray's own Continue ▶ (and the bar's ▶)
  // are the ways back.
  const stage = host.querySelector<HTMLElement>(".cs-stage");
  const freezeClick = (e: Event): void => {
    if (e.target instanceof Element && e.target.closest("button")) return;
    e.stopPropagation();
  };
  let unguide: (() => void) | null = null;
  /** Set while an explore command holds the run — Continue resolves it. */
  let gateResolve: (() => void) | null = null;

  const overrides: Record<string, number> = {};
  const clearOverrides = (): void => {
    for (const k of Object.keys(overrides)) delete overrides[k];
  };

  const trayBtn = h("button", { class: "cs-bar-btn cs-tray-btn", title: "Explore this figure" }, "⊕");

  const close = (): void => {
    tray.hidden = true;
    trayBtn.classList.remove("open");
    stage?.classList.remove("cs-exploring");
    stage?.removeEventListener("click", freezeClick, true);
    unguide?.();
    unguide = null;
  };

  /** Back to the honest boundary; previewParams marked geometry dirty, so
   *  this commits even though the boundary's params compare equal. */
  const restore = (): void => {
    clearOverrides();
    hd.timeline.renderUpTo(hd.timeline.position);
  };

  const open = (opts: { filter?: string[]; gated?: boolean } = {}): void => {
    // Snap to the boundary first: it aborts any in-flight step and lands
    // paused, so previews never paint over half-drawn strokes. NOT when an
    // explore gate called us — the run is parked on the gate's promise, and
    // renderUpTo would abort it and replay the invitation forever.
    if (!opts.gated) hd.timeline.renderUpTo(hd.timeline.position);
    tray.replaceChildren();
    if (playable) {
      tray.appendChild(
        h("div", { class: "cs-tray-hint" }, "\ud83c\udfb9 Playable while paused — click, glide, or use your keyboard: A S D F G H J are the white keys, W E T Y U the black."),
      );
    }
    for (const { spec, value } of liveSliders(hd).filter((s) => !opts.filter || opts.filter.includes(s.spec.path))) {
      const range = h("input", {
        type: "range",
        min: String(spec.min),
        max: String(spec.max),
        step: spec.step === "any" ? "any" : String(spec.step),
        value: String(value),
        "aria-label": spec.label,
      }) as HTMLInputElement;
      const readout = h("span", { class: "cs-tray-value" }, fmt(value));
      range.addEventListener("input", () => {
        overrides[spec.path] = Number(range.value);
        readout.textContent = fmt(Number(range.value));
        hd.timeline.previewParams(overrides);
      });
      tray.appendChild(h("label", { class: "cs-tray-row" }, h("span", { class: "cs-tray-label" }, spec.label), range, readout));
    }
    const continueBtn = h("button", { class: "cs-tray-continue" }, "Continue ▶");
    continueBtn.addEventListener("click", () => {
      if (gateResolve) {
        // The run is waiting on the explore gate: settle honest geometry
        // WITHOUT aborting it, then let it continue.
        clearOverrides();
        hd.timeline.settleParams();
        close();
        const r = gateResolve;
        gateResolve = null;
        r();
      } else {
        restore();
        close();
        void hd.timeline.play();
      }
    });
    tray.appendChild(h("div", { class: "cs-tray-actions" }, continueBtn));
    tray.hidden = false;
    trayBtn.classList.add("open");
    stage?.classList.add("cs-exploring");
    stage?.addEventListener("click", freezeClick, true);
    if (playable && stage) unguide = mountKeyGuide(stage, pianoOctaves(hd.spec.params));
  };

  trayBtn.addEventListener("click", () => {
    if (tray.hidden) open();
    else if (gateResolve) {
      // Closing during an explore gate means "continue".
      clearOverrides();
      hd.timeline.settleParams();
      close();
      const r = gateResolve;
      gateResolve = null;
      r();
    } else {
      restore(); // toggle-close: honest state, stay paused
      close();
    }
  });
  bar.appendChild(trayBtn);

  // The explore verb: the storyboard opens this tray itself and waits for
  // Continue. Abort (a scrub) resolves and tidies up — the gate contract.
  hd.timeline.exploreGate = (signal, step) =>
    new Promise<void>((resolve) => {
      const onAbort = (): void => {
        gateResolve = null;
        clearOverrides();
        close();
        resolve();
      };
      signal.addEventListener("abort", onAbort);
      gateResolve = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      open({ filter: step.params, gated: true });
    });

  // Ambient nudge: a personalized animate just played — the ⊕ can take it
  // further. Pulse briefly.
  let pulseTimer = 0;
  const prevOnStep = hd.timeline.callbacks.onStep;
  hd.timeline.callbacks.onStep = (completed, total) => {
    prevOnStep?.(completed, total);
    const s = hd.plan.steps[completed - 1];
    if (s?.kind === "animate" && s.varTargets) {
      trayBtn.classList.add("pulse");
      window.clearTimeout(pulseTimer);
      pulseTimer = window.setTimeout(() => trayBtn.classList.remove("pulse"), 4000);
    }
  };

  // Play from anywhere else (big play, stage click) closes the tray; the
  // player settles the preview itself at run start, so no restore here.
  // Chain, never replace, the existing onState (controls hangs its idle
  // logic here and the session may hang auto-advance).
  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing" && !tray.hidden) {
      clearOverrides();
      close();
    }
  };
}
