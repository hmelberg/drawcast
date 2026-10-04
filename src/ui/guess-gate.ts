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
import { barPill, type BarPillOut } from "./bar-pill";
import { accountOf, budgetBalanced, budgetReachable, encodeGuess, hitDistance, marketAnchor, marketGrab, marketKey, nearestDivider, nudge, countPillPoint, personAt, pickHandle, pointFor, strokeEntries, strokeStart, valueAt, type GuessHandle } from "../guess/handles";
import { clockFraction } from "../guess/handles";
import { onSlider } from "../guess/slider-marks";
import { clientPointFor, h, logicalPoint } from "./dom";
import { mountGateDock, type GateDock } from "./gate-dock";
import type { AskGateStep } from "./controls";
import { budgetLine, gateLangOf, gateWords } from "./gate-words";
import { CURSOR, guessCursor } from "./cursors";
import { mountGuessHover } from "./guess-hover";

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
      /** A sketched line's points the viewer has drawn (or typed, or nudged). */
      const touched = handles.map(() => new Set<number>());
      let settled = false;
      // Letting go answers: one part, worked in one gesture.
      // A budget (spec 2026-10-03-looks-feedback-account §5): each bar moves
      // on its own; the player paints the account bar beside the plot, and
      // Answer waits until it balances.
      const budget = session.account?.budget ?? null;
      // The cast's own name for the account ("Hours left") speaks in the
      // dock too; the player's default ("Left" / "Igjen") says "Balance the budget".
      const accountLabel = session.account && !session.account.isDefault ? session.account.label : null;
      // A market curve is moved AND turned (spec 2026-10-03 §3.2): one gesture
      // is rarely the whole answer, so it waits for Answer unless release: true.
      // An estimate slider (spec/slider.ts) is adjusted, then Done.
      const slider = handles.length === 1 && onSlider(handles[0]);
      const onRelease =
        slider
          ? step.release === true
          : handles[0].kind === "market"
          ? step.release === true && handles.length === 1
          : step.release !== false && handles.length === 1 && !(handles[0].kind === "angle" && handles[0].truth.length > 1);
      /** A beat between letting go and the reveal: the guess is seen standing. */
      const RELEASE_MS = 180;

      const hintText =
        handles.length > 1 && handles[0].kind === "height"
          ? words.guess.bars
          : handles[0].kind === "angle" && multiEntry(handles[0])
            ? words.guess.edges
            : slider
              ? words.guess.slider
              : words.guess[handles[0].kind];
      const hintFull = onRelease ? (handles[0].kind === "point" ? hintText : words.letGo(hintText)) : words.thenDone(hintText);
      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint", title: hintFull }, hintFull);
      const pill = h("button", { class: "cs-guess-value", type: "button", title: words.typeNumber });
      const answer = h("button", { class: "cs-cardgate-pill cs-guess-answer", type: "button" }, words.done) as HTMLButtonElement;
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
      const gate = h("div", { class: slider ? "cs-figgate cs-guessgate cs-slidergate" : "cs-figgate cs-guessgate" }, pill);
      const hover = mountGuessHover(stage, gate);
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
        const p = g.kind === "count" ? countPillPoint(g, values[focus]) : pointFor(g, values[focus], entry);
        const c = p ? clientPointFor(stage, p) : null;
        const v = values[focus][multiEntry(g) ? entry : 0];
        const name = g.entryLabels?.[entry] ?? (g.kind === "curve" ? "" : g.label);
        pill.textContent = handles.length > 1 || multiEntry(g) ? `${name ? `${name} ` : ""}${g.format(v)}` : g.format(v);
        // A scale's marker writes its own number: a pill over it says it twice.
        // A market curve has no one number to type: its copy is the answer.
        if (c && g.kind !== "point" && g.kind !== "market") {
          pill.hidden = false;
          // A sketched line's pill follows the pencil: it must never catch
          // a press meant to draw (the arrows still change its number).
          pill.classList.toggle("cs-guess-passive", g.kind === "curve");
          const bar = g.kind === "height" ? barPillAt(g, c) : null;
          pill.classList.toggle("cs-guess-beside", bar?.mode === "beside");
          // A crowd's pill hangs under the people and their legend, never over them.
          pill.classList.toggle("cs-guess-under", g.kind === "count");
          pill.style.left = `${bar ? bar.x : c[0]}px`;
          pill.style.top = `${c[1]}px`;
        } else pill.hidden = true;
      };
      /** A bar's pill: above the bar's top, else beside it — inside the plot (ui/bar-pill.ts). */
      const barPillAt = (g: GuessHandle, c: [number, number]): BarPillOut | null => {
        if (!g.toLogical || g.cx === undefined || g.halfW === undefined) return null;
        const top = clientPointFor(stage, [g.cx, g.toLogical([0, g.max])[1]]);
        const ph = pill.offsetHeight;
        if (!top || ph === 0) return null;
        const y = g.toLogical([0, 0])[1];
        const right = clientPointFor(stage, [g.cx + g.halfW, y]);
        const left = clientPointFor(stage, [g.cx - g.halfW, y]);
        if (!right || !left) return null;
        const stageW = stage.getBoundingClientRect().width;
        const axis = g.plotX ? clientPointFor(stage, [g.plotX[0], y]) : null;
        const end = g.plotX ? clientPointFor(stage, [g.plotX[1], y]) : null;
        return barPill({
          barL: left[0],
          barR: right[0],
          barTop: c[1],
          axisX: axis ? axis[0] : 0,
          plotR: end ? Math.min(stageW, end[0]) : stageW,
          plotTop: top[1],
          pw: pill.offsetWidth,
          ph,
          // The pill's own gap from the bar: its CSS lifts it 100 % + 10–30 px.
          lift: ph + (stage.classList.contains("cs-docked-narrow") ? 10 : 30),
        });
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
      // ghost: a touch on a number line — the faded marker follows the
      // finger and the real one is placed where it lifts (ui/guess-hover.ts).
      let dragging: { k: number; prev: [number, number]; grab?: number; anchor?: number; ghost?: boolean } | null = null;
      const pick = (p: [number, number]): number | null => pickHandle(handles, values, p);
      /** The handle the pointer is over (its own hit area), or null. */
      const over = (p: [number, number]): number | null => {
        let best: number | null = null;
        let bestD = Infinity;
        handles.forEach((g, k) => {
          const d = hitDistance(g, p, values[k]);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        });
        return best;
      };
      /** The cursor and the hover marks for the pointer at `p` (null: off the figure). */
      const hoverAt = (p: [number, number] | null): void => {
        if (dragging) {
          const g = handles[dragging.k];
          gate.style.cursor = guessCursor(g.kind, "drag");
          if (dragging.ghost && p) hover.ghost(g, p);
          else if (g.kind === "height") hover.grip(g, values[dragging.k]);
          else if (g.kind === "count" && g.people?.seq && p && personAt(g, p) >= 0) hover.person(g, personAt(g, p));
          else hover.hide();
          return;
        }
        const k = p ? over(p) : null;
        if (k === null || !p) {
          gate.style.cursor = CURSOR.idle;
          hover.hide();
          return;
        }
        const g = handles[k];
        gate.style.cursor = guessCursor(g.kind, "hover");
        if (g.kind === "point") hover.ghost(g, p);
        else if (g.kind === "height") hover.grip(g, values[k]);
        else if (g.kind === "count" && g.people?.seq) {
          const who = personAt(g, p);
          if (who >= 0) hover.person(g, who);
          else hover.hide();
        } else hover.hide();
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
        // A market turn holds the point grabbed (the copy follows the pointer from there).
        const anchor = g.kind === "market" && grab === 1 ? marketAnchor(g, values[k], p) : undefined;
        const ghost = g.kind === "point" && e.pointerType === "touch";
        dragging = { k, prev: p, ...(grab !== undefined ? { grab } : {}), ...(anchor !== undefined ? { anchor } : {}), ...(ghost ? { ghost } : {}) };
        focus = k;
        if (grab !== undefined && g.kind !== "market") entry = grab;
        gate.classList.add("dragging");
        if (g.kind === "curve") {
          // Anywhere right of the given line: the stroke joins on from the
          // last known point to its left.
          const start = strokeStart(g, values[k], touched[k], p);
          values[k] = valueAt(g, p, values[k], start);
          const set = strokeEntries(g, p, start);
          for (const j of set) touched[k].add(j);
          entry = set[0] ?? entry;
          balance();
          repaint();
        } else if (!ghost) {
          values[k] = valueAt(g, p, values[k], null, grab);
          balance();
          repaint();
        } else placePill();
        hoverAt(p);
      });
      gate.addEventListener("pointermove", (e) => {
        e.stopPropagation();
        if (settled) return;
        const p = logicalPoint(stage, e);
        if ((e.target as Element).closest("button, input")) hoverAt(null);
        else if (!dragging || dragging.ghost) hoverAt(p);
        if (!dragging || !p) return;
        if (dragging.ghost) {
          dragging.prev = p;
          return;
        }
        const g = handles[dragging.k];
        values[dragging.k] = valueAt(g, p, values[dragging.k], dragging.prev, dragging.grab, dragging.anchor);
        if (g.kind === "curve") {
          const set = strokeEntries(g, p, dragging.prev);
          for (const j of set) touched[dragging.k].add(j);
          entry = set[0] ?? entry;
        }
        balance();
        dragging.prev = p;
        repaint();
        hoverAt(p);
      });
      gate.addEventListener("pointerleave", () => {
        if (!dragging) hoverAt(null);
      });
      const endDrag = (e: PointerEvent): void => {
        e.stopPropagation();
        const was = dragging;
        dragging = null;
        gate.classList.remove("dragging");
        // A touch on a number line: the marker goes where the finger lifts.
        if (was?.ghost) {
          if (e.type !== "pointerup") {
            hoverAt(null);
            return;
          }
          const p = logicalPoint(stage, e) ?? was.prev;
          values[was.k] = valueAt(handles[was.k], p, values[was.k], null);
          balance();
          repaint();
        }
        hoverAt(e.pointerType === "touch" ? null : logicalPoint(stage, e));
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
        hover.hide();
        values[focus] = nudge(g, values[focus], multiEntry(g) ? entry : 0, up ? 1 : -1, e.shiftKey);
        if (g.kind === "curve") touched[focus].add(entry);
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
              if (g.kind === "curve") touched[focus].add(j);
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
      // The bar (round 7 §8.3): Skip, then Answer; the hint is the how line under the question (§8.1).
      const docked: HTMLElement[] = [answer];
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", type: "button" }, words.skip);
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          finish(null);
        });
        docked.unshift(skip);
      }
      signal.addEventListener("abort", onAbort);
      document.addEventListener("keydown", onKey, true);
      stage.appendChild(gate);
      dock = mountGateDock(stage, gate, docked, placePill, { question: step.question, how: hint });
      balance();
      dock.relayout();
    });
}
