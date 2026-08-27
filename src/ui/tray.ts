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
  return sliderSpecs(schema)
    .map((spec) => ({ spec, value: readParam(effective, spec.path) }))
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
  };

  /** Back to the honest boundary; previewParams marked geometry dirty, so
   *  this commits even though the boundary's params compare equal. */
  const restore = (): void => {
    clearOverrides();
    hd.timeline.renderUpTo(hd.timeline.position);
  };

  const open = (): void => {
    // Snap to the boundary first: it aborts any in-flight step and lands
    // paused, so previews never paint over half-drawn strokes.
    hd.timeline.renderUpTo(hd.timeline.position);
    tray.replaceChildren();
    if (playable) {
      tray.appendChild(
        h("div", { class: "cs-tray-hint" }, "\ud83c\udfb9 The keyboard is playable while paused — click a key, glide across them, or type the letters."),
      );
    }
    for (const { spec, value } of liveSliders(hd)) {
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
      restore();
      close();
      void hd.timeline.play();
    });
    tray.appendChild(h("div", { class: "cs-tray-actions" }, continueBtn));
    tray.hidden = false;
    trayBtn.classList.add("open");
    stage?.classList.add("cs-exploring");
    stage?.addEventListener("click", freezeClick, true);
  };

  trayBtn.addEventListener("click", () => {
    if (tray.hidden) open();
    else {
      restore(); // toggle-close: honest state, stay paused
      close();
    }
  });
  bar.appendChild(trayBtn);

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
