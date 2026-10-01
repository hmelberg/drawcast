// The formula gate (design 2026-10-03 §5.3): the viewer types into a
// formula's blank boxes —
//
//   a number blank      a tap on its box opens a number field over it
//   any other blank     a tap opens a text field under the box, read the
//                       AsciiMath way (`pi r^2`, `2r`, `sqrt(x)`); as they
//                       type, the answer is drawn in the box (show), so they
//                       see it read as meant. A field that does not parse is
//                       marked, with the reason as its title. A row of keys
//                       above it gives ^ √ π / ( ) for phones.
//
// Enter moves to the next blank, or answers at the last (or only) one; with
// several blanks the Answer button answers too. Tab / Shift-Tab move between
// the blanks. Resolves JSON.stringify(texts) — one typed text (or null) per
// blank — or null for a skip. (Tiles go through the cards gate, fill mode.)

import type { RenderHandle } from "../render";
import type { FormulaSession } from "../render/player";
import type { BBox } from "../layout/geometry";
import { blankIsNumber } from "../formula/blanks";
import { parseAscii } from "../formula/expr";
import { parseBlankNumber } from "../tree/blanks";
import { clientPointFor, h } from "./dom";
import { mountNumberEdit, placeOverBox } from "./number-edit";
import type { AskGateStep } from "./controls";

/** A blank's box grows by this (logical) for its ring and its tap target. */
const BLANK_PAD = 6;
/** The keys a phone keyboard hides: what each inserts. */
const KEYS: [string, string][] = [["^", "^"], ["√", "√("], ["π", "π"], ["/", "/"], ["(", "("], [")", ")"]];

export function formulaGateFor(stage: HTMLElement, _hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
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

      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, single ? (blankIsNumber(blanks[0]) ? "Tap the box and type the number" : "Tap the box and type what goes in it") : "Tap a box and type what goes in it");
      const answer = h("button", { class: "cs-cardgate-pill cs-guess-answer", type: "button" }, "Answer ▸");
      answer.hidden = single;
      const rings = blanks.map(() => h("div", { class: "cs-tree-blank" }));
      const gate = h("div", { class: "cs-figgate cs-guessgate cs-formulagate" }, hint, answer, ...rings);

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
        else submit();
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
        const typed = (): void => {
          texts[k] = input.value;
          const ok = session.show(texts)[k];
          const parsed = input.value.trim() === "" ? null : parseAscii(input.value);
          const error = parsed && "error" in parsed ? parsed.error : null;
          input.classList.toggle("invalid", !ok);
          if (!ok && error) input.title = error;
          else input.removeAttribute("title");
          rings[k].classList.toggle("filled", input.value.trim() !== "");
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
        const wrap = h("div", { class: "cs-formula-edit" }, keys, input);
        const reposition = (): void => {
          // Under the box, so the answer drawn in it stays in sight.
          if (placeOverBox(stage, wrap, box, { minEm: 10, below: 10 })) wrap.style.height = "auto";
        };
        input.addEventListener("input", typed);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
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
            onCommit: (text) => {
              if (text.trim() !== "" && parseBlankNumber(text) === null) {
                advance = false;
                return "Type a number";
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
        // Another control has the keys (the tray, a text box, a button): only
        // the blank's own field is this gate's.
        if (!inNumber && !inText && target?.closest?.("input, textarea, select, button, [contenteditable]")) return;
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
          else submit();
        }
      };

      answer.addEventListener("click", (e) => {
        e.stopPropagation();
        submit();
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
      window.addEventListener("resize", placeRings);
      stage.appendChild(gate);
      placeRings();
      // The first box is open at once: the question is about it.
      open(0);
    });
}
