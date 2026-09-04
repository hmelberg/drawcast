// The keyboard half of the script editors: Tab indents, Shift-Tab takes a
// level off, Enter keeps the block, and a small word list follows the caret.
// Attached to BOTH text areas — the card lying on the panel and the tray's
// copy — because "two doors, one editor" has to include how it feels to type.
//
// The rules themselves are pure (ui/code-complete.ts); this file is the DOM:
// key routing, the popup, and where the caret is in pixels. The popup is
// position: fixed on the document, so it is never clipped by the card's box
// or the tray's scroll — and it closes on blur, scroll and resize rather than
// trying to follow them.
//
// Edits go through execCommand("insertText") when the browser still offers it,
// because that is what keeps ctrl-Z working: splicing .value by hand wipes the
// text area's own undo stack. The manual splice is the fallback.

import { knownMicrodataVariables } from "../code/vocabulary";
import { completionsFor, enterEdit, indentWidth, tabEdit, type Completion, type TextEdit } from "./code-complete";
import { h } from "./dom";

/** Apply an edit, keeping native undo where the browser allows it. */
function applyEdit(area: HTMLTextAreaElement, edit: TextEdit): void {
  area.focus();
  area.setSelectionRange(edit.start, edit.end);
  let ok = false;
  try {
    ok = document.execCommand("insertText", false, edit.text);
  } catch {
    ok = false;
  }
  if (!ok) {
    area.value = area.value.slice(0, edit.start) + edit.text + area.value.slice(edit.end);
  }
  area.setSelectionRange(edit.selStart, edit.selEnd);
  area.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Width of one character in the area's (monospace) font, measured once per
 *  font string — the whole caret geometry rests on the type being fixed-pitch,
 *  which is what both script areas are. */
const charWidths = new Map<string, number>();
function charWidth(cs: CSSStyleDeclaration): number {
  const key = `${cs.fontSize} ${cs.fontFamily}`;
  const hit = charWidths.get(key);
  if (hit !== undefined) return hit;
  const probe = h("span", {});
  probe.style.cssText = `position:fixed;visibility:hidden;white-space:pre;font-size:${cs.fontSize};font-family:${cs.fontFamily}`;
  probe.textContent = "0".repeat(20);
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 20;
  probe.remove();
  const width = w > 0 ? w : parseFloat(cs.fontSize) * 0.6;
  charWidths.set(key, width);
  return width;
}

/** Where the caret is on the page, and how tall its line is. */
function caretPoint(area: HTMLTextAreaElement): { x: number; y: number; lineHeight: number } {
  const cs = getComputedStyle(area);
  const before = area.value.slice(0, area.selectionStart ?? 0);
  const rows = before.split("\n");
  const col = rows[rows.length - 1].length;
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
  const r = area.getBoundingClientRect();
  return {
    x: r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) + col * charWidth(cs) - area.scrollLeft,
    y: r.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth) + (rows.length - 1) * lineHeight - area.scrollTop,
    lineHeight,
  };
}

export interface CodeTyping {
  /** True while the popup is up — the card asks, so its own Escape (close the
   *  editor) never fires on the Escape that dismisses a list. */
  suggesting(): boolean;
  detach(): void;
}

/**
 * Wire one text area. `language` decides the indent width and which word list
 * is offered; everything else is the same for both surfaces.
 */
export function attachCodeTyping(area: HTMLTextAreaElement, opts: { language: string }): CodeTyping {
  const width = indentWidth(opts.language);
  let pop: HTMLElement | null = null;
  let items: Completion[] = [];
  let range: { start: number; end: number } | null = null;
  let index = 0;

  const hide = (): void => {
    pop?.remove();
    pop = null;
    items = [];
    range = null;
    index = 0;
  };

  const accept = (i: number): void => {
    const word = items[i]?.word;
    if (!word || !range) return;
    const { start, end } = range;
    hide();
    applyEdit(area, { start, end, text: word, selStart: start + word.length, selEnd: start + word.length });
  };

  const paint = (): void => {
    if (!pop) return;
    pop.replaceChildren(
      ...items.map((c, i) => {
        const row = h("button", { class: `cs-suggest-row${i === index ? " active" : ""}`, type: "button" },
          h("span", { class: "cs-suggest-word" }, c.word),
          h("span", { class: "cs-suggest-kind" }, c.kind === "local" ? "in this script" : c.kind),

        );
        // mousedown, not click: it must beat the text area's blur.
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          accept(i);
        });
        return row;
      }),
    );
    const { x, y, lineHeight } = caretPoint(area);
    pop.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 220))}px`;
    // Below the caret's line, or above it when the page has no room below.
    const height = pop.getBoundingClientRect().height || items.length * 22;
    const below = y + lineHeight + 2;
    pop.style.top = `${below + height > window.innerHeight - 4 ? Math.max(4, y - height - 2) : below}px`;
  };

  const refresh = (force = false): void => {
    // The catalogue's variable names, if a microdata script has run in this
    // session (reading them never starts a runtime — an empty list until then).
    const variables = opts.language === "microdata" ? knownMicrodataVariables() : undefined;
    const found = completionsFor({ text: area.value, caret: area.selectionStart ?? 0, language: opts.language, variables, force });
    if (!found) return hide();
    items = found.items;
    range = { start: found.start, end: found.end };
    index = 0;
    if (!pop) {
      pop = h("div", { class: "cs-suggest", role: "listbox" });
      // In fullscreen ONLY descendants of the fullscreen element are painted,
      // so the list has to move in there with the figure — position: fixed
      // still measures against the viewport, which is what it covers.
      (document.fullscreenElement ?? document.body).appendChild(pop);
    }
    paint();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (pop) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        index = (index + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        paint();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        accept(index);
        return;
      }
      if (e.key === "Escape") {
        // The list goes, the editor stays: this Escape is spent here, so the
        // card's own "Escape closes me" must not also see it.
        e.preventDefault();
        e.stopImmediatePropagation();
        hide();
        return;
      }
    }
    if (e.key === " " && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      refresh(true);
      return;
    }
    if (e.key === "Tab") {
      // A code area keeps Tab. Escape first, then Tab, to leave the field.
      e.preventDefault();
      const edit = tabEdit(area.value, area.selectionStart ?? 0, area.selectionEnd ?? 0, width, e.shiftKey);
      if (edit) applyEdit(area, edit);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      applyEdit(area, enterEdit(area.value, area.selectionStart ?? 0, area.selectionEnd ?? 0, width, opts.language));
      return;
    }
  };

  const onInput = (): void => refresh();
  const onBlur = (): void => {
    window.setTimeout(hide, 150); // after a row's mousedown has had its turn
  };
  const onScroll = (): void => hide();

  area.addEventListener("keydown", onKeyDown);
  area.addEventListener("input", onInput);
  area.addEventListener("blur", onBlur);
  area.addEventListener("scroll", onScroll);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  // Entering or leaving fullscreen moves the whole figure into another
  // painting context: cheaper to close the list than to chase it.
  document.addEventListener("fullscreenchange", onScroll);

  return {
    suggesting: () => pop !== null,
    detach: () => {
      hide();
      area.removeEventListener("keydown", onKeyDown);
      area.removeEventListener("input", onInput);
      area.removeEventListener("blur", onBlur);
      area.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("fullscreenchange", onScroll);
    },
  };
}
