import { describe, expect, test, vi } from "vitest";
import { startWorkerClock } from "../src/export/keepalive";

/** Minimal stand-in for a dedicated worker posting interval ticks. */
function fakeWorker() {
  return {
    onmessage: null as (() => void) | null,
    terminate: vi.fn(),
  };
}

describe("startWorkerClock", () => {
  test("returns null where workers are unavailable", () => {
    // node has no Worker global — the default factory must fail soft.
    expect(startWorkerClock()).toBeNull();
  });

  test("each tick runs the callbacks scheduled since the last one, exactly once", () => {
    const w = fakeWorker();
    const clock = startWorkerClock(16, () => w as never);
    expect(clock).not.toBeNull();
    const calls: string[] = [];
    clock!.frame(() => calls.push("a"));
    clock!.frame(() => calls.push("b"));
    w.onmessage!();
    expect(calls).toEqual(["a", "b"]);
    w.onmessage!(); // nothing new scheduled — nothing re-runs
    expect(calls).toEqual(["a", "b"]);
    clock!.frame(() => calls.push("c"));
    w.onmessage!();
    expect(calls).toEqual(["a", "b", "c"]);
  });

  test("stop terminates the worker", () => {
    const w = fakeWorker();
    const clock = startWorkerClock(16, () => w as never);
    clock!.stop();
    expect(w.terminate).toHaveBeenCalled();
  });
});
