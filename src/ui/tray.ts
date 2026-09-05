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
//
// A script has TWO doors and the viewer picks: the text area in this tray, and
// the card ui/code-editor lays down ON the code pane (a paused click on the
// screen). They are one editor — one draft string, one Run through the preview
// state below, one Continue — so neither can hold a script the other does not
// know about (2026-09-05; the tray was Ruling A of the M3 ledger, the card was
// what spec §7 asked for first).

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
import { askPaths, checkedAnswer } from "../code/ask-check";
import { mountCodeEditor, type CodeAsk, type CodeEditorHandle, type EditorSurface } from "./code-editor";
import { attachCodeTyping, type CodeTyping } from "./code-typing";
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
    if (e.target instanceof Element && (e.target.closest("button") || e.target.closest(".cs-codeedit"))) return;
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
  // ONE draft per script, and every surface showing that script is told when
  // it changes — so typing in the tray and finishing on the screen (or the
  // reverse) is one continuous edit, and a Run started at either door reports
  // its progress at both. Dropped with the preview: Continue restores the
  // lesson, so the next opening starts from the author's script again.
  const drafts = new Map<string, string>();
  const surfaces = new Set<EditorSurface & { id: string }>();
  /** The subset the tray itself mounted — dropped whenever it rebuilds. */
  const trayOwned = new Set<EditorSurface & { id: string }>();
  /** Tab/Enter/suggest wiring for the tray's own text areas, same. */
  let trayTyping: CodeTyping[] = [];
  const clearPreview = (): void => {
    for (const k of Object.keys(overrides)) delete overrides[k];
    patches.clear();
    drafts.clear();
  };
  const draftOf = (el: SpecElement): string => drafts.get(el.id) ?? patches.get(el.id)?.code ?? el.code ?? "";
  const announce = (id: string, fn: (s: EditorSurface) => void): void => {
    for (const s of surfaces) if (s.id === id) fn(s);
  };
  const setDraft = (id: string, text: string): void => {
    drafts.set(id, text);
    announce(id, (s) => s.setValue(text));
  };

  /** Paint the boundary with everything the viewer has changed so far — the
   *  sliders, an edited script, and whatever the panel's switches turned off.
   *  ONE call, because the reprojector rebuilds geometry without minting new
   *  element handles, so a second pass would be talking to stale nodes. */
  const repaint = (): void => {
    const view = panelViewFor(stage);
    if (patches.size === 0 && (!view || view.idle())) {
      hd.timeline.previewParams(overrides);
      return;
    }
    let elements = (hd.spec.elements ?? []).map((e) => {
      const p = patches.get(e.id);
      return p ? { ...e, code: p.code, code_result: p.result } : e;
    });
    if (view) elements = view.patch(elements);
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
    hd.timeline.previewSpec({ elements, params: { ...params, ...overrides }, hide: view?.hidden() });
    view?.apply(); // the veil follows the glass, which may have moved
    reflow(); // …and so does the card lying on the pane
  };

  /**
   * The code editor's Run: the viewer's script goes through the same facade
   * as the author's (same runtime, same cache, same envelope) and its fresh
   * envelope joins the preview state. settleParams() on Continue/close/Play
   * restores the lesson, so nothing persists.
   */
  const runEdited = async (el: SpecElement, code: string): Promise<void> => {
    if (!el.language) return;
    const paths = pathsByCodeId(scanDataTokens(hd.authored.params))[el.id] ?? [];
    setDraft(el.id, code);
    announce(el.id, (s) => {
      s.busy(true);
      s.status("Running…");
    });
    try {
      const result = await runCode({
        language: el.language,
        code,
        chart: el.chart,
        paths,
        onStatus: (_phase, detail) => announce(el.id, (s) => s.status(detail)),
      });
      patches.set(el.id, { code, result: JSON.stringify(result) });
      repaint();
      const msg = result.ok ? "Ran ✓ — Continue restores the lesson" : "The script failed — see the panel";
      announce(el.id, (s) => s.status(msg));
    } catch (err) {
      const msg = `Could not run: ${(err as Error).message}`;
      announce(el.id, (s) => s.status(msg));
    } finally {
      announce(el.id, (s) => s.busy(false));
    }
  };

  const trayBtn = h("button", { class: "cs-bar-btn cs-tray-btn", title: "Explore this figure" }, "⊕");

  // The cards lying on the panels, by element id. The tray and the cards each
  // freeze the stage while they are up, so the guard comes off only when the
  // LAST of them goes away.
  const editors = new Map<string, CodeEditorHandle>();
  const freezeStage = (): void => {
    stage?.classList.add("cs-exploring");
    stage?.addEventListener("click", freezeClick, true);
  };
  const thawStage = (): void => {
    if (!tray.hidden || editors.size > 0) return;
    stage?.classList.remove("cs-exploring");
    stage?.removeEventListener("click", freezeClick, true);
  };
  const closeEditors = (): void => {
    for (const ed of [...editors.values()]) ed.close(); // its onClose empties the map
    editors.clear();
  };
  /** A Run or a switch re-lays the panel out under the card — twice, because
   *  the second pass catches a layout the browser had not finished painting. */
  const reflow = (): void => {
    if (editors.size === 0) return;
    for (const ed of editors.values()) ed.reposition();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        for (const ed of editors.values()) ed.reposition();
      });
    }
  };

  const close = (): void => {
    tray.hidden = true;
    trayBtn.classList.remove("open");
    thawStage();
    unguide?.();
    unguide = null;
  };

  /** Back to the honest boundary; previewParams marked geometry dirty, so
   *  this commits even though the boundary's params compare equal. */
  const restore = (): void => {
    closeEditors(); // the cards showed a draft this call is throwing away
    clearPreview();
    panelViewFor(stage)?.reset();
    hd.timeline.renderUpTo(hd.timeline.position);
  };

  /** Continue ▶ — the same action from the tray's button and from a card's:
   *  settle the honest geometry, let a parked explore run on, or play. */
  const continueNow = (): void => {
    closeEditors();
    if (gateResolve) {
      // The run is waiting on the explore gate: settle honest geometry
      // WITHOUT aborting it, then let it continue.
      clearPreview();
      panelViewFor(stage)?.reset();
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
  };

  /** The pane the lines are drawn in RIGHT NOW (a switch or a Run may have
   *  re-laid it out), and whether the panel is on screen at this boundary. */
  const paneBoxOf = (id: string): BBox | null => (hd.timeline.paintedLayout() ?? hd.layout).panes?.[id] ?? null;
  const visibleNow = (id: string): boolean => {
    const n = hd.timeline.position;
    const visible = n > 0 ? hd.plan.states[n - 1].visible : INITIAL_STATE.visible;
    return visible.some((v) => v === id || v.startsWith(`${id}_`));
  };

  /**
   * Open the editor where the script IS. False when this panel has no pane to
   * lie on — `show: "output"`, the code half switched off, or the panel not
   * drawn yet — and then the caller falls back to the tray's text area, which
   * needs no geometry at all.
   */
  const openInPlace = (el: SpecElement, ask?: CodeAsk): boolean => {
    if (!stage || !visibleNow(el.id)) return false;
    const open2 = editors.get(el.id);
    if (open2) {
      open2.reposition();
      return true;
    }
    // Snap to the boundary exactly as the tray does — but only when nothing is
    // previewing yet, or this would throw away the slider drag or the edited
    // script the viewer already has on screen.
    // …never while a question holds the run: the gate is parked on a promise
    // and renderUpTo would abort it, exactly as it would an explore.
    if (!ask && tray.hidden && editors.size === 0 && !gateResolve) hd.timeline.renderUpTo(hd.timeline.position);
    const handle = mountCodeEditor(stage, {
      id: el.id,
      language: el.language ?? "",
      fontSize: el.font_size ?? 17,
      paneBox: () => paneBoxOf(el.id),
      value: () => draftOf(el),
      onInput: (text) => setDraft(el.id, text),
      onRun: (text) => void runEdited(el, text),
      onContinue: continueNow,
      onClose: () => {
        editors.delete(el.id);
        thawStage();
      },
      register: (surface) => {
        const entry = { id: el.id, ...surface };
        surfaces.add(entry);
        return () => surfaces.delete(entry);
      },
      ...(ask ? { ask } : {}),
    });
    if (!handle) return false;
    editors.set(el.id, handle);
    freezeStage();
    return true;
  };

  const open = (opts: { filter?: string[]; gated?: boolean; code?: string; onCode?: string } = {}): void => {
    // Snap to the boundary first: it aborts any in-flight step and lands
    // paused, so previews never paint over half-drawn strokes. NOT when an
    // explore gate called us — the run is parked on the gate's promise, and
    // renderUpTo would abort it and replay the invitation forever.
    if (!opts.gated && editors.size === 0) hd.timeline.renderUpTo(hd.timeline.position);
    // replaceChildren throws away the tray's text areas: their surfaces go too,
    // or a Run would post its status into detached nodes.
    for (const s of [...surfaces]) if (trayOwned.has(s)) surfaces.delete(s);
    trayOwned.clear();
    for (const t of trayTyping) t.detach();
    trayTyping = [];
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
        h(
          "div",
          { class: "cs-tray-hint" },
          "Change it (or write your own) and press Run — the screen and any chart it feeds update. Continue restores the lesson. Prefer to type on the panel itself? Click the screen, or ✎ On the screen.",
        ),
      );
      const rows = Math.min(12, Math.max(4, (el.code ?? "").split("\n").length + 1));
      const area = h("textarea", {
        class: "cs-tray-code",
        rows: String(rows),
        spellcheck: "false",
        "aria-label": "Script",
        title: "Tab indents · Shift-Tab outdents · Ctrl-Space suggests",
      }) as HTMLTextAreaElement;
      area.value = draftOf(el);
      area.addEventListener("input", () => setDraft(el.id, area.value));
      trayTyping.push(attachCodeTyping(area, { language: el.language ?? "" }));
      const status = h("span", { class: "cs-tray-status" }, "");
      const runBtn = h("button", { class: "cs-tray-run" }, "Run ▶");
      runBtn.addEventListener("click", () => void runEdited(el, area.value));
      // The same edit, on the panel itself. Offered only when there is a pane
      // on screen to lie on; the two areas share one draft, so moving between
      // them keeps whatever the viewer has typed.
      const onScreen = h("button", { class: "cs-tray-onscreen", title: "Type on the panel itself" }, "✎ On the screen");
      onScreen.disabled = paneBoxOf(el.id) === null || !visibleNow(el.id);
      onScreen.addEventListener("click", () => {
        if (!openInPlace(el)) onScreen.disabled = true;
      });
      body.appendChild(area);
      body.appendChild(h("div", { class: "cs-tray-actions" }, runBtn, onScreen, status));
      const surface = {
        id: el.id,
        setValue: (text: string) => {
          if (document.activeElement !== area) area.value = text;
        },
        status: (text: string) => {
          status.textContent = text;
        },
        busy: (on: boolean) => {
          runBtn.disabled = on;
        },
      };
      surfaces.add(surface);
      trayOwned.add(surface);
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
    continueBtn.addEventListener("click", continueNow);
    tray.appendChild(h("div", { class: "cs-tray-actions" }, continueBtn));
    tray.hidden = false;
    trayBtn.classList.add("open");
    freezeStage();
    if (playable && stage) unguide = mountKeyGuide(stage, pianoOctaves(hd.spec.params));
  };

  trayBtn.addEventListener("click", () => {
    if (tray.hidden) open();
    else if (gateResolve) continueNow(); // closing during an explore gate means "continue"
    else {
      restore(); // toggle-close: honest state, stay paused
      close();
    }
  });
  bar.appendChild(trayBtn);
  // One composition point: a switch press repaints through the tray, so an
  // edited script and a dragged slider survive it (and it survives them).
  if (stage) panelViewFor(stage)?.setComposer(repaint);

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
        // The object's natural action, ON the object. Only a panel that draws
        // no code (or one whose code half is switched off) sends the viewer to
        // the tray's copy instead.
        const el = editable.find((x) => x.id === id);
        if (el && openInPlace(el)) return;
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
        closeEditors();
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

  /**
   * The ask verb's code widget: the panel's own editor IS the answer box. The
   * viewer writes, runs (and SEES their output on the panel, because a Run
   * previews exactly as it does when exploring), then presses Check — and what
   * `expect` reads out of that run is handed to the ask machinery as the
   * answer string. Everything after that is the machinery's: right/wrong
   * lines, retry, reveal, store, gotos.
   *
   * A run that cannot answer yet — a script that failed, a variable it never
   * created, nothing printed — is NOT a wrong answer. The card says so and
   * stays open rather than spending an attempt on a typo.
   */
  hd.timeline.codeGate = (signal, step) =>
    new Promise<string | null>((resolve) => {
      const el = step.codeId !== undefined ? editable.find((e) => e.id === step.codeId) : undefined;
      if (!el || !stage) return resolve(null); // the lint warns about this at authoring time
      let done = false;
      const finish = (value: string | null): void => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", onAbort);
        closeEditors();
        // The viewer's script was a preview, like every other thing they can
        // change: settle the lesson's own geometry before the run goes on.
        // Their TEXT survives, though — a retry that handed back the author's
        // stub would make them type the whole answer again for one wrong
        // character (found in the live smoke).
        const written = drafts.get(el.id);
        clearPreview();
        if (written !== undefined) drafts.set(el.id, written);
        panelViewFor(stage)?.reset();
        hd.timeline.settleParams();
        resolve(value);
      };
      function onAbort(): void {
        finish(null);
      }
      signal.addEventListener("abort", onAbort);
      const check = async (code: string): Promise<void> => {
        if (!el.language) return;
        setDraft(el.id, code);
        announce(el.id, (s) => {
          s.busy(true);
          s.status("Running…");
        });
        try {
          const result = await runCode({
            language: el.language,
            code,
            chart: el.chart,
            paths: askPaths(step.expect),
            onStatus: (_phase, detail) => announce(el.id, (s) => s.status(detail)),
          });
          patches.set(el.id, { code, result: JSON.stringify(result) });
          repaint(); // they see their own output before it is judged
          const verdict = checkedAnswer(result, step.expect);
          if (verdict.text === null) {
            const note = verdict.note ?? "";
            announce(el.id, (s) => s.status(note));
            return;
          }
          finish(verdict.text);
        } catch (err) {
          const msg = `Could not run: ${(err as Error).message}`;
          announce(el.id, (s) => s.status(msg));
        } finally {
          announce(el.id, (s) => s.busy(false));
        }
      };
      const opened = openInPlace(el, {
        onCheck: (code) => void check(code),
        onSkip: step.required ? null : () => finish(null),
      });
      if (!opened) finish(null);
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
    if (s === "playing" && (!tray.hidden || editors.size > 0)) {
      closeEditors();
      clearPreview();
      panelViewFor(stage)?.reset();
      close();
    }
  };
}
