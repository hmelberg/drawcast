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
// which stands in the answer dock at the bottom (ui/gate-dock.ts) with the
// hint and Skip — never on the title or the question.
//
// Keys: Tab picks the next handle, arrows change it (shift: ten steps; on a
// sketched line or a whole pie ←/→ pick the point or divider; on a market
// curve the arrows move it and Shift+arrows turn it), Enter answers.
// A tap on the value pill opens a field to type the number.

import type { RenderHandle } from "../render";
import type { GuessSession } from "../render/player";
import { accountOf, budgetBalanced, budgetReachable, encodeGuess, marketAnchor, marketGrab, marketKey, nearestDivider, nudge, pickHandle, pointFor, valueAt, type GuessHandle } from "../guess/handles";
import { clockFraction } from "../guess/handles";
import { clientPointFor, h, logicalPoint } from "./dom";
import { mountGateDock, type GateDock } from "./gate-dock";
import type { AskGateStep } from "./controls";
import { budgetLine, gateLangOf, gateWords } from "./gate-words";

/** True when ←/→ pick an entry of the handle instead of changing it. A
 *  market curve's two gaps are one gesture: its arrows move and turn it. */
const multiEntry = (g: GuessHandle): boolean => g.truth.length > 1 && g.kind !== "market";

export function guessGateFor(stage: HTMLElement, hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      const session = step.guess as GuessSession | undefined;
      if (!session || session.setup.handles.length === 0) {
        resolve(null);
        return;
      }
      stage.querySelector(".cs-figgate")?.remove();
      const words = gateWords(gateLangOf(hd));
      const handles = session.setup.handles;
      const values: number[][] = session.start.map((r) => r.slice());
      let focus = 0;
      let entry = 0;
      let settled = false;
      // Letting go answers: one part, worked in one gesture.
      // A budget (spec 2026-10-03-looks-feedback-account §5): each bar moves
      // on its own; the player paints the account bar beside the plot, and
      // Answer waits until it balances.
      const budget = session.account?.budget ?? null;
      // The cast's own name for the account ("Hours left") speaks in the
      // dock too; the player's default "Left" says "Balance the budget".
      const accountLabel = session.account && session.account.label !== "Left" ? session.account.label : null;
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
          ? words.guess.bars
          : handles[0].kind === "angle" && multiEntry(handles[0])
            ? words.guess.edges
            : words.guess[handles[0].kind];
      const hintFull = onRelease ? (handles[0].kind === "point" ? hintText : words.letGo(hintText)) : words.thenAnswer(hintText);
      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint", title: hintFull }, hintFull);
      const pill = h("button", { class: "cs-guess-value", type: "button", title: words.typeNumber });
      const answer = h("button", { class: "cs-cardgate-pill cs-guess-answer", type: "button" }, words.answer) as HTMLButtonElement;
      answer.hidden = onRelease;
      const hintDefault = hint.textContent ?? "";
      /** A budget: the hint says what is left or over; Answer only when balanced. */
      // A budget the bars cannot reach (past their summed tops or under their
      // floors) can never balance: Answer goes through anyway (lint flags it).
      const reachable = budget === null || budgetReachable(handles, budget);
      const balanced = (): boolean => budget === null || !reachable || budgetBalanced(handles, values, budget);
      const balance = (): void => {
        if (budget === null) return;
        const a = accountOf(values, budget);
        const msg = balanced() ? null : budgetLine(words, a, handles[0].format(Math.abs(a)), accountLabel);
        hint.textContent = msg ?? hintDefault;
        hint.setAttribute("title", msg ?? hintDefault);
        answer.disabled = msg !== null;
      };
      const gate = h("div", { class: "cs-figgate cs-guessgate" }, pill);
      let dock: GateDock | null = null;

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
          pill.hidden = false;
          const beside = g.kind === "height" ? besideBar(g, c) : null;
          pill.classList.toggle("cs-guess-beside", beside !== null);
          pill.style.left = `${beside ? beside[0] : c[0]}px`;
          pill.style.top = `${c[1]}px`;
        } else pill.hidden = true;
      };
      /**
       * A bar's pill stands above the bar's top — unless there it would reach
       * past the top of the plot, over the axis and its title (on a phone the
       * drawing is small and the pill is not, H2): then it stands beside the
       * bar's top, right of it (left when that runs off the drawing). Returns
       * the pill's left edge (stage px), or null for above.
       */
      const besideBar = (g: GuessHandle, c: [number, number]): [number] | null => {
        if (!g.toLogical || g.cx === undefined || g.halfW === undefined) return null;
        const top = clientPointFor(stage, [g.cx, g.toLogical([0, g.max])[1]]);
        const ph = pill.offsetHeight;
        if (!top || ph === 0) return null;
        // The pill's own gap from the bar: its CSS lifts it 100 % + 10–30 px.
        const lift = ph + (stage.classList.contains("cs-docked-narrow") ? 10 : 30);
        if (c[1] - lift >= top[1]) return null;
        const y = g.toLogical([0, 0])[1];
        const right = clientPointFor(stage, [g.cx + g.halfW, y]);
        const left = clientPointFor(stage, [g.cx - g.halfW, y]);
        if (!right || !left) return null;
        const pw = pill.offsetWidth;
        const room = stage.getBoundingClientRect().width;
        return right[0] + 4 + pw <= room ? [right[0] + 4] : [Math.max(0, left[0] - 4 - pw)];
      };

      const finish = (result: string | null): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        document.removeEventListener("keydown", onKey, true);
        dock?.dispose();
        gate.remove();
        resolve(result);
      };
      const onAbort = (): void => finish(null);

      // —— pointer ——
      let dragging: { k: number; prev: [number, number]; grab?: number; anchor?: number } | null = null;
      const pick = (p: [number, number]): number | null => pickHandle(handles, values, p);
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
        // A market turn holds the point grabbed (the copy follows the pointer from there).
        const anchor = g.kind === "market" && grab === 1 ? marketAnchor(g, values[k], p) : undefined;
        dragging = { k, prev: p, ...(grab !== undefined ? { grab } : {}), ...(anchor !== undefined ? { anchor } : {}) };
        focus = k;
        if (grab !== undefined && g.kind !== "market") entry = grab;
        values[k] = valueAt(g, p, values[k], null, grab);
        balance();
        gate.classList.add("dragging");
        repaint();
      });
      gate.addEventListener("pointermove", (e) => {
        e.stopPropagation();
        if (!dragging || settled) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        const g = handles[dragging.k];
        values[dragging.k] = valueAt(g, p, values[dragging.k], dragging.prev, dragging.grab, dragging.anchor);
        balance();
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
          if (!balanced()) return;
          finish(encodeGuess(values));
          return;
        }
        if (g.kind === "market") {
          // By the screen: the axis's own arrows move it, Shift turns it.
          const dir = marketKey(g, e.key);
          if (dir === null) return;
          e.preventDefault();
          e.stopPropagation();
          values[focus] = nudge(g, values[focus], 0, dir, e.shiftKey);
          repaint();
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
        balance();
        repaint();
      };

      // —— typing a number ——
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        const g = handles[focus];
        if (g.kind === "angle" && multiEntry(g)) return;
        const field = h("input", { class: "cs-guess-field", type: "text", inputmode: "decimal", "aria-label": words.guessFor(g.label) }) as HTMLInputElement;
        const j = multiEntry(g) ? entry : 0;
        field.value = String(values[focus][j]);
        pill.replaceWith(field);
        field.style.left = pill.style.left;
        field.style.top = pill.style.top;
        if (pill.classList.contains("cs-guess-beside")) field.classList.add("cs-guess-beside");
        field.focus();
        field.select();
        // Closed once: swapping the focused field out fires its blur at once
        // (while it is still in the page), and a second close would swap a
        // field that is gone — NotFoundError — and commit an Escape.
        let closed = false;
        const close = (commit: boolean): void => {
          if (closed) return;
          closed = true;
          if (commit) {
            const n = Number(field.value.replace(/[\s %]/g, "").replace(",", "."));
            if (Number.isFinite(n)) {
              const row = values[focus].slice();
              row[j] = Math.max(g.min, Math.min(g.max, n));
              values[focus] = row;
              balance();
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
        // Leaving the field (a tap elsewhere) keeps what was typed.
        field.addEventListener("blur", () => close(true));
        field.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      });

      answer.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!balanced()) return;
        finish(encodeGuess(values));
      });
      // The dock: the hint (a budget's balance), Answer, Skip.
      const docked: HTMLElement[] = [hint, answer];
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", type: "button" }, words.skip);
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          finish(null);
        });
        docked.push(skip);
      }
      signal.addEventListener("abort", onAbort);
      document.addEventListener("keydown", onKey, true);
      stage.appendChild(gate);
      dock = mountGateDock(stage, gate, docked, placePill);
      balance();
      dock.relayout();
    });
}
