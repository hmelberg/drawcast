// The connect question's answer device: press a star and drag to the next
// (or tap one, then tap another — the two-tap path, the one that works on
// touch) to join them; a click on a drawn segment removes it — there is no
// undo button, because removing a wrong line already IS the undo. Grading
// happens once, on Done: exact against the figure's own key (connectKey,
// render/widgets.ts, via connect-model.ts's rules). Follows drag-gate.ts's
// shape closely: the same promise, the same settled/remove/onAbort
// structure, the same LINGER_MS, the same stale-gate-clear first line.
//
// The figure's own lines are hidden for the question's duration — the
// gate's own half of a contract lint's `connect` rule enforces on the
// cast's half (the figure must already be drawn) — and restored on every
// exit path: finish, skip, abort.

import type { RenderHandle } from "../render";
import { elementBBoxes } from "../layout/layout";
import { leafDrawables } from "../layout/model";
import { makeBrowserMeasure } from "../render/svg-backend";
import { connectKey, type ConnectEdge, type ConnectStar } from "../render/widgets";
import {
  connectOpens,
  connectProgress,
  connectSummary,
  edgeAt,
  gradeConnect,
  makeEdge,
  snapStar,
  toggleEdge,
  type ConnectGrade,
} from "./connect-model";
import { clientPointFor, h, logicalPoint } from "./dom";
import type { AskGateStep } from "./controls";

/** Matches the other cards' CARD_LINGER_MS. */
const LINGER_MS = 2600;
/** A press that moves less than this (CSS px) is a tap, not a drag — the
 *  drag widget's own DRAG_MIN_PX, so touch and mouse agree on "didn't move"
 *  the same way everywhere in the app. */
const DRAG_MIN_PX = 4;

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
}

/** The median nearest-neighbour distance among the key's own stars — the
 *  figure's own natural spacing, so a crowded figure (four close stars) and
 *  a sprawling one each get a snap radius sized to themselves rather than
 *  one constant tuned for neither. */
function medianNearestNeighbour(stars: readonly ConnectStar[]): number {
  const dists = stars.map((s, i) => {
    let best = Infinity;
    for (let j = 0; j < stars.length; j++) {
      if (j === i) continue;
      const d = Math.hypot(stars[j].at[0] - s.at[0], stars[j].at[1] - s.at[1]);
      if (d < best) best = d;
    }
    return best;
  });
  dists.sort((a, b) => a - b);
  const mid = Math.floor(dists.length / 2);
  return dists.length % 2 === 0 ? (dists[mid - 1] + dists[mid]) / 2 : dists[mid];
}

/** Logical-unit clamp on the star-press radius: never so small a real press
 *  misses, never so wide two stars of a crowded figure share it. */
const SNAP_MIN = 12;
const SNAP_MAX = 40;
function snapRadiusFor(stars: readonly ConnectStar[]): number {
  if (stars.length < 2) return SNAP_MAX;
  const nn = medianNearestNeighbour(stars);
  if (!Number.isFinite(nn)) return SNAP_MAX;
  return Math.max(SNAP_MIN, Math.min(SNAP_MAX, nn * 0.4));
}

/** Hides the figure's own lines — the leaf named exactly `answer` (a
 *  single-leaf figure) and every leaf of its group (`answer__0`,
 *  `answer__1`, …) — by zeroing the inline opacity on each `data-leaf-id`
 *  node `svg-backend.ts:305` already stamps, and hands back a restorer that
 *  puts each one's OWN saved opacity back. The restore reads the very same
 *  `data-leaf-id` nodes the hide found, so nothing here can hide one set and
 *  restore another. */
function hideFigureLines(stage: HTMLElement, answer: string): () => void {
  const nodes = stage.querySelectorAll<HTMLElement>(`[data-leaf-id="${answer}"], [data-leaf-id^="${answer}__"]`);
  const saved: [HTMLElement, string][] = [];
  nodes.forEach((n) => {
    saved.push([n, n.style.opacity]);
    n.style.opacity = "0";
  });
  let restored = false;
  return () => {
    if (restored) return; // idempotent: finish() restores early, remove() restores again on teardown
    restored = true;
    for (const [n, opacity] of saved) n.style.opacity = opacity;
  };
}

export function connectGateFor(stage: HTMLElement, hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      stage.querySelector(".cs-figgate")?.remove();

      const answer = step.answer;
      if (answer === undefined) {
        resolve(null);
        return;
      }
      const key = connectKey(leafDrawables(hd.layout.drawables), elementBBoxes(hd.layout, makeBrowserMeasure()), answer);
      // The ONE decision left to the model — lint already refused this
      // figure at compile time, and a viewer must never meet a question
      // that cannot be won.
      if (!connectOpens(key)) {
        resolve(null);
        return;
      }

      const snapRadius = snapRadiusFor(key.stars);
      const edgeTol = snapRadius * 0.5;

      const restoreLines = hideFigureLines(stage, answer);
      const prevTouchAction = stage.style.touchAction;
      stage.style.touchAction = "none"; // a finger draws instead of scrolling the stage

      let drawn: ConnectEdge[] = [];
      let armed: ConnectStar | null = null;
      let band: { from: ConnectStar; to: [number, number] } | null = null;
      let grade: ConnectGrade | null = null;
      let settled = false;

      const linesLayer = svgEl("g");
      const bandLayer = svgEl("g");
      const dotsLayer = svgEl("g");
      const ink = svgEl("svg");
      ink.setAttribute("class", "cs-connect-ink");
      ink.append(linesLayer, bandLayer, dotsLayer);

      const counter = h("span", { class: "cs-waitgate-pill cs-connect-counter" }, connectProgress(0, key.edges.length));
      const summary = h("span", { class: "cs-waitgate-pill cs-connect-summary" });
      summary.hidden = true;
      const doneBtn = h("button", { class: "cs-cardgate-pill ok cs-connect-done" }, "Done ▸");
      let skip: HTMLButtonElement | undefined;
      const gate = h("div", { class: "cs-figgate cs-connectgate" }, ink, counter, summary, doneBtn);

      // Every point drawn in the overlay goes through clientPointFor — the
      // star positions (already logical) and, for the live rubber band, a
      // pointer position round-tripped through logicalPoint first, so
      // nothing here ever touches a client rect on its own.
      const starClient = new Map<string, [number, number] | null>();
      const clientOf = (e: PointerEvent): [number, number] | null => {
        const p = logicalPoint(stage, e);
        return p && clientPointFor(stage, p);
      };

      const verdictClass = (e: ConnectEdge): string => {
        if (!grade) return "";
        if (grade.strays.some((s) => s[0] === e[0] && s[1] === e[1])) return "wrong";
        if (grade.hits.some((s) => s[0] === e[0] && s[1] === e[1])) return "right";
        return "";
      };

      const render = (): void => {
        for (const s of key.stars) starClient.set(s.id, clientPointFor(stage, s.at));

        linesLayer.replaceChildren();
        for (const e of drawn) {
          const a = starClient.get(e[0]);
          const b = starClient.get(e[1]);
          if (!a || !b) continue;
          const line = svgEl("line");
          line.setAttribute("x1", String(a[0]));
          line.setAttribute("y1", String(a[1]));
          line.setAttribute("x2", String(b[0]));
          line.setAttribute("y2", String(b[1]));
          line.setAttribute("class", `cs-connect-line ${verdictClass(e)}`.trim());
          linesLayer.appendChild(line);
        }

        bandLayer.replaceChildren();
        if (band) {
          const from = starClient.get(band.from.id);
          if (from) {
            const line = svgEl("line");
            line.setAttribute("x1", String(from[0]));
            line.setAttribute("y1", String(from[1]));
            line.setAttribute("x2", String(band.to[0]));
            line.setAttribute("y2", String(band.to[1]));
            line.setAttribute("class", "cs-connect-band");
            bandLayer.appendChild(line);
          }
        }

        dotsLayer.replaceChildren();
        for (const s of key.stars) {
          const c = starClient.get(s.id);
          if (!c) continue;
          const dot = svgEl("circle");
          dot.setAttribute("cx", String(c[0]));
          dot.setAttribute("cy", String(c[1]));
          dot.setAttribute("r", "6");
          dot.setAttribute("class", `cs-connect-star${armed?.id === s.id ? " armed" : ""}`);
          dotsLayer.appendChild(dot);
        }
      };

      const onResize = (): void => render();
      window.addEventListener("resize", onResize);

      const remove = (): void => {
        signal.removeEventListener("abort", onAbort);
        window.removeEventListener("resize", onResize);
        restoreLines();
        stage.style.touchAction = prevTouchAction;
        gate.remove();
      };

      const onAbort = (): void => {
        remove();
        if (!settled) {
          settled = true;
          resolve(null);
        }
      };

      const finish = (): void => {
        if (settled) return;
        settled = true;
        grade = gradeConnect(drawn, key.edges);
        armed = null;
        band = null;
        counter.hidden = true;
        doneBtn.remove();
        skip?.remove();
        render(); // repaints the drawn set: hits green, strays red
        restoreLines(); // the reveal: the real lines return for the linger, beside the verdict
        summary.textContent = connectSummary(grade);
        summary.hidden = false;
        window.setTimeout(remove, LINGER_MS);
        resolve(grade.pass ? answer : connectSummary(grade));
      };

      // --- pointer gesture state (one active gesture at a time) ---
      let gesturePointerId: number | null = null;
      let downClient: [number, number] | null = null;
      let downStar: ConnectStar | null = null;
      let downEdge: ConnectEdge | null = null;

      const clearGesture = (): void => {
        gesturePointerId = null;
        downClient = null;
        downStar = null;
        downEdge = null;
        band = null;
      };

      gate.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (settled || gesturePointerId !== null) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        gesturePointerId = e.pointerId;
        downClient = [e.clientX, e.clientY];
        downStar = snapStar(p, key.stars, snapRadius);
        downEdge = downStar ? null : edgeAt(p, drawn, key.stars, edgeTol);
        if (downStar) {
          try {
            gate.setPointerCapture(e.pointerId);
          } catch {
            /* a synthetic pointer has no capture to take; the gesture still follows the moves it receives */
          }
        }
      });

      gate.addEventListener("pointermove", (e) => {
        if (settled || e.pointerId !== gesturePointerId || !downStar) return;
        const c = clientOf(e);
        if (!c) return;
        band = { from: downStar, to: c };
        render();
      });

      gate.addEventListener("pointerup", (e) => {
        if (settled || e.pointerId !== gesturePointerId) return;
        try {
          gate.releasePointerCapture(e.pointerId);
        } catch {
          /* nothing captured (a plain click on empty space never captured) */
        }
        const [dx0, dy0] = downClient ?? [e.clientX, e.clientY];
        const wasTap = Math.abs(e.clientX - dx0) < DRAG_MIN_PX && Math.abs(e.clientY - dy0) < DRAG_MIN_PX;
        const pressed = downStar;
        const missedEdge = downEdge;
        clearGesture();

        if (pressed) {
          if (wasTap) {
            // A press that never left the star: leave it (or the one already
            // armed) ready for the SEPARATE next tap — the two-tap path.
            if (armed === null) armed = pressed;
            else if (armed.id === pressed.id) armed = null; // tapping the armed star again: changed their mind
            else {
              drawn = toggleEdge(drawn, makeEdge(armed.id, pressed.id));
              armed = null;
            }
          } else {
            // A real drag: it completes (or removes) an edge against
            // wherever it lets go, independent of any SEPARATE star already
            // armed from an earlier, unrelated tap.
            const p = logicalPoint(stage, e);
            const upStar = p && snapStar(p, key.stars, snapRadius);
            if (upStar && upStar.id !== pressed.id) drawn = toggleEdge(drawn, makeEdge(pressed.id, upStar.id));
            // landing on empty space, or back on the star it started from: cancels — nothing drawn or removed.
          }
        } else if (wasTap && missedEdge) {
          // A click on a drawn segment: the undo IS the click.
          drawn = toggleEdge(drawn, missedEdge);
        }

        counter.textContent = connectProgress(drawn.length, key.edges.length);
        render();
      });

      gate.addEventListener("pointercancel", (e) => {
        if (e.pointerId !== gesturePointerId) return;
        clearGesture();
        render();
      });

      doneBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        finish();
      });

      if (!step.required) {
        skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip" }, "Skip ▸");
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (settled) return;
          settled = true;
          remove();
          resolve(null);
        });
        gate.appendChild(skip);
      }

      gate.addEventListener("click", (e) => e.stopPropagation());
      signal.addEventListener("abort", onAbort);
      stage.appendChild(gate);
      render();
    });
}
