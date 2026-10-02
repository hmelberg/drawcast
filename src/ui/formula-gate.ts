// The formula gate (design 2026-10-03 §5.3): the viewer types into a
// formula's blank boxes —
//
//   a number blank      a tap on its box opens a number field next to the
//                       formula (under it, else above or beside — never
//                       over it); the box shows the number as it is typed
//   any other blank     a tap opens a text field next to the formula, read
//                       the AsciiMath way (`pi r^2`, `2r`, `sqrt(x)`); as
//                       they type, the answer is drawn in the box (show), so
//                       they see it read as meant. A field that does not
//                       parse is marked, with the reason said under it, and
//                       Enter does not take it. A row of keys under it gives
//                       ^ √ π / ( ) for phones (touch-sized).
//
// Enter moves to the next blank, or answers at the last (or only) one; with
// several blanks — or one and `release: false` — the Answer button answers
// (then Enter at the last blank only takes the field). Tab / Shift-Tab move between
// the blanks. Resolves JSON.stringify(texts) — one typed text (or null) per
// blank — or null for a skip. (Tiles go through the cards gate, fill mode.)

import type { RenderHandle } from "../render";
import type { FormulaSession } from "../render/player";
import type { BBox } from "../layout/geometry";
import { blankIsNumber } from "../formula/blanks";
import { parseAscii } from "../formula/expr";
import { parseBlankNumber } from "../tree/blanks";
import { clientPointFor, h } from "./dom";
import { mountGateDock, type GateDock } from "./gate-dock";
import { mountNumberEdit, placeNearBox, type StageRect } from "./number-edit";
import type { AskGateStep } from "./controls";
import { keysBelongElsewhere } from "./gates";
import { gateLangOf, gateWords } from "./gate-words";

/** A blank's box grows by this (logical) for its ring and its tap target. */
const BLANK_PAD = 6;
/** The keys a phone keyboard hides: what each inserts. */
const KEYS: [string, string][] = [["^", "^"], ["√", "√("], ["π", "π"], ["/", "/"], ["(", "("], [")", ")"]];

export function formulaGateFor(stage: HTMLElement, hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      const words = gateWords(gateLangOf(hd));
      const session = step.formulaSession as FormulaSession | undefined;
      if (!session) {
        resolve(null);
        return;
      }
      stage.querySelector(".cs-figgate")?.remove();
      const { blanks } = session;
      const texts: (string | null)[] = blanks.map(() => null);
      let settled = false;
      let fieldAt = -1;
      let field: { close: () => void; reposition: () => void } | null = null;
      /** Set by Enter in a number field: its commit moves on (a blur's does not). */
      let advance = false;
      const single = blanks.length === 1;
      // One blank answers on Enter, unless the ask says release: false —
      // then Enter only takes the field, and the Answer button answers.
      const enterAnswers = !(single && step.release === false);

      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, single ? (blankIsNumber(blanks[0]) ? words.formula.number : words.formula.one) : words.formula.many);
      const answer = h("button", { class: "cs-cardgate-pill cs-guess-answer", type: "button" }, words.answer);
      answer.hidden = single && enterAnswers;
      const rings = blanks.map(() => h("div", { class: "cs-tree-blank" }));
      const gate = h("div", { class: "cs-figgate cs-guessgate cs-formulagate" }, ...rings);
      let dock: GateDock | null = null;
      const docked: HTMLElement[] = [hint, answer];

      /** The whole formula blank k sits in, in stage px: its glyphs and its
       *  boxes (data-leaf-id `<id>__…` and `<id>_blank_…`), so a field keeps
       *  clear of all of it — a fraction's "dx" under the box too. */
      const inkOf = (k: number): StageRect | null => {
        const svg = stage.querySelector("svg.cs-svg");
        if (!svg) return null;
        const id = blanks[k].part.replace(/_blank_\d+$/, "");
        const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
        const sr = stage.getBoundingClientRect();
        let out: StageRect | null = null;
        svg.querySelectorAll(`[data-leaf-id^="${esc}__"], [data-leaf-id^="${esc}_blank_"]`).forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          const q = { left: r.left - sr.left, top: r.top - sr.top, right: r.right - sr.left, bottom: r.bottom - sr.top };
          out = out ? { left: Math.min(out.left, q.left), top: Math.min(out.top, q.top), right: Math.max(out.right, q.right), bottom: Math.max(out.bottom, q.bottom) } : q;
        });
        return out;
      };

      const padded = (b: BBox): BBox => ({ x: b.x - BLANK_PAD, y: b.y - BLANK_PAD, w: b.w + 2 * BLANK_PAD, h: b.h + 2 * BLANK_PAD });
      const placeRings = (): void => {
        blanks.forEach((_, k) => {
          const box = session.boxOf(k);
          const a = box ? clientPointFor(stage, [box.x - BLANK_PAD, box.y + box.h + BLANK_PAD]) : null;
          const z = box ? clientPointFor(stage, [box.x + box.w + BLANK_PAD, box.y - BLANK_PAD]) : null;
          rings[k].hidden = !a || !z;
          if (a && z) Object.assign(rings[k].style, { left: `${a[0]}px`, top: `${a[1]}px`, width: `${z[0] - a[0]}px`, height: `${z[1] - a[1]}px` });
          rings[k].classList.toggle("filled", (texts[k] ?? "").trim() !== "");
          rings[k].classList.toggle("active", k === fieldAt);
        });
        field?.reposition();
      };

      const closeField = (): void => {
        // A number field's blur commits a good number and drops a bad one.
        stage.querySelector<HTMLInputElement>("input.cs-numedit")?.blur();
        field?.close();
        field = null;
        fieldAt = -1;
      };
      const finish = (result: string | null): void => {
        if (settled) return;
        settled = true;
        closeField();
        signal.removeEventListener("abort", onAbort);
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("resize", placeRings);
        dock?.dispose();
        gate.remove();
        resolve(result);
      };
      const onAbort = (): void => finish(null);
      const submit = (): void => {
        closeField();
        finish(JSON.stringify(texts));
      };
      /** Enter on blank k: the next one, or the answer at the last. */
      const next = (k: number): void => {
        if (k + 1 < blanks.length) open(k + 1);
        else if (enterAnswers) submit();
        else {
          closeField();
          placeRings();
          answer.focus();
        }
      };

      /** The text field of a blank that is not a plain number. */
      const mountTextField = (k: number, box: BBox): { close: () => void; reposition: () => void } => {
        const input = h("input", {
          type: "text",
          class: "cs-formula-field",
          inputmode: "text",
          autocapitalize: "off",
          autocomplete: "off",
          spellcheck: "false",
          "aria-label": `Blank ${k + 1}`,
          value: texts[k] ?? "",
        }) as HTMLInputElement;
        const message = h("div", { class: "cs-formula-error", role: "alert" });
        message.hidden = true;
        let valid = true;
        const typed = (): void => {
          texts[k] = input.value;
          const ok = session.show(texts)[k];
          const parsed = input.value.trim() === "" ? null : parseAscii(input.value);
          const error = parsed && "error" in parsed ? parsed.error : null;
          valid = ok || input.value.trim() === "";
          input.classList.toggle("invalid", !valid);
          input.setAttribute("aria-invalid", String(!valid));
          if (!valid) input.title = error ?? "Not a formula yet";
          else input.removeAttribute("title");
          // Said once Enter is pressed on it; typing on takes it back.
          message.hidden = true;
          rings[k].classList.toggle("filled", input.value.trim() !== "");
          rings[k].classList.toggle("invalid", !valid);
        };
        const keys = h(
          "div",
          { class: "cs-formula-keys" },
          ...KEYS.map(([label, insert]) => {
            const b = h("button", { type: "button", class: "cs-formula-key", "aria-label": `Type ${label}` }, label);
            // Keep the caret in the field: no focus moves to the key.
            b.addEventListener("pointerdown", (e) => {
              e.preventDefault();
              e.stopPropagation();
            });
            b.addEventListener("click", (e) => {
              e.stopPropagation();
              const s = input.selectionStart ?? input.value.length;
              const t = input.selectionEnd ?? s;
              input.setRangeText(insert, s, t, "end");
              input.focus();
              typed();
            });
            return b;
          }),
        );
        // The field first (nearest the box it previews in), then what is
        // wrong with it, then the keys.
        const wrap = h("div", { class: "cs-formula-edit" }, input, message, keys);
        const reposition = (): void => {
          // Next to the whole formula, so the answer drawn in it stays in sight.
          placeNearBox(stage, wrap, box, { minEm: 10, avoid: inkOf(k), measure: true });
        };
        input.addEventListener("input", typed);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            // Half a formula ("√(") is not an answer: say why, stay open.
            if (!valid) {
              const why = input.title || "Not a formula yet";
              message.textContent = `${why.charAt(0).toUpperCase()}${why.slice(1)}: finish it, or press Escape`;
              message.hidden = false;
              reposition();
              e.stopPropagation();
              return;
            }
            next(k);
          } else if (e.key === "Escape") {
            e.preventDefault();
            closeField();
            placeRings();
          }
          // The player's own keys (space, arrows) are not this field's.
          if (e.key !== "Tab") e.stopPropagation();
        });
        input.addEventListener("keyup", (e) => e.stopPropagation());
        for (const type of ["pointerdown", "click", "wheel"] as const) wrap.addEventListener(type, (e) => e.stopPropagation());
        stage.appendChild(wrap);
        reposition();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        return { close: () => wrap.remove(), reposition };
      };

      const open = (k: number): void => {
        if (settled || k < 0 || k >= blanks.length) return;
        closeField();
        const box = session.boxOf(k);
        if (!box) return;
        fieldAt = k;
        if (blankIsNumber(blanks[k])) {
          const v = texts[k] !== null ? parseBlankNumber(texts[k]!) : null;
          field = mountNumberEdit(stage, {
            box: padded(box),
            value: v ?? NaN,
            label: `Blank ${k + 1}`,
            text: true,
            // Next to the whole formula, never over it; the box shows the number as typed.
            place: "near",
            avoid: () => inkOf(k),
            onInput: (text) => {
              const live = texts.slice();
              live[k] = text.trim() === "" ? null : text;
              session.show(live);
            },
            // The full keyboard: a decimal pad has no minus key (and a pad
            // only for negative answers would give the sign away).
            inputmode: "text",
            onCommit: (text) => {
              if (text.trim() !== "" && parseBlankNumber(text) === null) {
                advance = false;
                return words.typeNumber;
              }
              texts[k] = text.trim() === "" ? null : text;
              session.show(texts);
              const go = advance;
              advance = false;
              if (fieldAt === k) {
                fieldAt = -1;
                field = null;
              }
              // After the field is gone (the commit runs inside its finish).
              window.setTimeout(() => {
                placeRings();
                if (go && !settled) next(k);
              }, 0);
              return null;
            },
            onCancel: () => {
              advance = false;
              session.show(texts);
              if (fieldAt === k) {
                fieldAt = -1;
                field = null;
              }
              placeRings();
            },
          });
        } else field = mountTextField(k, box);
        placeRings();
      };

      // —— pointer: a tap on a box opens its field ——
      gate.addEventListener("pointerdown", (e) => {
        if (settled || (e.target as Element).closest("button")) return;
        e.preventDefault();
        e.stopPropagation();
        const hit = rings.findIndex((r) => {
          if (r.hidden) return false;
          const rr = r.getBoundingClientRect();
          return e.clientX >= rr.left && e.clientX <= rr.right && e.clientY >= rr.top && e.clientY <= rr.bottom;
        });
        if (hit >= 0) open(hit);
      });
      gate.addEventListener("pointermove", (e) => e.stopPropagation());
      gate.addEventListener("click", (e) => e.stopPropagation());

      // —— keys ——
      const onKey = (e: KeyboardEvent): void => {
        if (settled) return;
        const target = e.target as Element | null;
        const inNumber = target?.classList?.contains("cs-numedit") === true;
        const inText = target?.classList?.contains("cs-formula-field") === true;
        // Another control has the keys (the tray, a text box; a gate
        // button's Enter is its own click): only the blank's own field is
        // this gate's — and not the Play button that kept the focus.
        if (!inNumber && !inText && keysBelongElsewhere(e.target, e.key)) return;
        if (e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          const from = fieldAt >= 0 ? fieldAt : e.shiftKey ? 0 : -1;
          open((from + (e.shiftKey ? blanks.length - 1 : 1) + blanks.length) % blanks.length);
          return;
        }
        if (inNumber) {
          // The field's own Enter commits; this one only says "then move on".
          if (e.key === "Enter") advance = true;
          return;
        }
        if (inText) return;
        if (e.key === "Enter") {
          e.preventDefault();
          const empty = texts.findIndex((t) => (t ?? "").trim() === "");
          if (empty >= 0) open(empty);
          else if (enterAnswers) submit();
          else answer.focus();
        }
      };

      answer.addEventListener("click", (e) => {
        e.stopPropagation();
        submit();
      });
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
      window.addEventListener("resize", placeRings);
      stage.appendChild(gate);
      dock = mountGateDock(stage, gate, docked, placeRings);
      dock.relayout();
      // The first box is open at once: the question is about it.
      open(0);
    });
}
