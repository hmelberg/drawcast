// The explore tray (interactivity round 1, spec §7 in
// docs/superpowers/specs/2026-08-27-interactivity-principles.md): a ⊕ button
// on the control bar opens the figure's controls under the bar. It shows
// EVERYTHING the figure offers at once — activity pills, sliders, and the
// editor for every script on screen — because the ⊕ means "what can I do
// here?"; an authored explore beat is the narrow case, showing exactly what
// it named. The composition rule itself lives in tray-model's trayPlan.
// Opening snaps to the current step boundary (pausing playback); every drag
// and every Run live-previews through ONE preview state, so a slider and an
// edited script compose; "Continue ▶" restores the exact boundary and resumes.
// Starting playback any other way also settles the preview (the player self-
// settles at run start). Never mounted by video export or <drawcast-figure> —
// they attach no controls — so none of this can appear in a recording.

import type { RenderHandle } from "../render";
import type { SpecElement } from "../spec/types";
import { decodeCodeResult, runCode } from "../code/run";
import { pathsByCodeId, scanDataTokens, substituteDataTokens } from "../code/tokens";
import { INITIAL_STATE } from "../render/plan";
import { readParam, withOverrides } from "../render/params";
import { scenes } from "../scenes/registry";
import { elementBBoxes } from "../layout/layout";
import { makeBrowserMeasure } from "../render/svg-backend";
import { h, logicalPoint } from "./dom";
import { overCaption } from "./caption";
import { gateIsOpen } from "./gates";
import { hitElement } from "./hit";
import type { BBox } from "../layout/geometry";
import { mountKeyGuide } from "./controls";
import { pianoOctaves } from "../render/widgets";
import { sliderSpecs, trayPlan, type SliderSpec } from "./tray-model";
import { panelViewFor } from "./panel-view";
import { activitiesFor } from "./quiz-model";
import { mountQuiz } from "./quiz";
import { mountChessVs } from "./chessvs";

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
  return sliderSpecs(schema, hd.spec.params)
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
  // or a manifest-declared interaction (a piano figure is playable while
  // paused). One declared source (interactivity spec §6), never sniffed.
  const interactions = (hd.spec.template && scenes[hd.spec.template]?.manifest.interactions) || [];
  const playable = interactions.includes("piano");
  // Every script ON SCREEN is editable while paused — no verb required. The
  // screen is an interactive object, so the tray always offers it, and a
  // click on the screen itself opens it (below); explore: { code } is the
  // authored invitation, not what makes it possible.
  const editable = (hd.spec.elements ?? []).filter(
    (e) => e.type === "code" && e.show !== "none" && typeof e.code === "string" && typeof e.language === "string",
  );
  if (liveSliders(hd).length === 0 && interactions.length === 0 && editable.length === 0) return;

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

  // ---- ONE preview state for every control in the tray ----------------------
  // previewParams and previewSpec each repaint from the honest boundary and
  // know nothing of the other, so a tray that holds both a slider and an
  // edited script must remember both and repaint through a single call —
  // otherwise a slider drag after a Run silently discards the viewer's script.
  const overrides: Record<string, number> = {};
  const patches = new Map<string, { code: string; result: string }>();
  const clearPreview = (): void => {
    for (const k of Object.keys(overrides)) delete overrides[k];
    patches.clear();
  };

  /** Paint the boundary with everything the viewer has changed so far. */
  const repaint = (): void => {
    if (patches.size === 0) {
      hd.timeline.previewParams(overrides);
      panelViewFor(stage)?.apply();
      return;
    }
    const elements = (hd.spec.elements ?? []).map((e) => {
      const p = patches.get(e.id);
      return p ? { ...e, code: p.code, code_result: p.result } : e;
    });
    // A template param naming a patched element gets the viewer's numbers:
    // the tokens are re-substituted into the AUTHORED params (the resolved
    // clone holds values, not tokens), then the sliders have the last word.
    let params: Record<string, unknown> = {};
    if (scanDataTokens(hd.authored.params).length > 0) {
      params = substituteDataTokens(hd.authored.params, (codeId, path) => {
        const env = decodeCodeResult(elements.find((e) => e.id === codeId)?.code_result);
        if (!env || !env.ok) return { error: env?.error ?? "the script did not run" };
        if (env.dataErrors && path in env.dataErrors) return { error: env.dataErrors[path] };
        if (env.data && path in env.data) return { value: env.data[path] };
        return { error: "not harvested" };
      }).params;
    }
    hd.timeline.previewSpec({ elements, params: { ...params, ...overrides } });
    panelViewFor(stage)?.apply(); // a repaint must not un-hide what a switch hid
  };

  /**
   * The code editor's Run: the viewer's script goes through the same facade
   * as the author's (same runtime, same cache, same envelope) and its fresh
   * envelope joins the preview state. settleParams() on Continue/close/Play
   * restores the lesson, so nothing persists.
   */
  const runEdited = async (el: SpecElement, code: string, status: HTMLElement, btn: HTMLButtonElement): Promise<void> => {
    if (!el.language) return;
    const paths = pathsByCodeId(scanDataTokens(hd.authored.params))[el.id] ?? [];
    btn.disabled = true;
    status.textContent = "Running…";
    try {
      const result = await runCode({
        language: el.language,
        code,
        paths,
        onStatus: (_phase, detail) => {
          status.textContent = detail;
        },
      });
      patches.set(el.id, { code, result: JSON.stringify(result) });
      repaint();
      status.textContent = result.ok ? "Ran ✓ — Continue restores the lesson" : "The script failed — see the panel";
    } catch (err) {
      status.textContent = `Could not run: ${(err as Error).message}`;
    } finally {
      btn.disabled = false;
    }
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
    clearPreview();
    hd.timeline.renderUpTo(hd.timeline.position);
  };

  const open = (opts: { filter?: string[]; gated?: boolean; code?: string; onCode?: string } = {}): void => {
    // Snap to the boundary first: it aborts any in-flight step and lands
    // paused, so previews never paint over half-drawn strokes. NOT when an
    // explore gate called us — the run is parked on the gate's promise, and
    // renderUpTo would abort it and replay the invitation forever.
    if (!opts.gated) hd.timeline.renderUpTo(hd.timeline.position);
    tray.replaceChildren();
    // What this tray shows: everything the figure offers when the VIEWER
    // opened it, exactly what the beat named when an explore did (the rule
    // lives in tray-model, testable without a DOM).
    const sliders = liveSliders(hd);
    const plan = trayPlan({
      sliderPaths: sliders.map((s) => s.spec.path),
      codeIds: editable.map((e) => e.id),
      gated: opts.gated,
      params: opts.filter,
      code: opts.code,
      open: opts.onCode,
    });
    // The activity pills (spec §13's scheduled convergence): rendered from
    // the same interactions registry the context menu reads — right-click
    // opens this tray, so both doors show one row. Not during an explore
    // gate: a drill would strand the parked run.
    const acts = plan.activities ? activitiesFor(interactions) : [];
    if (acts.length > 0 && stage) {
      const row = h("div", { class: "cs-tray-acts" });
      for (const a of acts) {
        const pill = h("button", { class: "cs-cardgate-pill cs-tray-pill" }, a.label);
        pill.addEventListener("click", () => {
          restore(); // the session runs on the honest boundary
          close();
          if (a.id === "vs_computer") mountChessVs(stage, hd);
          else mountQuiz(stage, hd, a.kind);
        });
        row.appendChild(pill);
      }
      tray.appendChild(row);
    }
    if (playable) {
      tray.appendChild(
        h("div", { class: "cs-tray-hint" }, "\ud83c\udfb9 Playable while paused — click, glide, or use your keyboard: A S D F G H J are the white keys, W E T Y U the black."),
      );
    }
    if (interactions.includes("chess")) {
      tray.appendChild(
        h(
          "div",
          { class: "cs-tray-hint" },
          "♟️ Playable while paused — click a piece, then its target square (whichever side you grab has the move). Continue ▸ restores the lesson's position.",
        ),
      );
    }
    for (const { spec, value } of plan.sliders.map((p) => sliders.find((s) => s.spec.path === p)!)) {
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
        repaint(); // an edited script stays edited while the knob turns
      });
      tray.appendChild(h("label", { class: "cs-tray-row" }, h("span", { class: "cs-tray-label" }, spec.label), range, readout));
    }
    // What the panel SHOWS: the same state the buttons drawn on a machine's
    // chin press, offered here too — the capability belongs to the code panel,
    // and a script on bare paper has no chin to press (Hans, 2026-09-04).
    const view = stage ? panelViewFor(stage) : null;
    if (view && !opts.gated) {
      for (const panelId of view.panels) {
        const row = h("div", { class: "cs-tray-view" });
        row.appendChild(h("span", { class: "cs-tray-label" }, view.panels.length > 1 ? `Show (${panelId})` : "Show"));
        const chips: { kind: "code" | "output" | "power"; label: string }[] = [
          { kind: "code", label: "Code" },
          { kind: "output", label: "Output" },
        ];
        // "Picture" only where there IS a picture to switch off.
        if (view.hasScreen(panelId)) chips.push({ kind: "power", label: "Picture" });
        for (const c of chips) {
          const chip = h("button", { class: "cs-tray-chip" }, c.label);
          const sync = (): void => {
            const st = view.state(panelId);
            const on = c.kind === "code" ? st.code : c.kind === "output" ? st.output : st.on;
            chip.classList.toggle("off", !on);
            chip.setAttribute("aria-pressed", String(on));
          };
          chip.addEventListener("click", () => view.press(panelId, c.kind));
          view.onChange(sync);
          sync();
          row.appendChild(chip);
        }
        tray.appendChild(row);
      }
    }
    // The scripts on screen. Expanded when the editor IS the point (the only
    // control, the beat's own `code`, the screen the viewer clicked); behind
    // a one-line toggle otherwise, so a figure with knobs AND a script still
    // opens to a tray you can see past.
    for (const { id, expanded } of plan.scripts) {
      const el = editable.find((e) => e.id === id);
      if (!el) continue;
      const label = plan.scripts.length > 1 ? `✎ Edit the ${el.language} script (${el.id})` : "✎ Edit the script";
      const toggle = h("button", { class: "cs-tray-toggle" }, label);
      const body = h("div", { class: "cs-tray-scriptbody" });
      body.appendChild(
        h("div", { class: "cs-tray-hint" }, "Change it (or write your own) and press Run — the screen and any chart it feeds update. Continue restores the lesson."),
      );
      const rows = Math.min(12, Math.max(4, (el.code ?? "").split("\n").length + 1));
      const area = h("textarea", { class: "cs-tray-code", rows: String(rows), spellcheck: "false", "aria-label": "Script" }) as HTMLTextAreaElement;
      area.value = patches.get(el.id)?.code ?? el.code ?? "";
      const status = h("span", { class: "cs-tray-status" }, "");
      const runBtn = h("button", { class: "cs-tray-run" }, "Run ▶");
      runBtn.addEventListener("click", () => void runEdited(el, area.value, status, runBtn));
      body.appendChild(area);
      body.appendChild(h("div", { class: "cs-tray-actions" }, runBtn, status));
      body.hidden = !expanded;
      toggle.classList.toggle("open", expanded);
      toggle.addEventListener("click", () => {
        body.hidden = !body.hidden;
        toggle.classList.toggle("open", !body.hidden);
        if (!body.hidden) area.focus();
      });
      tray.appendChild(h("div", { class: "cs-tray-script" }, toggle, body));
    }
    const continueBtn = h("button", { class: "cs-tray-continue" }, "Continue ▶");
    continueBtn.addEventListener("click", () => {
      if (gateResolve) {
        // The run is waiting on the explore gate: settle honest geometry
        // WITHOUT aborting it, then let it continue.
        clearPreview();
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
      clearPreview();
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

  // Right-click v1 (interactivity spec §13): "left-click does, right-click
  // asks what's possible." Inside the stage the native menu never opens;
  // the gesture pauses (open() snaps to the boundary) and opens the scene
  // surface. Element-scoped menus arrive with the info card round.
  stage?.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (tray.hidden) open();
  });

  // The screen is an OBJECT (spec §13): while paused, a click on a code panel
  // does that object's natural action — it opens its editor. The info card
  // stands aside for these ids, so the two never both fire; the first click
  // still only pauses, as it always has.
  if (stage && editable.length > 0) {
    let boxes: Map<string, BBox> | null = null;
    const screenAt = (e: MouseEvent): string | null => {
      if (gateIsOpen(stage)) return null;
      if (overCaption(e.target as Element | null)) return null;
      const p = logicalPoint(stage, e);
      if (!p) return null;
      if (!boxes) {
        const all = elementBBoxes(hd.layout, makeBrowserMeasure());
        boxes = new Map(editable.map((el) => [el.id, all.get(el.id)]).filter((e2): e2 is [string, BBox] => e2[1] !== undefined));
      }
      // Only a panel that is ON SCREEN at this boundary — and a storyboard
      // may have drawn its lines and output without ever naming the element
      // itself, so any of its parts being visible counts as the screen being
      // there.
      const n = hd.timeline.position;
      const visible = n > 0 ? hd.plan.states[n - 1].visible : INITIAL_STATE.visible;
      const shown = new Map([...boxes].filter(([id]) => visible.some((v) => v === id || v.startsWith(`${id}_`))));
      return hitElement(shown, p, 12);
    };
    stage.addEventListener(
      "click",
      (e) => {
        // Playing: the click pauses and opens nothing (§7.3, the sacred
        // gesture). Tray already open: its own freeze guard owns the stage.
        if (hd.timeline.state === "playing" || !tray.hidden) return;
        if (e.target instanceof Element && e.target.closest("button, a")) return;
        const id = screenAt(e);
        if (id === null) return;
        e.stopPropagation();
        open({ onCode: id });
      },
      true,
    );
    // Quiet affordance while paused: the cursor knows the screen takes typing.
    stage.addEventListener("pointermove", (e) => {
      const on = hd.timeline.state !== "playing" && tray.hidden && screenAt(e) !== null;
      stage.classList.toggle("cs-editable", on);
    });
  }

  // The explore verb: the storyboard opens this tray itself and waits for
  // Continue. Abort (a scrub) resolves and tidies up — the gate contract.
  hd.timeline.exploreGate = (signal, step) =>
    new Promise<void>((resolve) => {
      const onAbort = (): void => {
        gateResolve = null;
        clearPreview();
        close();
        resolve();
      };
      signal.addEventListener("abort", onAbort);
      gateResolve = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      open({ filter: step.params, gated: true, code: step.code });
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
      clearPreview();
      close();
    }
  };
}
