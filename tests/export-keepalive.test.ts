import { describe, expect, test } from "vitest";
import { ExportKeepAlive } from "../src/export/keepalive";

/** Minimal stand-in for document's visibility surface (same as export-pause). */
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
  const mainFrames: (() => void)[] = [];
  let clock = 0;
  const ka = new ExportKeepAlive(
    doc,
    (cb) => mainFrames.push(cb),
    () => clock,
  );
  const runMain = () => {
    for (const cb of mainFrames.splice(0)) cb();
  };
  return { doc, mainFrames, ka, runMain, setClock: (t: number) => (clock = t) };
}

describe("ExportKeepAlive visibility", () => {
  test("hidden only when the tab is hidden AND no preview window is attached", () => {
    const { doc, ka } = harness();
    expect(ka.hidden).toBe(false);
    doc.setHidden(true);
    expect(ka.hidden).toBe(true);
    ka.attach(() => {});
    expect(ka.hidden).toBe(false);
    ka.detach();
    expect(ka.hidden).toBe(true);
    doc.setHidden(false);
    expect(ka.hidden).toBe(false);
  });

  test("attach, detach, and tab visibility changes all notify visibility listeners", () => {
    const { doc, ka } = harness();
    let events = 0;
    ka.addEventListener("visibilitychange", () => events++);
    ka.attach(() => {});
    expect(events).toBe(1);
    ka.detach();
    expect(events).toBe(2);
    doc.setHidden(true);
    expect(events).toBe(3);
  });

  test("dispose stops relaying the tab's visibility events", () => {
    const { doc, ka } = harness();
    let events = 0;
    ka.addEventListener("visibilitychange", () => events++);
    ka.dispose();
    doc.setHidden(true);
    expect(events).toBe(0);
  });
});

describe("ExportKeepAlive frame scheduling", () => {
  test("without a preview window, frames run on the main window with the shared clock", () => {
    const { ka, mainFrames, runMain, setClock } = harness();
    const stamps: number[] = [];
    setClock(42);
    ka.raf((now) => stamps.push(now));
    expect(mainFrames.length).toBe(1);
    runMain();
    expect(stamps).toEqual([42]);
  });

  test("with a preview window attached, frames run there — timestamps still from the main clock", () => {
    const { ka, mainFrames, setClock } = harness();
    const pipFrames: (() => void)[] = [];
    ka.attach((cb) => pipFrames.push(cb));
    const stamps: number[] = [];
    setClock(7);
    ka.raf((now) => stamps.push(now));
    expect(mainFrames.length).toBe(0);
    expect(pipFrames.length).toBe(1);
    pipFrames[0]();
    expect(stamps).toEqual([7]);
  });

  test("closing the preview reschedules its parked frames on the main window — exactly once", () => {
    const { ka, mainFrames, runMain } = harness();
    const pipFrames: (() => void)[] = [];
    ka.attach((cb) => pipFrames.push(cb));
    let calls = 0;
    ka.raf(() => calls++);
    ka.detach();
    expect(mainFrames.length).toBe(1); // the parked frame moved over
    runMain();
    expect(calls).toBe(1);
    pipFrames[0](); // the dead window fires late — must not double-run
    expect(calls).toBe(1);
  });

  test("sleep resolves once the frame clock has advanced past the duration", async () => {
    const { ka, runMain, setClock } = harness();
    let done = false;
    const p = ka.sleep(100).then(() => (done = true));
    runMain();
    await Promise.resolve();
    expect(done).toBe(false); // clock still at 0
    setClock(150);
    runMain();
    await p;
    expect(done).toBe(true);
  });
});
