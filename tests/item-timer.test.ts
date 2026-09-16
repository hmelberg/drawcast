// The item timer (spec 2026-09-16-course-progress §2): one view of one
// playlist item — visible seconds, playing seconds, done — with a fake clock.
import { describe, expect, test } from "vitest";
import { ItemTimer } from "../src/playlist/item-timer";

function clock(start = 0) {
  let t = start;
  return { now: () => t, tick: (ms: number) => void (t += ms) };
}

describe("ItemTimer", () => {
  test("visible time sums across hidden gaps; playing time counts even while hidden", () => {
    const c = clock();
    const timer = new ItemTimer(c.now);
    timer.start(2, "Cases");
    timer.setPlaying(true);
    c.tick(4000);
    timer.setVisible(false);
    c.tick(3000); // hidden, still playing
    timer.setVisible(true);
    timer.setPlaying(false);
    c.tick(2000); // visible, paused
    expect(timer.close()).toEqual({ item: 2, title: "Cases", visible_secs: 6, playing_secs: 7, done: false });
  });

  test("done marks the view; close twice returns null; a new start opens a fresh view", () => {
    const c = clock();
    const timer = new ItemTimer(c.now);
    expect(timer.close()).toBeNull();
    timer.start(0, "Intro");
    c.tick(1400);
    timer.markDone();
    expect(timer.close()).toEqual({ item: 0, title: "Intro", visible_secs: 1, playing_secs: 0, done: true });
    expect(timer.close()).toBeNull();
    timer.start(0, "Intro");
    c.tick(600);
    expect(timer.close()).toEqual({ item: 0, title: "Intro", visible_secs: 1, playing_secs: 0, done: false });
  });

  test("a view that starts hidden counts no visible time until it is shown", () => {
    const c = clock();
    const timer = new ItemTimer(c.now);
    timer.setVisible(false);
    timer.start(1, "Two");
    c.tick(5000);
    timer.setVisible(true);
    c.tick(1000);
    expect(timer.close()?.visible_secs).toBe(1);
  });

  test("current() names the open view so a return from hidden can restart it", () => {
    const timer = new ItemTimer(() => 0);
    expect(timer.current()).toBeNull();
    timer.start(3, "Four");
    expect(timer.current()).toEqual({ item: 3, title: "Four" });
  });
});
