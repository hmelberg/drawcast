// Review mode: watch a drawcast and collect notes about it, then apply them
// as ONE revision.
//
// Position comes from the DOM the player already writes — the caption element
// and the playlist panel's current row — rather than from new plumbing through
// the session. That keeps this attachable to any player, in the editor or
// anywhere else, and means nothing here can break playback.

import { formatNotes, noteLabel, type ReviewNote } from "../review/notes";
import { h } from "./dom";

/** Where playback is, read off the player's own DOM. Best effort by design. */
export function positionIn(host: HTMLElement): Pick<ReviewNote, "part" | "item" | "caption"> {
  const current = host.querySelector<HTMLElement>(".pl-item.current");
  const caption = host.querySelector<HTMLElement>(".cs-caption");
  const text = caption?.textContent?.trim();
  return {
    part: current ? Number(current.dataset.i) + 1 : undefined,
    item: current?.querySelector<HTMLElement>(".pl-item-title")?.textContent?.trim() || undefined,
    caption: text && text.length > 0 ? text : undefined,
  };
}

/** Pause playback if it is running, by pressing the player's own control. */
function pausePlayback(host: HTMLElement): void {
  const stage = host.querySelector<HTMLElement>(".cs-stage");
  if (!stage || stage.classList.contains("is-paused")) return;
  host.querySelector<HTMLButtonElement>(".cs-play")?.click();
}

export interface ReviewHandle {
  destroy(): void;
}

export interface ReviewOptions {
  /** Called with the assembled instruction when the user applies the notes. */
  onApply(instruction: string, notes: ReviewNote[]): void;
  /** Wording for the apply button; the caller knows where the notes go. */
  applyLabel?: string;
}

/**
 * Docks a note composer under the player. Returns a handle so the caller can
 * take it away again — review mode is a mode, not a permanent fixture.
 */
export function attachReview(host: HTMLElement, opts: ReviewOptions): ReviewHandle {
  const notes: ReviewNote[] = [];

  const where = h("div", { class: "rv-where" });
  const input = h("textarea", {
    class: "rv-input",
    rows: "2",
    placeholder: "What should change here? (the part and the line on screen are recorded with it)",
  }) as HTMLTextAreaElement;
  const addBtn = h("button", { class: "small" }, "＋ Note");
  const applyBtn = h("button", { class: "small primary" }, opts.applyLabel ?? "Apply notes");
  const list = h("div", { class: "rv-list" });
  const hint = h("div", { class: "rv-hint" }, "Notes are applied together in one revision, so they cannot undo each other.");

  /** The position is captured when you START writing, not when you submit —
   *  by the time you have finished typing, the drawcast has moved on. */
  let pending: Pick<ReviewNote, "part" | "item" | "caption"> | null = null;

  function showWhere(): void {
    const at = pending ?? positionIn(host);
    const label = noteLabel({ text: "", ...at });
    where.textContent = at.caption ? `${label ? `${label} — ` : ""}“${at.caption}”` : label || "Whole drawcast";
  }

  function render(): void {
    applyBtn.disabled = notes.length === 0;
    applyBtn.textContent = notes.length > 0 ? `${opts.applyLabel ?? "Apply notes"} (${notes.length})` : (opts.applyLabel ?? "Apply notes");
    list.replaceChildren(
      ...notes.map((note, i) => {
        const drop = h("button", { class: "rv-drop", title: "Remove this note" }, "✕");
        drop.addEventListener("click", () => {
          notes.splice(i, 1);
          render();
        });
        const label = noteLabel(note);
        return h(
          "div",
          { class: "rv-note" },
          ...(label ? [h("span", { class: "rv-note-at" }, label)] : []),
          h("span", { class: "rv-note-text" }, note.text),
          drop,
        );
      }),
    );
  }

  function add(): void {
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    notes.push({ text, ...(pending ?? positionIn(host)) });
    input.value = "";
    pending = null;
    showWhere();
    render();
    input.focus();
  }

  input.addEventListener("focus", () => {
    // Typing while it plays means the note lands on the wrong moment, and you
    // miss what you were about to comment on.
    pausePlayback(host);
    pending = positionIn(host);
    showWhere();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      add();
    }
  });
  addBtn.addEventListener("click", add);
  applyBtn.addEventListener("click", () => {
    // Anything still in the box counts — losing a typed note to a missed
    // button press would be the worst thing this panel could do.
    if (input.value.trim()) add();
    const instruction = formatNotes(notes);
    if (!instruction) return;
    opts.onApply(instruction, [...notes]);
  });

  const panel = h(
    "div",
    { class: "rv-panel" },
    h("div", { class: "rv-head" }, h("span", { class: "rv-title" }, "✎ Review"), where),
    input,
    h("div", { class: "rv-bar" }, addBtn, applyBtn, h("span", { class: "pane-spacer" }), hint),
    list,
  );
  host.insertAdjacentElement("afterend", panel);
  showWhere();
  render();

  return {
    destroy: () => panel.remove(),
  };
}
