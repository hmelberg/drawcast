// tests/picture-marks-player.test.ts — spec §13: the player plays mark steps —
// eases in, glides between stops and across continuing steps, releases only
// when nothing continues, and never leaves a mark behind on an abort.
import { afterEach, expect, test, vi } from "vitest";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { MarkFrame } from "../src/render/marks";
import { FULL_VIEW4 } from "../src/spec/places";

class SilentSpeech extends SpeechManager {
  override get available(): boolean {
    return false;
  }
  override speak(): Promise<void> {
    return Promise.resolve();
  }
  override cancel(): void {}
}

const rect = { x: 100, y: 300, w: 400, h: 200 };
type R4 = [number, number, number, number];
const regions = { left: [0, 0, 0.5, 1] as R4, right: [0.5, 0, 0.5, 1] as R4, bottom: [0, 0.9, 1, 0.1] as R4 };
const LEFT = { x: 100, y: 300, w: 200, h: 200 };
const RIGHT = { x: 300, y: 300, w: 200, h: 200 };
const opts = {
  bboxOf: (id: string) => (id === "md" ? rect : id === "t" ? { x: 0, y: 0, w: 10, h: 10 } : null),
  pictureOf: (id: string) => (id === "md" ? { frame: { rect, view: FULL_VIEW4 }, regions } : null),
};

afterEach(() => {
  vi.restoreAllMocks();
});

type Call = { op: "set"; owner: string; f: MarkFrame } | { op: "end"; owner: string };

/** A player on a stub backend with a hand-cranked rAF: `run` plays to the end (or `until` says stop). */
function harness(commands: object[]) {
  const plan = planCommands(commands as never, ["md", "t"], opts as never);
  const calls: Call[] = [];
  const effects = {
    setHighlight: () => undefined,
    endHighlight: () => undefined,
    setPointer: () => undefined,
    setCamera: () => undefined,
    setMark: (owner: string, f: MarkFrame) => calls.push({ op: "set", owner, f }),
    endMark: (owner: string) => calls.push({ op: "end", owner }),
  };
  const stub = (id: string) => ({ id, durationMs: 10, finish: () => undefined, hide: () => undefined, setProgress: () => undefined }) as never;
  const player = new Player(plan, new Map([["md", stub("md")]]), new SilentSpeech(), null, { mode: "narrated", breath: false, effects: effects as never });
  const frames: ((now: number) => void)[] = [];
  player.raf = (cb) => frames.push(cb);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  // A clock of our own: every rAF tick is exactly 40 ms after the last.
  let clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const run = async (until: () => boolean = () => false) => {
    const done = player.play();
    await flush();
    for (let guard = 0; player.state === "playing" && guard < 400; guard++) {
      if (until()) return; // left mid-play: the caller takes it from here
      clock += 40;
      for (const cb of frames.splice(0)) cb(clock);
      await flush();
    }
    await done;
  };
  const sets = () => calls.filter((c): c is Extract<Call, { op: "set" }> => c.op === "set");
  const ends = () => calls.filter((c) => c.op === "end");
  return { player, calls, run, sets, ends };
}

test("one highlight on a place: the light rises, rests on the place, then ends", async () => {
  const h = harness([{ draw: ["md"] }, { highlight: { target: "md:left", duration: 0.8 } }]);
  await h.run();
  const s = h.sets();
  expect(s.length).toBeGreaterThan(3);
  expect(s.every((c) => c.owner === "md" && c.f.kind === "light")).toBe(true);
  expect(s[0].f.level).toBeLessThan(1);
  const peak = s.findIndex((c) => c.f.level >= 1);
  expect(peak).toBeGreaterThan(0);
  // Rising until the peak.
  for (let i = 1; i <= peak; i++) expect(s[i].f.level).toBeGreaterThanOrEqual(s[i - 1].f.level);
  // It rests on the region's box, and releases there.
  expect(s[s.length - 1].f.box).toEqual(LEFT);
  expect(s[s.length - 1].f.level).toBeLessThan(0.05);
  expect(h.ends()).toEqual([{ op: "end", owner: "md" }]);
  expect(h.calls[h.calls.length - 1]).toEqual({ op: "end", owner: "md" });
});

test("two consecutive highlights on one picture: one mark that glides, ended once at the very end", async () => {
  const h = harness([{ draw: ["md"] }, { highlight: { target: "md:left", duration: 0.8 } }, { highlight: { target: "md:right", duration: 0.8 } }]);
  await h.run();
  expect(h.ends()).toHaveLength(1);
  expect(h.calls[h.calls.length - 1]).toEqual({ op: "end", owner: "md" });
  const s = h.sets();
  // The first step reached LEFT at full; the second starts from LEFT, never dipping out.
  const firstRight = s.findIndex((c) => c.f.box.x > LEFT.x);
  expect(firstRight).toBeGreaterThan(0);
  const handover = s.findIndex((c, i) => i > 0 && c.f.level === 1 && s[i - 1].f.level === 1 && c.f.box.x === LEFT.x && s.slice(i + 1).some((d) => d.f.box.x > LEFT.x));
  expect(handover).toBeGreaterThanOrEqual(0);
  // No release between the steps: level stays at 1 from the first peak until the final release.
  const peak = s.findIndex((c) => c.f.level >= 1);
  const lastFull = s.map((c) => c.f.level >= 1).lastIndexOf(true);
  for (let i = peak; i <= lastFull; i++) expect(s[i].f.level).toBe(1);
  expect(s[lastFull].f.box).toEqual(RIGHT);
});

test("the second step's first frame is where the first step left the mark", async () => {
  const h = harness([{ draw: ["md"] }, { highlight: { target: "md:left", duration: 0.6 } }, { highlight: { target: "md:right", duration: 0.6 } }]);
  let atSecond = -1;
  await h.run(() => {
    // Mark the call index when the player moves on to step 2.
    if (atSecond < 0 && h.player.position >= 2) atSecond = h.calls.length;
    return false;
  });
  expect(atSecond).toBeGreaterThan(0);
  const s = h.calls.slice(0, atSecond).filter((c) => c.op === "set") as Extract<Call, { op: "set" }>[];
  const after = h.calls.slice(atSecond).filter((c) => c.op === "set") as Extract<Call, { op: "set" }>[];
  expect(s[s.length - 1].f.box).toEqual(LEFT);
  // One frame (40 ms) into the glide: still at LEFT to within a few units, at full — no jump, no dip.
  expect(after[0].f.box.x).toBeCloseTo(LEFT.x, -1);
  expect(after[0].f.box.w).toBe(LEFT.w);
  expect(after[0].f.level).toBe(1);
});

test("three stops in one highlight: the boxes visit all three in order", async () => {
  const h = harness([{ draw: ["md"] }, { highlight: { target: ["md:left", "md:right", "md:bottom"], duration: 3 } }]);
  await h.run();
  const boxes = h.sets().map((c) => JSON.stringify(c.f.box));
  const order = ["md:left", "md:right", "md:bottom"].map((_, i) => boxes.indexOf(JSON.stringify([LEFT, RIGHT, { x: 100, y: 300, w: 400, h: 20 }][i])));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order[0]).toBeLessThan(order[1]);
  expect(order[1]).toBeLessThan(order[2]);
});

test("stopping mid-mark ends it", async () => {
  const h = harness([{ draw: ["md"] }, { highlight: { target: "md:left", duration: 5 } }]);
  await h.run(() => h.sets().length > 3);
  expect(h.ends()).toHaveLength(0);
  h.player.stop();
  await new Promise((r) => setTimeout(r, 0));
  expect(h.ends().length).toBeGreaterThan(0);
});

test("stopping between two continuing marks ends the one left standing", async () => {
  const h = harness([{ draw: ["md"] }, { highlight: { target: "md:left", duration: 0.4 } }, { pause: 5 }, { highlight: { target: "md:right", duration: 0.4 } }]);
  await h.run(() => h.player.position >= 2 && h.sets().length > 0);
  // The first mark continues: it is left standing through the wait.
  expect(h.ends()).toHaveLength(0);
  h.player.stop();
  expect(h.ends()).toEqual([{ op: "end", owner: "md" }]);
});

test("a seek onto a continuing mark eases in at its first stop instead of gliding from nowhere", async () => {
  const h = harness([{ draw: ["md"] }, { highlight: { target: "md:left", duration: 0.6 } }, { highlight: { target: "md:right", duration: 0.6 } }]);
  h.player.renderUpTo(2);
  await h.run();
  const s = h.sets();
  expect(s[0].f.level).toBeLessThan(1);
  expect(s.every((c) => JSON.stringify(c.f.box) === JSON.stringify(RIGHT))).toBe(true);
  expect(h.ends()).toHaveLength(1);
});

test("a stopped mark's late clean-up never ends the next run's mark on the same picture", async () => {
  const h = harness([{ draw: ["md"] }, { highlight: { target: "md:left", duration: 5 } }]);
  // Run A paints, then a stop — A's aborted step has not yet seen the abort (its next rAF is still queued).
  await h.run(() => h.sets().length > 3);
  h.player.stop();
  h.player.renderUpTo(1); // B lands straight on the mark step
  const endsAfterStop = h.ends().length;
  // Run B starts at once and paints the same picture; A's queued tick runs alongside B's and A cleans up.
  const setsBefore = h.sets().length;
  await h.run(() => h.sets().length > setsBefore + 5);
  expect(h.sets().length).toBeGreaterThan(setsBefore + 5);
  // B's mark is still up: nothing ended it.
  expect(h.ends()).toHaveLength(endsAfterStop);
});
