// The guess gate (spec 2026-10-01-guess-and-reveal §5): the viewer sets a
// number ON THE FIGURE — drags a bar's height, draws the rest of a line,
// moves a pie slice's edge, sweeps across a crowd, clicks a scale — and
// presses Answer. The figure is repainted from the guess as it changes (the
// player's paint, handed over in step.guess); the gate owns only the
// pointer, the keys and the pills. The rules (handles, mapping, nudging)
// are guess/handles.ts; this is the DOM.
//
// One part (a bar, a line, a slice, a crowd, a scale): letting go of the
// drag IS the answer, unless the ask says release: false. Several parts (on:
// all, a whole pie) are set one by one and answered with the Answer button,
// which stands centred at the bottom of the figure, over the caption.
//
// Keys: Tab picks the next handle, arrows change it (shift: ten steps; on a
// sketched line or a whole pie ←/→ pick the point or divider; on a market
// curve the arrows move it and Shift+arrows turn it), Enter answers.
// A tap on the value pill opens a field to type the number.

import type { RenderHandle } from "../render";
import type { GuessSession } from "../render/player";
import { encodeGuess, hitDistance, marketGrab, nearestDivider, nudge, pointFor, valueAt, withBudget, type GuessHandle } from "../guess/handles";
import { clockFraction } from "../guess/handles";
import { clientPointFor, h, logicalPoint } from "./dom";
import type { AskGateStep } from "./controls";

const HINT: Record<GuessHandle["kind"], string> = {
  height: "Drag the bar to your guess",
  curve: "Draw the rest of the line",
  angle: "Drag the slice's edge",
  count: "Drag across the people",
  point: "Click where you think it is",
  market: "Drag the middle to move it, an end to turn it",
};

/** True when ←/→ pick an entry of the handle instead of changing it. A
 *  market curve's two gaps are one gesture: its arrows move and turn it. */
const multiEntry = (g: GuessHandle): boolean => g.truth.length > 1 && g.kind !== "market";

export function guessGateFor(stage: HTMLElement, _hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      const session = step.guess as GuessSession | undefined;
      if (!session || session.setup.handles.length === 0) {
        resolve(null);
        return;
      }
      stage.querySelector(".cs-figgate")?.remove();
      const handles = session.setup.handles;
      const values: number[][] = session.start.map((r) => r.slice());
      let focus = 0;
      let entry = 0;
      let settled = false;
      // Letting go answers: one part, worked in one gesture.
      // A budget (spec 2026-10-02 §7): bars that always add up to it.
      const budget = typeof step.budget === "number" && handles.length > 1 && handles.every((x) => x.truth.length === 1) ? step.budget : null;
      const total = h("span", { class: "cs-waitgate-pill cs-guess-total" });
      const showTotal = (): void => {
        if (budget === null) return;
        const sum = values.reduce((a, r) => a + r[0], 0);
        total.textContent = `Total ${handles[0].format(sum)} of ${handles[0].format(budget)}`;
      };
      /** After handle k changed: the others make room within the budget. */
      const constrain = (k: number): void => {
        if (budget === null) return;
        const next = withBudget(values, k, budget);
        next.forEach((row, i) => (values[i] = row));
        showTotal();
      };
      // A market curve is moved AND turned (spec 2026-10-03 §3.2): one gesture
      // is rarely the whole answer, so it waits for Answer unless release: true.
      const onRelease =
        handles[0].kind === "market"
          ? step.release === true && handles.length === 1
          : step.release !== false && handles.length === 1 && !(handles[0].kind === "angle" && handles[0].truth.length > 1);
      /** A beat between letting go and the reveal: the guess is seen standing. */
      const RELEASE_MS = 180;

      const hintText =
        handles.length > 1 && handles[0].kind === "height"
          ? "Drag each bar to your guess"
          : handles[0].kind === "angle" && multiEntry(handles[0])
            ? "Drag the edges between the slices"
            : HINT[handles[0].kind];
      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, onRelease ? (handles[0].kind === "point" ? hintText : `${hintText} — let go to answer`) : `${hintText}, then Answer`);
      const pill = h("button", { class: "cs-guess-value", type: "button", title: "Type a number" });
      const answer = h("button", { class: "cs-cardgate-pill cs-guess-answer", type: "button" }, "Answer ▸");
      answer.hidden = onRelease;
      const gate = h("div", { class: "cs-figgate cs-guessgate" }, hint, pill, answer);

      // —— painting: one frame at most per animation frame ——
      let pending = false;
      const repaint = (): void => {
        if (pending) return;
        pending = true;
        const run = (): void => {
          pending = false;
          if (settled) return;
          session.paint(values);
          placePill();
        };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
        else run();
      };
      const placePill = (): void => {
        const g = handles[focus];
        const p = pointFor(g, values[focus], entry);
        const c = p ? clientPointFor(stage, p) : null;
        const v = values[focus][multiEntry(g) ? entry : 0];
        const name = g.entryLabels?.[entry] ?? (g.kind === "curve" ? "" : g.label);
        pill.textContent = handles.length > 1 || multiEntry(g) ? `${name ? `${name} ` : ""}${g.format(v)}` : g.format(v);
        // A scale's marker writes its own number: a pill over it says it twice.
        // A market curve has no one number to type: its copy is the answer.
        if (c && g.kind !== "point" && g.kind !== "market") {
          pill.style.left = `${c[0]}px`;
          pill.style.top = `${c[1]}px`;
          pill.hidden = false;
        } else pill.hidden = true;
      };

      const finish = (result: string | null): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        document.removeEventListener("keydown", onKey, true);
        gate.remove();
        resolve(result);
      };
      const onAbort = (): void => finish(null);

      // —— pointer ——
      let dragging: { k: number; prev: [number, number]; grab?: number } | null = null;
      const pick = (p: [number, number]): number | null => {
        let best: number | null = null;
        let bestD = Infinity;
        handles.forEach((g, k) => {
          const d = hitDistance(g, p, values[k]);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        });
        // One handle: a press anywhere on the figure works it.
        if (best === null && handles.length === 1) best = 0;
        return best;
      };
      gate.addEventListener("pointerdown", (e) => {
        if (settled || (e.target as Element).closest("button, input")) return;
        e.preventDefault();
        e.stopPropagation();
        const p = logicalPoint(stage, e);
        if (!p) return;
        const k = pick(p);
        if (k === null) return;
        const g = handles[k];
        const grab =
          g.kind === "angle" && g.centre && multiEntry(g)
            ? nearestDivider(values[k], clockFraction(g.centre, p) * 100)
            : g.kind === "market"
              ? marketGrab(g, values[k], p)
              : undefined;
        try {
          gate.setPointerCapture(e.pointerId);
        } catch {
          /* a synthetic pointer has no capture */
        }
        dragging = { k, prev: p, ...(grab !== undefined ? { grab } : {}) };
        focus = k;
        if (grab !== undefined && g.kind !== "market") entry = grab;
        values[k] = valueAt(g, p, values[k], null, grab);
        constrain(k);
        gate.classList.add("dragging");
        repaint();
      });
      gate.addEventListener("pointermove", (e) => {
        e.stopPropagation();
        if (!dragging || settled) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        const g = handles[dragging.k];
        values[dragging.k] = valueAt(g, p, values[dragging.k], dragging.prev, dragging.grab);
        constrain(dragging.k);
        dragging.prev = p;
        repaint();
      });
      const endDrag = (e: PointerEvent): void => {
        e.stopPropagation();
        const was = dragging;
        dragging = null;
        gate.classList.remove("dragging");
        if (was && onRelease && e.type === "pointerup") {
          gate.classList.add("answered");
          window.setTimeout(() => finish(encodeGuess(values)), RELEASE_MS);
        }
      };
      gate.addEventListener("pointerup", endDrag);
      gate.addEventListener("pointercancel", endDrag);
      // A click on the overlay must never reach the stage's play/pause toggle.
      gate.addEventListener("click", (e) => e.stopPropagation());

      // —— keys ——
      const onKey = (e: KeyboardEvent): void => {
        if (settled || (e.target as Element | null)?.closest?.("input")) return;
        const g = handles[focus];
        if (e.key === "Tab") {
          if (handles.length < 2) return;
          e.preventDefault();
          focus = (focus + (e.shiftKey ? handles.length - 1 : 1)) % handles.length;
          entry = 0;
          placePill();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          finish(encodeGuess(values));
          return;
        }
        const up = e.key === "ArrowUp" || (e.key === "ArrowRight" && !multiEntry(g));
        const down = e.key === "ArrowDown" || (e.key === "ArrowLeft" && !multiEntry(g));
        if (multiEntry(g) && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          const last = g.kind === "angle" ? g.truth.length - 2 : g.truth.length - 1;
          entry = Math.max(0, Math.min(last, entry + (e.key === "ArrowRight" ? 1 : -1)));
          placePill();
          return;
        }
        if (!up && !down) return;
        e.preventDefault();
        e.stopPropagation();
        values[focus] = nudge(g, values[focus], multiEntry(g) ? entry : 0, up ? 1 : -1, e.shiftKey);
        constrain(focus);
        repaint();
      };

      // —— typing a number ——
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        const g = handles[focus];
        if (g.kind === "angle" && multiEntry(g)) return;
        const field = h("input", { class: "cs-guess-field", type: "text", inputmode: "decimal", "aria-label": `Your guess for ${g.label}` }) as HTMLInputElement;
        const j = multiEntry(g) ? entry : 0;
        field.value = String(values[focus][j]);
        pill.replaceWith(field);
        field.style.left = pill.style.left;
        field.style.top = pill.style.top;
        field.focus();
        field.select();
        const close = (commit: boolean): void => {
          if (commit) {
            const n = Number(field.value.replace(/[\s %]/g, "").replace(",", "."));
            if (Number.isFinite(n)) {
              const row = values[focus].slice();
              row[j] = Math.max(g.min, Math.min(g.max, n));
              values[focus] = row;
              constrain(focus);
            }
          }
          field.replaceWith(pill);
          repaint();
          // A typed number is as final as letting go.
          if (commit && onRelease) window.setTimeout(() => finish(encodeGuess(values)), RELEASE_MS);
        };
        field.addEventListener("keydown", (ev) => {
          ev.stopPropagation();
          if (ev.key === "Enter") close(true);
          else if (ev.key === "Escape") close(false);
        });
        field.addEventListener("blur", () => field.isConnected && close(true));
        field.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      });

      answer.addEventListener("click", (e) => {
        e.stopPropagation();
        finish(encodeGuess(values));
      });
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", type: "button" }, "Skip ▸");
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          finish(null);
        });
        gate.appendChild(skip);
      }
      signal.addEventListener("abort", onAbort);
      document.addEventListener("keydown", onKey, true);
      if (budget !== null) {
        gate.appendChild(total);
        showTotal();
      }
      stage.appendChild(gate);
      placePill();
    });
}
