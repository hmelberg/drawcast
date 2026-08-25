import { describe, expect, test } from "vitest";
import { visibilityPauser } from "../src/export/video";

/** Minimal stand-in for document's visibility surface. */
class FakeDoc {
  hidden = false;
  private listeners = new Set<() => void>();
  addEventListener(_type: string, l: () => void): void {
    this.listeners.add(l);
  }
  removeEventListener(_type: string, l: () => void): void {
    this.listeners.delete(l);
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const l of [...this.listeners]) l();
  }
}

function harness() {
  const doc = new FakeDoc();
  const calls: string[] = [];
  const deferred: (() => void)[] = [];
  const stop = visibilityPauser(
    doc,
    { pause: () => calls.push("pause"), resume: () => calls.push("resume") },
    (cb) => deferred.push(cb),
  );
  const runDeferred = () => {
    while (deferred.length) deferred.shift()!();
  };
  return { doc, calls, stop, runDeferred };
}

describe("visibilityPauser", () => {
  test("hiding the tab pauses once", () => {
    const { doc, calls } = harness();
    doc.setHidden(true);
    expect(calls).toEqual(["pause"]);
  });

  test("resume waits for the deferred frame, so the rAF loop absorbs the hidden-time delta first", () => {
    const { doc, calls, runDeferred } = harness();
    doc.setHidden(true);
    doc.setHidden(false);
    expect(calls).toEqual(["pause"]); // not yet — the stale-delta frame must run paused
    runDeferred();
    expect(calls).toEqual(["pause", "resume"]);
  });

  test("hiding again before the deferred resume runs skips the resume", () => {
    const { doc, calls, runDeferred } = harness();
    doc.setHidden(true);
    doc.setHidden(false);
    doc.setHidden(true); // back to hidden before the frame fires
    runDeferred();
    expect(calls).toEqual(["pause", "pause"]);
  });

  test("a visibility event while already visible resumes nothing", () => {
    const { doc, calls, runDeferred } = harness();
    doc.setHidden(false);
    runDeferred();
    expect(calls).toEqual([]);
  });

  test("stop() detaches — later visibility changes touch nothing", () => {
    const { doc, calls, stop } = harness();
    stop();
    doc.setHidden(true);
    expect(calls).toEqual([]);
  });
});
