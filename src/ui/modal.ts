// Shared modal chrome: a title row with a ✕ in the corner and click-outside
// dismiss, plus a tab strip for the modals that hold more than one subject.
//
// Cleanup always belongs on the dialog's native "close" event, never on the ✕
// handler: ESC closes a <dialog> without going through any click listener, and
// so does a backdrop click here.

import { h } from "./dom";

export interface ModalOptions {
  /** Extra class on the <dialog> element. */
  class?: string;
  /**
   * false: an outside click does NOT dismiss. For dialogs where a stray click
   * would throw away work in progress (a running video export).
   */
  backdropCloses?: boolean;
  /** Runs instead of dialog.close() when ✕ is pressed. */
  onClose?(): void;
  /** The size scale; omit for "s". */
  size?: "s" | "m" | "l";
  /**
   * Extra content for the title row — a document picker, a "＋ New". Context,
   * not action: actions belong in the footer. Appended between the title and
   * the ✕.
   */
  head?: HTMLElement[];
}

/**
 * A title row with a ✕ button, wiring backdrop dismissal onto the dialog.
 *
 * The bounding-rect test is what separates a backdrop click from a click on
 * the dialog's own padding: both report the <dialog> element as the event
 * target, so `e.target === dlg` alone would close the dialog when the user
 * clicks its margin.
 */
export function dialogHead(dlg: HTMLDialogElement, title: string, opts: ModalOptions = {}): HTMLElement {
  const x = h("button", { class: "dialog-x", title: "Close" }, "✕");
  x.addEventListener("click", () => (opts.onClose ? opts.onClose() : dlg.close()));
  if (opts.backdropCloses !== false) {
    dlg.addEventListener("click", (e) => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dlg.close();
    });
  }
  // .dialog-head is `justify-content: space-between` (title vs. ✕), so `head`
  // extras (the course modal's saved-course picker and "＋ New") must be
  // grouped WITH the title in one child, not appended as siblings of it —
  // otherwise space-between spreads title/head/✕ across the row as three
  // separate groups instead of "title + head" on the left, ✕ alone on the right.
  return h("div", { class: "dialog-head" }, h("div", { class: "dialog-head-main" }, h("h3", {}, title), ...(opts.head ?? [])), x);
}

export interface Modal {
  dialog: HTMLDialogElement;
  /** Append the modal's content here — the head is already in place. */
  body: HTMLElement;
  /**
   * The action row. Right-aligned, primary last; anything appended to
   * `.footer-left` in it sits on the far side. A modal with no actions simply
   * never touches this and it stays empty and invisible.
   */
  footer: HTMLElement;
  open(): void;
}

export function createModal(title: string, opts: ModalOptions = {}): Modal {
  const size = opts.size ?? "s";
  const dialog = h("dialog", { class: `modal-${size}${opts.class ? ` ${opts.class}` : ""}` }) as HTMLDialogElement;
  const body = h("div", { class: "dialog-body" });
  const footer = h("div", { class: "dialog-footer" });
  dialog.append(dialogHead(dialog, title, opts), body, footer);
  return {
    dialog,
    body,
    footer,
    open: () => {
      if (!dialog.open) dialog.showModal();
    },
  };
}

export interface TabSpec {
  id: string;
  label: string;
  panel: HTMLElement;
}

export interface Tabs {
  el: HTMLElement;
  show(id: string): void;
}

/** A tab strip over stacked panels; the first tab starts active. */
export function createTabs(tabs: TabSpec[]): Tabs {
  const buttons = new Map<string, HTMLButtonElement>();
  const bar = h("div", { class: "tab-bar" });
  const show = (id: string): void => {
    for (const t of tabs) {
      const active = t.id === id;
      t.panel.hidden = !active;
      buttons.get(t.id)?.classList.toggle("active", active);
    }
  };
  for (const t of tabs) {
    const b = h("button", { class: "tab-btn" }, t.label);
    b.addEventListener("click", () => show(t.id));
    buttons.set(t.id, b);
    bar.appendChild(b);
  }
  const el = h("div", { class: "tabs" }, bar, ...tabs.map((t) => t.panel));
  if (tabs.length > 0) show(tabs[0].id);
  return { el, show };
}
