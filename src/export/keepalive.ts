// Keeps a video export alive while the tab is hidden. Browsers freeze
// requestAnimationFrame in hidden tabs — the replay, the frame loop, and the
// recorder would all stall — so the exporter attaches an alternative tick
// source that hidden tabs do NOT freeze: a dedicated Web Worker's interval
// (worker timers escape tab throttling, and its messages are ordinary tasks).
// ExportKeepAlive is the pure core: a frame scheduler that follows whichever
// tick source is attached, plus a VisibilityDoc adapter so visibilityPauser
// only pauses when the export truly has no clock left.

import type { VisibilityDoc } from "./video";

/** A tick source, timestamp-free (rAF timestamps differ per window anyway). */
export type FrameFn = (cb: () => void) => void;

interface WorkerLike {
  onmessage: ((ev: MessageEvent) => void) | null;
  terminate(): void;
}

function makeIntervalWorker(intervalMs: number): WorkerLike {
  const src = `setInterval(() => postMessage(0), ${intervalMs});`;
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  try {
    return new Worker(url);
  } finally {
    URL.revokeObjectURL(url); // the worker has loaded; the blob can go
  }
}

/**
 * A FrameFn backed by a Web Worker interval instead of rAF. Each tick runs
 * the callbacks scheduled since the previous one — the same one-shot contract
 * as requestAnimationFrame. Returns null where workers are unavailable.
 */
export function startWorkerClock(intervalMs = 16, makeWorker: (ms: number) => WorkerLike = makeIntervalWorker): { frame: FrameFn; stop(): void } | null {
  let worker: WorkerLike;
  try {
    worker = makeWorker(intervalMs);
  } catch {
    return null;
  }
  const scheduled: (() => void)[] = [];
  worker.onmessage = () => {
    for (const cb of scheduled.splice(0)) cb();
  };
  return {
    frame: (cb) => scheduled.push(cb),
    stop: () => worker.terminate(),
  };
}

export class ExportKeepAlive implements VisibilityDoc {
  private mainDoc: VisibilityDoc;
  private mainRaf: FrameFn;
  private now: () => number;
  private altRaf: FrameFn | null = null;
  private listeners = new Set<() => void>();
  /** Frames parked on the attached tick source, so detach can move them over. */
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
    return this.mainDoc.hidden && !this.altRaf;
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

  // ----- tick-source lifecycle -----

  /** An unfreezable tick source (worker clock) is up: run frames on it. */
  attach(altRaf: FrameFn): void {
    this.altRaf = altRaf;
    this.emit();
  }

  /** The tick source stopped: move its parked frames back to the main rAF. */
  detach(): void {
    if (!this.altRaf) return;
    this.altRaf = null;
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
   * rAF on whichever tick source still runs. Timestamps always come from the
   * main window's clock, so the replay never sees deltas from mixed origins.
   */
  raf = (cb: (now: number) => void): void => {
    const alt = this.altRaf;
    if (!alt) {
      this.mainRaf(() => cb(this.now()));
      return;
    }
    const entry = { cb };
    this.pending.add(entry);
    alt(() => {
      // Only if detach has not already moved this frame to the main rAF —
      // a stopped clock firing late must not double-run it.
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
