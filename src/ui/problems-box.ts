// The Problems note under a cast that arrived inside its link (#cast=, and so
// every cast played from #paste). The person holding the link usually did not
// write the cast — an AI did, with the drawcast skill — so the note is for
// handing back: a quiet, collapsed list of what the app found (why it could
// not be read, validation errors, lint warnings with element ids) and a
// "Copy for your AI" button that puts the same list on the clipboard as plain
// text. A clean cast shows nothing at all.
//
// problemsText is pure and tested (tests/problems-box.test.ts); problemsBox
// builds the DOM.

import type { ItemLintIssue } from "../lint/check-playlist";
import { h } from "./dom";

export interface CastProblems {
  /** Why the cast could not be read or played at all (a bad link, unparseable text, a missing template). */
  fatal?: string;
  /** validateSpec errors, already prefixed "item N: " when there is more than one item. */
  errors: string[];
  /** The playlist reader's own warnings (ignored settings). */
  warnings: string[];
  lint: ItemLintIssue[];
  /** Items in the playlist: item numbers are shown only when there is more than one. */
  items: number;
}

export function emptyProblems(): CastProblems {
  return { errors: [], warnings: [], lint: [], items: 0 };
}

export function problemCount(p: CastProblems): number {
  return (p.fatal ? 1 : 0) + p.errors.length + p.warnings.length + p.lint.length;
}

/** One lint issue as a line: "[warn] rule (ids: a, b): message", item-prefixed when it matters. */
export function lintLine(issue: ItemLintIssue, items: number): string {
  const where = items > 1 ? `item ${issue.item + 1}: ` : "";
  const ids = issue.ids.length ? ` (ids: ${issue.ids.join(", ")})` : "";
  return `${where}[${issue.severity}] ${issue.rule}${ids}: ${issue.message}`;
}

/** Lint errors first: they are the defects; warnings are advice. Stable otherwise. */
function errorsFirst(lint: ItemLintIssue[]): ItemLintIssue[] {
  return [...lint].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

/** The plain text "Copy for your AI" puts on the clipboard. "" for a clean cast. */
export function problemsText(p: CastProblems): string {
  if (problemCount(p) === 0) return "";
  const out: string[] = ["drawcast.app found problems in this drawcast. Please fix the cast and give me a new link.", ""];
  if (p.fatal) out.push("It could not be played:", `- ${p.fatal}`, "");
  if (p.errors.length) out.push("Validation errors (the cast does not play until these are fixed):", ...p.errors.map((e) => `- ${e}`), "");
  if (p.warnings.length) out.push("Document warnings:", ...p.warnings.map((w) => `- ${w}`), "");
  if (p.lint.length) out.push("Lint (layout and teaching checks, with the element ids):", ...errorsFirst(p.lint).map((i) => `- ${lintLine(i, p.items)}`), "");
  return out.join("\n").trimEnd() + "\n";
}

/** Lines shown on screen before the rest is left to the copied text. */
const SHOWN = 40;

export interface ProblemsBox {
  root: HTMLElement;
  /** Replace what the box shows; hidden when there is nothing. */
  show(p: CastProblems): void;
}

export function problemsBox(): ProblemsBox {
  const summary = h("summary", { class: "cast-problems-summary" });
  const list = h("ul", { class: "cast-problems-list" });
  const copy = h("button", { type: "button", class: "cast-problems-copy", title: "Copy the problems as plain text, to paste back to the AI that wrote this drawcast" }, "Copy for your AI") as HTMLButtonElement;
  const hint = h("p", { class: "cast-problems-hint" }, "Paste this back to the AI that made the drawcast, and ask it for a fixed link.");
  const root = h("details", { class: "cast-problems" }, summary, h("div", { class: "cast-problems-body" }, hint, list, h("p", {}, copy)));
  root.hidden = true;
  let text = "";
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        copy.textContent = "Copied";
        window.setTimeout(() => (copy.textContent = "Copy for your AI"), 1600);
      },
      () => {
        copy.textContent = "Could not copy — select the list instead";
      },
    );
  });
  return {
    root,
    show(p) {
      text = problemsText(p);
      const n = problemCount(p);
      root.hidden = n === 0;
      if (n === 0) return;
      summary.textContent = `Problems (${n})`;
      // Opened when the cast cannot play: then this list IS the page's news.
      root.open = !!p.fatal || p.errors.length > 0;
      const lines = [
        ...(p.fatal ? [p.fatal] : []),
        ...p.errors,
        ...p.warnings,
        ...errorsFirst(p.lint).map((i) => lintLine(i, p.items)),
      ];
      list.replaceChildren(...lines.slice(0, SHOWN).map((l) => h("li", {}, l)));
      if (lines.length > SHOWN) list.append(h("li", { class: "cast-problems-more" }, `…and ${lines.length - SHOWN} more (all of them are in the copied text).`));
    },
  };
}
