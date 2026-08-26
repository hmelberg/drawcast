// Keeps a video export alive while the tab is hidden. Browsers freeze
// requestAnimationFrame in hidden tabs — the replay, the frame loop, and the
// recorder would all stall — so the exporter opens a small always-on-top
// preview window (Document Picture-in-Picture) and, while it is attached,
// runs every frame on THAT window's rAF instead. This class is the pure core:
// a frame scheduler that follows whichever window still ticks, plus a
// VisibilityDoc adapter so visibilityPauser only pauses when NOTHING is
// visible (tab hidden and no preview window).

import type { VisibilityDoc } from "./video";

/** A window's frame source, timestamp-free (timestamps differ per window). */
export type FrameFn = (cb: () => void) => void;

export class ExportKeepAlive implements VisibilityDoc {
  private mainDoc: VisibilityDoc;
  private mainRaf: FrameFn;
  private now: () => number;
  private pipRaf: FrameFn | null = null;
  private listeners = new Set<() => void>();
  /** Frames parked on the preview window, so detach can move them over. */
  private pending = new Set<{ cb: (now: number) => void }>();
  private relay = (): void => this.emit();

  constructor(mainDoc: VisibilityDoc, mainRaf: FrameFn, now: () => number) {
    this.mainDoc = mainDoc;
    this.mainRaf = mainRaf;
    this.now = now;
    mainDoc.addEventListener("visibilitychange", this.relay);
  }

  // ----- VisibilityDoc for visibilityPauser -----

  get hidden(): boolean {
    return this.mainDoc.hidden && !this.pipRaf;
  }

  addEventListener(_type: "visibilitychange", l: () => void): void {
    this.listeners.add(l);
  }

  removeEventListener(_type: "visibilitychange", l: () => void): void {
    this.listeners.delete(l);
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }

  // ----- preview-window lifecycle -----

  /** The preview window is open: run frames there from now on. */
  attach(pipRaf: FrameFn): void {
    this.pipRaf = pipRaf;
    this.emit();
  }

  /** The preview window closed: move its parked frames back to the main window. */
  detach(): void {
    if (!this.pipRaf) return;
    this.pipRaf = null;
    const orphans = [...this.pending];
    this.pending.clear();
    for (const o of orphans) this.mainRaf(() => o.cb(this.now()));
    this.emit();
  }

  dispose(): void {
    this.mainDoc.removeEventListener("visibilitychange", this.relay);
  }

  // ----- frame scheduling -----

  /**
   * rAF on whichever window still ticks. Timestamps always come from the main
   * window's clock — each window's rAF stamps against its own time origin, and
   * mixing origins would feed the replay wild deltas.
   */
  raf = (cb: (now: number) => void): void => {
    const pip = this.pipRaf;
    if (!pip) {
      this.mainRaf(() => cb(this.now()));
      return;
    }
    const entry = { cb };
    this.pending.add(entry);
    pip(() => {
      // Only if detach has not already moved this frame to the main window —
      // a closed window firing late must not double-run it.
      if (this.pending.delete(entry)) cb(this.now());
    });
  };

  /** Frame-driven sleep: immune to the timer throttling of hidden tabs. */
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const end = this.now() + ms;
      const tick = (now: number): void => {
        if (now >= end) resolve();
        else this.raf(tick);
      };
      this.raf(tick);
    });
  }
}
