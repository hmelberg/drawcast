// The guess gate (spec 2026-10-01-guess-and-reveal §5): the viewer sets a
// number ON THE FIGURE — drags a bar's height, draws the rest of a line,
// moves a pie slice's edge, sweeps across a crowd, clicks a scale — and
// presses Answer. The figure is repainted from the guess as it changes (the
// player's paint, handed over in step.guess); the gate owns only the
// pointer, the keys and the pills. The rules (handles, mapping, nudging)
// are guess/handles.ts; this is the DOM.
//
// Keys: Tab picks the next handle, arrows change it (shift: ten steps; on a
// sketched line or a whole pie ←/→ pick the point or divider), Enter answers.
// A tap on the value pill opens a field to type the number.

import type { RenderHandle } from "../render";
import type { GuessSession } from "../render/player";
import { encodeGuess, hitDistance, nearestDivider, nudge, pointFor, valueAt, type GuessHandle } from "../guess/handles";
import { clockFraction } from "../guess/handles";
import { clientPointFor, h, logicalPoint } from "./dom";
import type { AskGateStep } from "./controls";

const HINT: Record<GuessHandle["kind"], string> = {
  height: "Drag the bar to your guess",
  curve: "Draw the rest of the line",
  angle: "Drag the slice's edge",
  count: "Drag across the people",
  point: "Click where you think it is",
};

/** True when ←/→ pick an entry of the handle instead of changing it. */
const multiEntry = (g: GuessHandle): boolean => g.truth.length > 1;

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

      const hintText = handles.length > 1 ? (handles[0].kind === "height" ? "Drag each bar to your guess" : HINT[handles[0].kind]) : HINT[handles[0].kind];
      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, `${hintText} ▸`);
      const pill = h("button", { class: "cs-guess-value", type: "button", title: "Type a number" });
      const answer = h("button", { class: "cs-cardgate-pill cs-guess-answer", type: "button" }, "Answer ▸");
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
        pill.textContent = handles.length > 1 || multiEntry(g) ? `${g.kind === "curve" ? "" : `${g.label} `}${g.format(v)}` : g.format(v);
        // A scale's marker writes its own number: a pill over it says it twice.
        if (c && g.kind !== "point") {
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
        const grab = g.kind === "angle" && g.centre && multiEntry(g) ? nearestDivider(values[k], clockFraction(g.centre, p) * 100) : undefined;
        try {
          gate.setPointerCapture(e.pointerId);
        } catch {
          /* a synthetic pointer has no capture */
        }
        dragging = { k, prev: p, ...(grab !== undefined ? { grab } : {}) };
        focus = k;
        if (grab !== undefined) entry = grab;
        values[k] = valueAt(g, p, values[k], null, grab);
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
        dragging.prev = p;
        repaint();
      });
      const endDrag = (e: PointerEvent): void => {
        e.stopPropagation();
        dragging = null;
        gate.classList.remove("dragging");
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
            }
          }
          field.replaceWith(pill);
          repaint();
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
      stage.appendChild(gate);
      placePill();
    });
}
