// The tray pops out into a floating palette over the stage (design
// 2026-09-14 §2.6b): same content, a drag handle, browser-native resizing
// (CSS `resize: both`), position and size remembered per session. Docked is
// the default and never covers the figure; the pop-out is for the viewer who
// wants the controls beside what they change. Geometry and storage are pure
// (tested); the DOM part is thin.

export interface PopoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const POPOUT_MIN = { w: 260, h: 120 } as const;

export function clampBox(box: PopoutBox, host: { w: number; h: number }): PopoutBox {
  const w = Math.min(host.w, Math.max(POPOUT_MIN.w, box.w));
  const h = Math.min(host.h, Math.max(POPOUT_MIN.h, box.h));
  const x = Math.min(Math.max(0, box.x), Math.max(0, host.w - w));
  const y = Math.min(Math.max(0, box.y), Math.max(0, host.h - h));
  return { x, y, w, h };
}

export function readBox(storage: Pick<Storage, "getItem"> | null, key: string): PopoutBox | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PopoutBox>;
    if ([v.x, v.y, v.w, v.h].every((n) => typeof n === "number" && Number.isFinite(n))) return { x: v.x!, y: v.y!, w: v.w!, h: v.h! };
    return null;
  } catch {
    return null;
  }
}

export function writeBox(storage: Pick<Storage, "setItem"> | null, key: string, box: PopoutBox): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(box));
  } catch {
    /* private mode, quota — the palette just forgets */
  }
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function attachPopout(tray: HTMLElement, host: HTMLElement, opts: { storageKey: string }): { popOut(): void; dock(): void; popped(): boolean; detach(): void } {
  const grip = document.createElement("div");
  grip.className = "cs-tray-grip";
  grip.setAttribute("aria-label", "Drag to move the controls");
  const dockBtn = document.createElement("button");
  dockBtn.className = "cs-tray-dock";
  dockBtn.title = "Dock under the bar";
  dockBtn.textContent = "⇤";
  grip.appendChild(dockBtn);
  let popped = false;
  let drag: { dx: number; dy: number } | null = null;

  const place = (box: PopoutBox): void => {
    const b = clampBox(box, { w: host.clientWidth, h: host.clientHeight });
    tray.style.left = `${b.x}px`;
    tray.style.top = `${b.y}px`;
    tray.style.width = `${b.w}px`;
    tray.style.height = `${b.h}px`;
    writeBox(sessionStore(), opts.storageKey, b);
  };
  const current = (): PopoutBox => ({ x: tray.offsetLeft, y: tray.offsetTop, w: tray.offsetWidth, h: tray.offsetHeight });

  // Shared by pointerup and by dock(): a dock mid-drag (Escape, or the dock
  // button under a touch/pen that is still down) must stop listening to the
  // pointer immediately — otherwise a move after dock() re-writes tray.style
  // left/top/width/height onto an element that is back in normal flow.
  const stopDrag = (): void => {
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  const onMove = (e: PointerEvent): void => {
    if (!drag) return;
    const r = host.getBoundingClientRect();
    place({ ...current(), x: e.clientX - r.left - drag.dx, y: e.clientY - r.top - drag.dy });
  };
  const onUp = (): void => stopDrag();
  grip.addEventListener("pointerdown", (e) => {
    if (e.target === dockBtn) return;
    const r = tray.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    e.preventDefault();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && popped) dock();
  };

  const popOut = (): void => {
    if (popped) return;
    popped = true;
    tray.classList.add("cs-popped");
    tray.prepend(grip);
    host.appendChild(tray);
    const saved = readBox(sessionStore(), opts.storageKey);
    place(saved ?? { x: host.clientWidth - 380, y: 24, w: 360, h: Math.min(360, host.clientHeight - 48) });
    window.addEventListener("keydown", onKey);
  };
  const dock = (): void => {
    if (!popped) return;
    stopDrag();
    popped = false;
    tray.classList.remove("cs-popped");
    tray.style.cssText = "";
    grip.remove();
    window.removeEventListener("keydown", onKey);
    tray.dispatchEvent(new CustomEvent("cs-tray-dock"));
  };
  dockBtn.addEventListener("click", dock);
  // Resizing writes back too (the browser's own resize handle).
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => popped && writeBox(sessionStore(), opts.storageKey, current()));
  ro?.observe(tray);
  return { popOut, dock, popped: () => popped, detach: () => { stopDrag(); ro?.disconnect(); window.removeEventListener("keydown", onKey); } };
}
