import { describe, expect, test } from "vitest";
import { WebAudioTones } from "../src/render/tones";

/** Just enough AudioContext for one oscillator + gain. */
function fakeCtx() {
  const oscs: { freq: number; started: number; stopped: number }[] = [];
  const ctx = {
    currentTime: 1,
    state: "running",
    destination: {},
    resume: async () => undefined,
    createOscillator: () => {
      const o = { type: "sine", frequency: { value: 0 }, connect: () => undefined, start: (t: number) => (rec.started = t), stop: (t: number) => (rec.stopped = t) };
      const rec = { freq: 0, started: 0, stopped: 0 };
      Object.defineProperty(o.frequency, "value", { set: (v: number) => (rec.freq = v), get: () => rec.freq });
      oscs.push(rec);
      return o;
    },
    createGain: () => ({ gain: { setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, setTargetAtTime: () => undefined }, connect: () => undefined }),
  };
  return { ctx: ctx as unknown as AudioContext, oscs };
}

describe("ToneLike.beep", () => {
  test("schedules one oscillator at hz for ms and returns ms", () => {
    const { ctx, oscs } = fakeCtx();
    const t = new WebAudioTones(ctx, ctx.destination as AudioNode);
    expect(t.beep(700, 80)).toBe(80);
    expect(oscs).toHaveLength(1);
    expect(oscs[0].freq).toBe(700);
    expect(oscs[0].stopped - oscs[0].started).toBeCloseTo(0.08 + 0.01, 3);
  });

  test("a non-positive duration or frequency schedules nothing", () => {
    const { ctx, oscs } = fakeCtx();
    const t = new WebAudioTones(ctx, ctx.destination as AudioNode);
    expect(t.beep(0, 80)).toBe(0);
    expect(t.beep(440, 0)).toBe(0);
    expect(oscs).toHaveLength(0);
  });
});
