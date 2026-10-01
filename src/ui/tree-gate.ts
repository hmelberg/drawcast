// The tree gate (spec 2026-10-03 §4): the viewer answers on the decision
// tree itself —
//
//   blanks  each "?" wears a dashed ring; a tap opens a field next to it
//           (under it, else above or beside — never over the label it
//           asks about), and the "?" shows what is typed as it is typed
//           (Enter takes the number and moves to the next "?")
//   pick    once the blanks are filled (at once when there are none), the
//           decision's branches answer a tap; the branch under the pointer,
//           and the one picked, are lit along their own line
//
// One blank and no pick: Enter answers. Otherwise the Answer button does
// (a pick tap answers once every blank is filled). Typed numbers paint into
// the tree as they are taken (TreeSession.show). Keys: Tab / Shift-Tab move
// between the blanks, Enter answers, 1–4 pick an option.

import type { RenderHandle } from "../render";
import type { TreeSession } from "../render/player";
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import { encodeTreeAnswer, parseTreeBlankNumber } from "../tree/blanks";
import { clientPointFor, h } from "./dom";
import { mountGateDock, type GateDock } from "./gate-dock";
import { mountNumberEdit } from "./number-edit";
import type { AskGateStep } from "./controls";
import { keysBelongElsewhere } from "./gates";

/** How near (px) a tap must land to a branch line to pick it. */
const EDGE_HIT_PX = 18;
/** A blank's box grows by this (logical) for its ring and its tap target. */
const BLANK_PAD = 6;

/** Distance from p to the polyline, all in client px. */
function polylineDistance(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return best;
}

export function treeGateFor(stage: HTMLElement, _hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      const session = step.treeSession as TreeSession | undefined;
      if (!session) {
        resolve(null);
        return;
      }
      stage.querySelector(".cs-figgate")?.remove();
      const { blanks, pick } = session;
      const values: (number | null)[] = blanks.map(() => null);
      let chosen: string | null = null;
      let settled = false;
      let field: { close: () => void; reposition: () => void } | null = null;
      let fieldAt = -1;
      /** Set by Enter in the field: its commit moves on (a blur's does not). */
      let advance = false;
      const oneShot = blanks.length === 1 && !pick;
      const filled = (): boolean => values.every((v) => v !== null);
      const pickOpen = (): boolean => pick !== null && filled();

      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, blanks.length > 0 ? "Tap a ? and type the number" : "Tap the best branch");
      const answer = h("button", { class: "cs-cardgate-pill cs-guess-answer", type: "button" }, "Answer ▸");
      answer.hidden = oneShot || blanks.length === 0;
      const rings = blanks.map(() => h("div", { class: "cs-tree-blank" }));
      // A branch is lit along its own line (a thick translucent stroke), not
      // boxed: the hovered one, and the one picked.
      const SVG_NS = "http://www.w3.org/2000/svg";
      const edgeLayer = document.createElementNS(SVG_NS, "svg");
      edgeLayer.setAttribute("class", "cs-tree-edges");
      edgeLayer.setAttribute("aria-hidden", "true");
      const edgeRing = document.createElementNS(SVG_NS, "polyline");
      edgeRing.setAttribute("class", "cs-tree-edge");
      const pickRing = document.createElementNS(SVG_NS, "polyline");
      pickRing.setAttribute("class", "cs-tree-edge cs-tree-picked");
      edgeLayer.append(pickRing, edgeRing);
      const gate = h("div", { class: "cs-figgate cs-guessgate cs-treegate" }, ...rings);
      gate.appendChild(edgeLayer);
      let dock: GateDock | null = null;
      const docked: HTMLElement[] = [hint, answer];

      const padded = (b: BBox, pad: number): BBox => ({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad });
      /** Put a ring div over a logical box (y-up). */
      const placeOver = (el: HTMLElement, b: BBox | null): void => {
        const a = b ? clientPointFor(stage, [b.x, b.y + b.h]) : null;
        const z = b ? clientPointFor(stage, [b.x + b.w, b.y]) : null;
        el.hidden = !a || !z;
        if (a && z) Object.assign(el.style, { left: `${a[0]}px`, top: `${a[1]}px`, width: `${z[0] - a[0]}px`, height: `${z[1] - a[1]}px` });
      };
      /** Light a branch along its line (null: none). */
      const lightEdge = (line: SVGPolylineElement, pts: Pt[] | null): void => {
        const client = pts ? pts.map((p) => clientPointFor(stage, p)).filter((p): p is [number, number] => p !== null) : [];
        if (client.length < 2) {
          line.setAttribute("points", "");
          line.style.display = "none";
          return;
        }
        line.setAttribute("points", client.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "));
        line.style.display = "";
      };
      const placeRings = (): void => {
        blanks.forEach((b, i) => {
          const box = session.boxOf(b.part);
          placeOver(rings[i], box ? padded(box, BLANK_PAD) : null);
          rings[i].classList.toggle("filled", values[i] !== null);
          rings[i].classList.toggle("active", i === fieldAt);
        });
        lightEdge(pickRing, chosen !== null ? (session.edges[chosen] ?? null) : null);
        field?.reposition();
      };

      const finish = (result: string | null): void => {
        if (settled) return;
        settled = true;
        field?.close();
        signal.removeEventListener("abort", onAbort);
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("resize", placeRings);
        dock?.dispose();
        gate.remove();
        resolve(result);
      };
      const onAbort = (): void => finish(null);
      /** Take what the open field holds (a blur commits a good number, drops a bad one). */
      const commitField = (): void => {
        stage.querySelector<HTMLInputElement>("input.cs-numedit")?.blur();
        field?.close();
        field = null;
      };
      const submit = (): void => {
        commitField();
        finish(encodeTreeAnswer(values, chosen));
      };

      /** Everything asked is given: every blank, and the pick if there is one. */
      const ready = (): boolean => filled() && (pick === null || chosen !== null);
      const nudgePick = (): void => {
        hint.textContent = "Now tap the best branch";
        hint.classList.remove("cs-figgate-next");
        void hint.offsetWidth;
        hint.classList.add("cs-figgate-next");
      };
      /** After a blank is taken with Enter: the next empty one, else on to the pick or the answer. */
      const moveOn = (from: number): void => {
        for (let k = 1; k <= blanks.length; k++) {
          const j = (from + k) % blanks.length;
          if (values[j] === null) {
            open(j);
            return;
          }
        }
        if (oneShot) {
          submit();
          return;
        }
        if (pick && chosen === null) {
          nudgePick();
          return;
        }
        answer.focus();
      };
      const open = (i: number): void => {
        if (settled || i < 0 || i >= blanks.length) return;
        commitField();
        const box = session.boxOf(blanks[i].part);
        if (!box) return;
        fieldAt = i;
        const mounted = mountNumberEdit(stage, {
          box,
          value: values[i] ?? NaN,
          label: blanks[i].label,
          text: true,
          // The full keyboard, as the formula gate: a decimal pad has no
          // minus key (a net benefit can be negative) and no currency or "%".
          inputmode: "text",
          // Next to the "?", never over the label it asks about.
          place: "near",
          // The "?" shows the number as it is typed (a bad one: "?" again).
          onInput: (text) => {
            const live = values.slice();
            live[i] = parseTreeBlankNumber(text, blanks[i].kind);
            session.show(live);
          },
          onCommit: (text) => {
            const v = parseTreeBlankNumber(text, blanks[i].kind);
            if (v === null) {
              advance = false;
              return "Type a number";
            }
            values[i] = v;
            session.show(values);
            const go = advance;
            advance = false;
            if (fieldAt === i) {
              fieldAt = -1;
              field = null;
            }
            // After the field is gone (the commit runs inside its finish).
            window.setTimeout(() => {
              placeRings();
              if (go && !settled) moveOn(i);
            }, 0);
            return null;
          },
          onCancel: () => {
            advance = false;
            // What was typed is not taken: the tree shows what was.
            session.show(values);
            if (fieldAt === i) {
              fieldAt = -1;
              field = null;
            }
            placeRings();
          },
        });
        field = mounted;
        placeRings();
      };

      /** The option whose branch line is within reach of a client point. */
      const edgeNear = (cx: number, cy: number): string | null => {
        if (!pick) return null;
        let best: string | null = null;
        let bestD = EDGE_HIT_PX;
        for (const o of pick.options) {
          const pts = session.edges[o.id];
          if (!pts) continue;
          const client = pts.map((p) => clientPointFor(stage, p)).filter((p): p is [number, number] => p !== null);
          const d = polylineDistance([cx, cy], client);
          if (d <= bestD) {
            bestD = d;
            best = o.id;
          }
        }
        return best;
      };
      const choose = (id: string): void => {
        chosen = id;
        lightEdge(edgeRing, null);
        placeRings();
        if (filled()) window.setTimeout(() => !settled && submit(), 250);
      };

      // —— pointer ——
      gate.addEventListener("pointerdown", (e) => {
        if (settled || (e.target as Element).closest("button")) return;
        e.preventDefault();
        e.stopPropagation();
        // A "?" under the tap opens its field.
        const hit = rings.findIndex((r) => {
          if (r.hidden) return false;
          const rr = r.getBoundingClientRect();
          return e.clientX >= rr.left && e.clientX <= rr.right && e.clientY >= rr.top && e.clientY <= rr.bottom;
        });
        if (hit >= 0) {
          open(hit);
          return;
        }
        if (pickOpen()) {
          const sr = stage.getBoundingClientRect();
          const id = edgeNear(e.clientX - sr.left, e.clientY - sr.top);
          if (id !== null) choose(id);
        }
      });
      gate.addEventListener("pointermove", (e) => {
        e.stopPropagation();
        if (settled || !pickOpen()) return;
        const sr = stage.getBoundingClientRect();
        const id = edgeNear(e.clientX - sr.left, e.clientY - sr.top);
        lightEdge(edgeRing, id === null || id === chosen ? null : (session.edges[id] ?? null));
        gate.style.cursor = id !== null ? "pointer" : "";
      });
      gate.addEventListener("click", (e) => e.stopPropagation());

      // —— keys ——
      const onKey = (e: KeyboardEvent): void => {
        if (settled) return;
        const target = e.target as Element | null;
        const inField = target?.classList?.contains("cs-numedit") === true;
        // Another control has the keys (the tray, a text box; the Answer
        // button's Enter is its own click): only the blank's own field is
        // this gate's — and not the Play button that kept the focus.
        if (!inField && keysBelongElsewhere(e.target, e.key)) return;
        if (e.key === "Tab" && blanks.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          const from = fieldAt >= 0 ? fieldAt : e.shiftKey ? 0 : -1;
          open((from + (e.shiftKey ? blanks.length - 1 : 1) + blanks.length) % blanks.length);
          return;
        }
        if (inField) {
          // The field's own Enter commits; this one only says "then move on".
          if (e.key === "Enter") advance = true;
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (blanks.length > 0 && !filled() && fieldAt < 0) open(values.findIndex((v) => v === null));
          else if (ready()) submit();
          else if (pick && chosen === null && filled()) nudgePick();
          return;
        }
        const digit = /^[1-9]$/.test(e.key) ? Number(e.key) : null;
        if (digit !== null && pickOpen() && digit <= pick!.options.length) {
          e.preventDefault();
          choose(pick!.options[digit - 1].id);
        }
      };

      answer.addEventListener("click", (e) => {
        e.stopPropagation();
        commitField();
        // A pick still to make: say so, rather than answer without it.
        if (pick && chosen === null && filled()) nudgePick();
        else submit();
      });
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", type: "button" }, "Skip ▸");
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          finish(null);
        });
        docked.push(skip);
      }
      signal.addEventListener("abort", onAbort);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("resize", placeRings);
      stage.appendChild(gate);
      dock = mountGateDock(stage, gate, docked, placeRings);
      lightEdge(edgeRing, null);
      dock.relayout();
      // The first "?" is open at once: the question is about it.
      if (blanks.length > 0) open(0);
    });
}
