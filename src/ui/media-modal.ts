// Reading-instead-of-the-figure surface (interactivity spec §7.4, §13): a
// modal over the stage for link kinds that frame — YouTube's embed domain
// exists to allow it; PDFs from friendly hosts do too, and the permanent
// "Open in new tab ↗" escape covers hosts that silently refuse (an
// X-Frame-Options block fires no JS event, so it cannot be detected).
// Player-only by construction: the export never mounts controls.

import type { RenderHandle } from "../render";
import { h } from "./dom";

export interface MediaModalOpts {
  /** What the iframe loads (embed URL for YouTube, the document for PDF). */
  src: string;
  /** Where "Open in new tab ↗" goes — the original link, always shown. */
  href: string;
  /** iframe allow attribute (YouTube wants fullscreen etc.). */
  allow?: string;
  /** Called once, however the modal went away — a gate that parked the run
   *  on it resolves here. */
  onClose?: () => void;
  /**
   * Bytes handed to the emulator after it starts, instead of naming a file in
   * its URL. A disk image needs a drive ROM in the machine beside it, and a
   * ROM can only arrive this way — see code/c64-drive-rom.ts for why we have
   * one at all, and why it is the viewer's file and not ours.
   */
  inject?: { floppyRom: Uint8Array; file: Uint8Array; fileName: string };
}

/**
 * Typed into the machine once the disk is in, the way a person would: load the
 * first program on it, wait for the drive to finish, run it. Straight from
 * vc64web's own d64 chapter. The helpers are the emulator page's own — our
 * script runs inside it.
 */
const AUTORUN = "await wasm_ready_after_reset(); await action(`'load\"*\",8,1'=>Enter`); await disk_loading_finished(); await action(`'run'=>Enter`);";

export function openMediaModal(stage: HTMLElement, hd: RenderHandle, opts: MediaModalOpts): { close: () => void } {
  stage.querySelector(".cs-mediamodal")?.remove();

  const frame = h("iframe", { class: "cs-mediamodal-frame", src: opts.src, ...(opts.allow ? { allow: opts.allow } : {}) });
  const newTab = h("a", { class: "cs-mediamodal-open", href: opts.href, target: "_blank", rel: "noopener" }, "Open in new tab ↗");
  const closeBtn = h("button", { class: "cs-mediamodal-close", title: "Close" }, "✕");
  const box = h("div", { class: "cs-mediamodal-box" }, h("div", { class: "cs-mediamodal-bar" }, newTab, closeBtn), frame);
  const scrim = h("div", { class: "cs-mediamodal" }, box);

  let dead = false;
  const undo: (() => void)[] = [];
  const close = (): void => {
    if (dead) return;
    dead = true;
    hd.timeline.callbacks.onState = prevOnState;
    hd.timeline.callbacks.onStep = prevOnStep;
    window.removeEventListener("keydown", onKey);
    for (const f of undo) f();
    scrim.remove();
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing") close();
  };
  const prevOnStep = hd.timeline.callbacks.onStep;
  hd.timeline.callbacks.onStep = (completed, total) => {
    prevOnStep?.(completed, total);
    close();
  };

  scrim.addEventListener("click", (e) => {
    e.stopPropagation(); // never the stage's play/pause toggle
    if (e.target === scrim) close();
  });
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });
  window.addEventListener("keydown", onKey);
  stage.appendChild(scrim);
  // Keyboard focus goes INTO the frame, now and again once it has loaded —
  // an emulator that has to be clicked before the cursor keys reach it is
  // one nobody can play from the first second (Hans, 2026-09-06). The modal's
  // own Escape still works: the key reaches the frame's document, and a
  // cross-origin page cannot stop the viewer closing what is over the stage.
  const grab = (): void => {
    try {
      frame.focus();
      frame.contentWindow?.focus();
    } catch {
      /* a frame that refuses focus keeps its own rules */
    }
  };
  grab();
  frame.addEventListener("load", grab);

  if (opts.inject) {
    // The emulator never announces itself: it answers `render_run_state` only
    // when the parent asks with the string "poll_state" (measured — waiting
    // for an unsolicited ready message waits forever). So poll until it
    // replies, hand over the ROM and the disk in one message, and type the
    // load after it. Its own resume then does the rest.
    const load = opts.inject;
    let handed = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const stop = (): void => {
      if (poll !== undefined) clearInterval(poll);
      window.removeEventListener("message", onMessage);
    };
    function onMessage(e: MessageEvent): void {
      if (dead || handed || e.source !== frame.contentWindow) return;
      if ((e.data as { msg?: unknown } | null)?.msg !== "render_run_state") return;
      handed = true;
      stop();
      const win = frame.contentWindow;
      win?.postMessage({ cmd: "load", floppy_rom: load.floppyRom, file: load.file, file_name: load.fileName }, "*");
      win?.postMessage({ cmd: "script", script: AUTORUN }, "*");
    }
    window.addEventListener("message", onMessage);
    poll = setInterval(() => {
      if (dead || handed) return stop();
      frame.contentWindow?.postMessage("poll_state", "*");
    }, 400);
    undo.push(stop);
  }
  return { close };
}
