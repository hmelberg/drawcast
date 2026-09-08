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
  hiddenLeafSelector,
  makeEdge,
  restoreOpacity,
  sameEdge,
  snapRadiusFor,
  snapStar,
  toggleEdge,
  type ConnectGrade,
} from "./connect-model";
import { clientPointFor, h, logicalPoint } from "./dom";
import type { AskGateStep } from "./controls";

/** Matches the other cards' CARD_LINGER_MS. */
const LINGER_MS = 2600;

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
}

/** Hides the figure's own lines (`hiddenLeafSelector`, connect-model.ts) by
 *  zeroing each matched node's inline opacity, and hands back a restorer.
 *  The restore loop itself (`restoreOpacity`) is pure and tested there; what
 *  is left here is only the wiring — finding the real nodes and touching
 *  their style — which is the least interesting part of the operation. Node
 *  references are kept directly (not re-queried at restore time) so a
 *  structural change elsewhere in the DOM meanwhile can't strand a hidden
 *  line. */
function hideFigureLines(stage: HTMLElement, answer: string): () => void {
  const nodes = stage.querySelectorAll<HTMLElement>(hiddenLeafSelector(answer));
  const byId = new Map<string, HTMLElement>();
  const saved = new Map<string, string>();
  nodes.forEach((n) => {
    const id = n.dataset.leafId;
    if (id === undefined) return; // matched by data-leaf-id, so always defined; guards the type only
    byId.set(id, n);
    saved.set(id, n.style.opacity);
    n.style.opacity = "0";
  });
  let restored = false;
  return () => {
    if (restored) return; // idempotent: finish() restores early, remove() restores again on teardown
    restored = true;
    restoreOpacity(saved, (id, value) => {
      const node = byId.get(id);
      if (node) node.style.opacity = value;
    });
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
      // .cs-figgate already carries `touch-action: none` in the stylesheet
      // (every figgate does), scoped to this element and gone the instant
      // `gate.remove()` runs — no JS save/restore needed, and so nothing to
      // leak onto the stage past this gate's own lifetime regardless of
      // whether teardown happens at once (skip/abort) or after the linger
      // (finish).

      let drawn: ConnectEdge[] = [];
      let armed: ConnectStar | null = null;
      let band: { from: ConnectStar; to: [number, number] } | null = null;
      let grade: ConnectGrade | null = null;
      let settled = false;

      const linesLayer = svgEl("g");
      const bandLayer = svgEl("g");
      const dotsLayer = svgEl("g");
      const bandLine = svgEl("line");
      bandLine.setAttribute("class", "cs-connect-band");
      bandLine.style.display = "none";
      bandLayer.appendChild(bandLine);
      const ink = svgEl("svg");
      ink.setAttribute("class", "cs-connect-ink");
      ink.append(linesLayer, bandLayer, dotsLayer);

      const hint = h(
        "span",
        { class: "cs-waitgate-pill cs-figgate-hint" },
        "Press a star and drag to the next. Click a line to remove it ▸",
      );
      const counter = h("span", { class: "cs-waitgate-pill cs-connect-counter" }, connectProgress(0, key.edges.length));
      const summary = h("span", { class: "cs-waitgate-pill cs-connect-summary" });
      summary.hidden = true;
      const doneBtn = h("button", { class: "cs-cardgate-pill ok cs-connect-done" }, "Done ▸");
      let skip: HTMLButtonElement | undefined;
      const gate = h("div", { class: "cs-figgate cs-connectgate" }, ink, counter, summary, hint, doneBtn);

      // Every point drawn in the overlay goes through clientPointFor — the
      // star positions (already logical) and, for the live rubber band, a
      // pointer position round-tripped through logicalPoint first, so
      // nothing here ever touches a client rect on its own.
      const starClient = new Map<string, [number, number] | null>();
      const positionStars = (): void => {
        for (const s of key.stars) starClient.set(s.id, clientPointFor(stage, s.at));
      };
      const clientOf = (e: PointerEvent): [number, number] | null => {
        const p = logicalPoint(stage, e);
        return p && clientPointFor(stage, p);
      };

      const verdictClass = (e: ConnectEdge): string => {
        if (!grade) return "";
        if (grade.strays.some((s) => sameEdge(s, e))) return "wrong";
        if (grade.hits.some((s) => sameEdge(s, e))) return "right";
        return "";
      };

      // Rebuilds the drawn segments and the star dots from the CURRENT
      // starClient positions — called whenever what's drawn or armed
      // changes (pointerup, finish), never on every pointermove, which
      // would otherwise rebuild this DOM on every frame of a drag.
      const renderMarks = (): void => {
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

      // The hot path: only the rubber band's own two endpoints move, on an
      // already-positioned star — no re-measuring, no DOM rebuild.
      const updateBand = (): void => {
        const from = band && starClient.get(band.from.id);
        if (!band || !from) {
          bandLine.style.display = "none";
          return;
        }
        bandLine.setAttribute("x1", String(from[0]));
        bandLine.setAttribute("y1", String(from[1]));
        bandLine.setAttribute("x2", String(band.to[0]));
        bandLine.setAttribute("y2", String(band.to[1]));
        bandLine.style.display = "";
      };

      const onResize = (): void => {
        positionStars();
        renderMarks();
        updateBand();
      };
      window.addEventListener("resize", onResize);

      const remove = (): void => {
        signal.removeEventListener("abort", onAbort);
        window.removeEventListener("resize", onResize);
        restoreLines();
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
        hint.remove();
        doneBtn.remove();
        skip?.remove();
        renderMarks(); // repaints the drawn set: hits green, strays red
        updateBand();
        restoreLines(); // the reveal: the real lines return for the linger, beside the verdict
        const summaryText = connectSummary(grade);
        summary.textContent = summaryText;
        summary.hidden = false;
        window.setTimeout(remove, LINGER_MS);
        resolve(grade.pass ? answer : summaryText);
      };

      // --- pointer gesture state (one active gesture at a time) ---
      let gesturePointerId: number | null = null;
      let downStar: ConnectStar | null = null;
      let downEdge: ConnectEdge | null = null;

      const clearGesture = (): void => {
        gesturePointerId = null;
        downStar = null;
        downEdge = null;
        band = null;
      };

      gate.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (settled || gesturePointerId !== null) return;
        // The Done/Skip pills are real <button>s inside this same gate, so a
        // press on either one reaches this listener too (it bubbles before
        // stopPropagation above can stop it reaching further UP, and this
        // listener already ran by then regardless). Capturing the pointer
        // here would retarget their own "click" listener's event to `gate`
        // instead of the button per the pointer-capture spec's compatibility
        // mouse events — silently breaking Done and Skip. Leave button
        // presses to the buttons.
        if (e.target instanceof HTMLButtonElement) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        gesturePointerId = e.pointerId;
        downStar = snapStar(p, key.stars, snapRadius);
        downEdge = downStar ? null : edgeAt(p, drawn, key.stars, edgeTol);
        // Captured unconditionally, star or not: without it, a press that
        // starts on empty space and is released outside the gate's own
        // bounds would never fire a pointerup HERE at all, leaving
        // gesturePointerId set forever and the gate permanently unable to
        // start a new gesture.
        try {
          gate.setPointerCapture(e.pointerId);
        } catch {
          /* a synthetic pointer has no capture to take; the gesture still follows the moves it receives */
        }
      });

      gate.addEventListener("pointermove", (e) => {
        if (settled || e.pointerId !== gesturePointerId || !downStar) return;
        const c = clientOf(e);
        if (!c) return;
        band = { from: downStar, to: c };
        updateBand();
      });

      // Decided from WHERE THE POINTER CAME UP, never from how far it moved
      // to get there — a press-drag and a two-tap are the same gesture read
      // at its endpoint, so there is no distance threshold to tune, and
      // nothing that behaves differently on a trackpad than on glass, where
      // a real tap routinely drifts more than a few px.
      gate.addEventListener("pointerup", (e) => {
        if (settled || e.pointerId !== gesturePointerId) return;
        try {
          gate.releasePointerCapture(e.pointerId);
        } catch {
          /* already released (a pointercancel or a lost capture beat this event to it) */
        }
        const pressed = downStar;
        const missedEdge = downEdge;
        const p = logicalPoint(stage, e);
        const upStar = p && snapStar(p, key.stars, snapRadius);
        clearGesture();

        if (pressed) {
          if (upStar && upStar.id === pressed.id) {
            // Up on the SAME star it went down on: arm it, or — tapping the
            // already-armed star again — disarm it. The natural way to
            // change your mind, and the two-tap path's first half.
            armed = armed && armed.id === pressed.id ? null : pressed;
          } else if (upStar) {
            // Up on a DIFFERENT star: lay (or remove) the segment between
            // them — the press-drag's happy path, and the two-tap path's
            // second half, both land here identically.
            drawn = toggleEdge(drawn, makeEdge(pressed.id, upStar.id));
            armed = null; // this gesture just completed something: a
            // SEPARATE star armed from some earlier, unrelated tap must not
            // silently re-close (and so erase) the pair just drawn.
          }
          // Up on empty space: cancel — nothing drawn, and (per clearGesture,
          // already run) nothing left armed by this gesture either.
        } else if (missedEdge) {
          // Started on empty space, on top of a drawn segment: the undo IS
          // the click, wherever the pointer lets go.
          drawn = toggleEdge(drawn, missedEdge);
          armed = null;
        }

        counter.textContent = connectProgress(drawn.length, key.edges.length);
        renderMarks();
        updateBand();
      });

      const onPointerEnd = (e: PointerEvent): void => {
        if (settled || e.pointerId !== gesturePointerId) return;
        clearGesture();
        updateBand();
      };
      gate.addEventListener("pointercancel", onPointerEnd);
      // Belt and braces beside the pointerup/pointercancel handlers above,
      // which already clear the gesture on every normal ending: if capture
      // is ever lost WITHOUT either of those firing first (a real device
      // hiccup, not the ordinary release-capture that follows a handled
      // pointerup), this still resets gesturePointerId rather than leaving
      // the gate stuck refusing every further press.
      gate.addEventListener("lostpointercapture", onPointerEnd);

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
      positionStars();
      renderMarks();
    });
}
