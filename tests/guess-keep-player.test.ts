// Guess marks end with their moment; kept marks follow (spec 2026-10-03-round6 §5).
import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { Player, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { withOverrides } from "../src/render/params";
import { guessParts, guessSetup, patchFor } from "../src/guess/handles";
import type { GuessMarks } from "../src/guess/marks";
import { YOURS } from "../src/guess/reveal";
import type { LayoutResult } from "../src/layout/layout";
import type { Command, Spec } from "../src/spec/types";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

beforeAll(() => {
  registerPack("data", dataYaml);
});

class QuietSpeech extends SpeechManager {
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return Promise.resolve(); }
  override cancel(): void {}
}

/** A player whose frames and commits are laid out for real, so a guess setup
 *  re-run on what is on screen sees the figure move. */
function makePlayer(template: string, params: Record<string, unknown>, commands: Command[], varsBase?: Record<string, number>) {
  const layoutAt = (p: Record<string, unknown>): LayoutResult =>
    layoutSpec(expandSpec({ template, params: withOverrides(params, p), commands: [] } as unknown as Spec));
  const spec = expandSpec({ template, params, commands: [] } as unknown as Spec);
  const mount = layoutSpec(spec);
  const plan = planCommands(commands, [...mount.order], {
    animateBase: params,
    ...(varsBase ? { varsBase } : {}),
    guessParts: (on) => {
      const parts = guessParts(spec, on);
      return { parts, shows: parts };
    },
  });
  const marks = new Map<string, GuessMarks | null>();
  const history: { owner: string; m: GuessMarks | null }[] = [];
  const effects = new Proxy(
    {
      setGuessMarks: (owner: string, m: GuessMarks | null) => {
        marks.set(owner, m);
        history.push({ owner, m });
      },
    } as Record<string, unknown>,
    { get: (t, k: string) => t[k] ?? (() => {}) },
  ) as unknown as BackendEffects;
  const player = new Player(plan, new Map(), new QuietSpeech(), null, { mode: "narrated", effects });
  const frames: Record<string, unknown>[] = [];
  const commits: Record<string, unknown>[] = [];
  let committed: LayoutResult | null = null;
  const rp: Reprojector = {
    frame: (p) => {
      frames.push(p);
      return layoutAt(p);
    },
    commit: (p) => {
      commits.push(p);
      committed = layoutAt(p);
      return new Map();
    },
    committed: () => committed,
  };
  player.reprojector = rp;
  const runtime: GuessRuntime = {
    setup: (on, from, p, onScreen) => guessSetup(spec, withOverrides(params, p), onScreen ?? mount, guessParts(spec, on), { from }),
    patch: (setup, values) => patchFor(spec, setup, values),
  };
  player.guess = runtime;
  /** Where a part's handle stands at these params (the honest layout). */
  const handleAt = (part: string, p: Record<string, unknown>, from?: number) =>
    guessSetup(spec, withOverrides(params, p), layoutAt(p), guessParts(spec, [part]), { from }).handles[0];
  return { player, marks, history, frames, commits, handleAt, plan };
}

const BARS = { labels: ["A", "B", "C"], values: [40, 80, 20], value_labels: true, box: "full" };
const DRAW: Command = { draw: ["axes", "bar_1", "bar_2", "bar_3"] };
const ask = (extra: Record<string, unknown> = {}): Command =>
  ({ ask: { question: "How tall?", on: "bar_2", store: "g", right: "Yes.", wrong: "No.", ...extra } }) as Command;
const LEFT = { animate: { box: "left" }, duration: 0.2 } as unknown as Command;

/** The x span of yours (the blue filled half) in a set of marks. */
const yoursX = (m: GuessMarks): [number, number] => {
  const f = m.lines.find((l) => l.fill === YOURS)!;
  const xs = f.pts.map((p) => p[0]);
  return [Math.min(...xs), Math.max(...xs)];
};

describe("the deadliest-animal pattern: an ask on a bar, then the chart moves", () => {
  test("without keep: yours, the gap and the halves end before the move", async () => {
    const { player, marks, commits } = makePlayer("bar_chart", BARS, [DRAW, ask(), { speak: "Then." }, LEFT, { speak: "End." }]);
    player.askGate = async () => "50";
    await player.play();
    expect(marks.get("guess_1")).toBeNull();
    expect(commits[commits.length - 1]["beside_bars"]).toBeUndefined();
  });

  test("morph without keep: the ghost ends with the move too", async () => {
    const { player, marks } = makePlayer("bar_chart", BARS, [DRAW, ask({ reveal_style: "morph" }), LEFT, { speak: "End." }]);
    player.askGate = async () => "50";
    await player.play();
    expect(marks.get("guess_1")).toBeNull();
  });

  test("keep: yours is recomputed on the moved chart and the halves stay", async () => {
    const { player, marks, commits, frames, handleAt } = makePlayer("bar_chart", BARS, [DRAW, ask({ keep: true }), { speak: "Then." }, LEFT, { speak: "End." }]);
    player.askGate = async () => "50";
    await player.play();
    const m = marks.get("guess_1");
    expect(m).toBeTruthy();
    const h = handleAt("bar_2", { "box.x": 60, "box.y": 95, "box.w": 420, "box.h": 560 });
    const [x0, x1] = yoursX(m!);
    expect(x0).toBeCloseTo(h.cx! - h.halfW!, 3);
    expect(x1).toBeCloseTo(h.cx! - 1.5, 3);
    // The gap still reads +30.
    expect(m!.texts.some((t) => t.text === "+30")).toBe(true);
    // The halves follow: every frame of the move and the commit after it keep them.
    const move = frames.filter((f) => typeof f["box.w"] === "number" && (f["box.w"] as number) < 879 && (f["box.w"] as number) > 421);
    expect(move.length).toBeGreaterThan(0);
    expect(move.every((f) => JSON.stringify(f["beside_bars"]) === "[1]")).toBe(true);
    expect(JSON.stringify(commits[commits.length - 1]["beside_bars"])).toBe("[1]");
  });

  test("keep: during the move yours follows frame by frame", async () => {
    const { player, history } = makePlayer("bar_chart", BARS, [DRAW, ask({ keep: true }), LEFT]);
    player.askGate = async () => "50";
    await player.play();
    const lefts = history.filter((x) => x.owner === "guess_1" && x.m && x.m.lines.some((l) => l.fill === YOURS)).map((x) => yoursX(x.m!)[0]);
    // More than two distinct places: the reveal's, some in between, the end's.
    expect(new Set(lefts.map((v) => v.toFixed(1))).size).toBeGreaterThan(2);
  });

  test("morph with keep: the ghost follows the bar", async () => {
    const { player, marks } = makePlayer("bar_chart", BARS, [DRAW, ask({ reveal_style: "morph", keep: true }), LEFT]);
    player.askGate = async () => "50";
    await player.play();
    const before = makePlayer("bar_chart", BARS, [DRAW, ask({ reveal_style: "morph", keep: true })]);
    before.player.askGate = async () => "50";
    await before.player.play();
    const xsOf = (m: GuessMarks) => m.lines.flatMap((l) => l.pts.map((p) => p[0]));
    const now = marks.get("guess_1")!;
    expect(now).toBeTruthy();
    expect(Math.max(...xsOf(now))).toBeLessThan(Math.max(...xsOf(before.marks.get("guess_1")!)) - 50);
  });
});

describe("the next question", () => {
  test("ends unkept marks; kept marks outlive it unless it asks about the same part", async () => {
    const other = makePlayer("bar_chart", BARS, [DRAW, ask({ keep: true }), ask({ on: "bar_1", store: "h" })]);
    other.player.askGate = async () => "30";
    await other.player.play();
    expect(other.marks.get("guess_1")).toBeTruthy();
    expect(other.marks.get("guess_2")).toBeTruthy();

    const same = makePlayer("bar_chart", BARS, [DRAW, ask({ keep: true }), ask({ store: "h" })]);
    same.player.askGate = async () => "30";
    await same.player.play();
    expect(same.marks.get("guess_1")).toBeNull();

    const plain = makePlayer("bar_chart", BARS, [DRAW, ask(), ask({ on: "bar_1", store: "h" })]);
    plain.player.askGate = async () => "30";
    await plain.player.play();
    expect(plain.marks.get("guess_1")).toBeNull();
  }, 20000);

  test("an erase of the part ends kept marks too", async () => {
    const { player, marks } = makePlayer("bar_chart", BARS, [DRAW, ask({ keep: true }), { erase: ["bar_2"] }]);
    player.askGate = async () => "50";
    await player.play();
    expect(marks.get("guess_1")).toBeNull();
  });
});

describe("a kept line guess through an animate of ylim", () => {
  const LINE = { x: [1, 2, 3, 4, 5, 6], values: [1, 2, 3, 4, 5, 6], ylim: [0, 8] };
  const cmds = (keep: boolean): Command[] => [
    { draw: ["axes", "line_1"] } as Command,
    { ask: { question: "Where next?", on: "line_1", from: 4, store: "g", ...(keep ? { keep: true } : {}) } } as Command,
    { animate: { "ylim.1": 16 }, duration: 0.2 } as unknown as Command,
  ];
  test("kept: yours is drawn on the new scale; unkept: it ends", async () => {
    const kept = makePlayer("line_chart", LINE, cmds(true));
    kept.player.askGate = async () => "5;5;5";
    await kept.player.play();
    const m = kept.marks.get("guess_1");
    expect(m).toBeTruthy();
    const h = kept.handleAt("line_1", { "ylim.0": 0, "ylim.1": 16 }, 4);
    // The true line (ink) ends where 6 stands on the new scale; yours keeps the same answer on it.
    const truth = m!.lines.find((l) => l.color !== YOURS)!;
    const want = h.toLogical!([6, 6]);
    expect(truth.pts[truth.pts.length - 1][0]).toBeCloseTo(want[0], 3);
    expect(truth.pts[truth.pts.length - 1][1]).toBeCloseTo(want[1], 3);
    const mine = m!.lines.find((l) => l.color === YOURS && l.fill === undefined)!;
    const g = h.toDomain!(mine.pts[mine.pts.length - 1])[1];
    const still = makePlayer("line_chart", LINE, cmds(true).slice(0, 2));
    still.player.askGate = async () => "5;5;5";
    await still.player.play();
    const before = still.marks.get("guess_1")!;
    const mine0 = before.lines.find((l) => l.color === YOURS && l.fill === undefined)!;
    const h0 = kept.handleAt("line_1", {}, 4);
    expect(h0.toDomain!(mine0.pts[mine0.pts.length - 1])[1]).toBeCloseTo(g, 3);
    expect(mine.pts[mine.pts.length - 1][1]).not.toBeCloseTo(mine0.pts[mine0.pts.length - 1][1], 0);

    const plain = makePlayer("line_chart", LINE, cmds(false));
    plain.player.askGate = async () => "5;5;5";
    await plain.player.play();
    expect(plain.marks.get("guess_1")).toBeNull();
  }, 20000);
});

describe("scrubbing over a kept guess and its move", () => {
  test("back before the move: yours where it stood; forward past it: yours where the bar went", async () => {
    const { player, marks, commits, handleAt } = makePlayer("bar_chart", BARS, [DRAW, ask({ keep: true }), { speak: "Then." }, LEFT, { speak: "End." }]);
    player.askGate = async () => "50";
    await player.play();
    const full = handleAt("bar_2", {});
    const left = handleAt("bar_2", { "box.x": 60, "box.y": 95, "box.w": 420, "box.h": 560 });
    player.renderUpTo(3);
    expect(yoursX(marks.get("guess_1")!)[0]).toBeCloseTo(full.cx! - full.halfW!, 3);
    expect(JSON.stringify(commits[commits.length - 1]["beside_bars"])).toBe("[1]");
    player.renderUpTo(5);
    expect(yoursX(marks.get("guess_1")!)[0]).toBeCloseTo(left.cx! - left.halfW!, 3);
    expect(JSON.stringify(commits[commits.length - 1]["beside_bars"])).toBe("[1]");
    player.renderUpTo(1);
    expect(marks.get("guess_1")).toBeNull();
    expect(commits[commits.length - 1]["beside_bars"]).toBeUndefined();
    player.renderUpTo(5);
    expect(yoursX(marks.get("guess_1")!)[0]).toBeCloseTo(left.cx! - left.halfW!, 3);
  });

  test("unkept: forward past the move shows no yours; back before it shows it again", async () => {
    const { player, marks, commits } = makePlayer("bar_chart", BARS, [DRAW, ask(), { speak: "Then." }, LEFT, { speak: "End." }]);
    player.askGate = async () => "50";
    await player.play();
    player.renderUpTo(3);
    expect(marks.get("guess_1")).toBeTruthy();
    player.renderUpTo(5);
    expect(marks.get("guess_1")).toBeNull();
    expect(commits[commits.length - 1]["beside_bars"]).toBeUndefined();
  });

  test("morph kept: a seek forward past the move puts the ghost back where the bar went", async () => {
    const { player, marks } = makePlayer("bar_chart", BARS, [DRAW, ask({ reveal_style: "morph", keep: true }), LEFT, { speak: "End." }]);
    player.askGate = async () => "50";
    await player.play();
    const end = marks.get("guess_1")!;
    player.renderUpTo(0);
    expect(marks.get("guess_1")).toBeNull();
    player.renderUpTo(4);
    expect(JSON.stringify(marks.get("guess_1"))).toBe(JSON.stringify(end));
  });
});

describe("fix round 1", () => {
  test("a kept bar moved: yours hides while it moves and comes back shifted with it; a seek agrees", async () => {
    const cmds: Command[] = [DRAW, ask({ keep: true }), { move: { target: "bar_2", by: [0, 20] } } as Command, { speak: "End." }];
    const { player, marks, history, plan } = makePlayer("bar_chart", BARS, cmds);
    player.askGate = async () => "50";
    await player.play();
    const off = plan.states[2].offsets["bar_2"];
    expect(off).toBeTruthy();
    const still = makePlayer("bar_chart", BARS, cmds.slice(0, 2));
    still.player.askGate = async () => "50";
    await still.player.play();
    const [x0] = yoursX(still.marks.get("guess_1")!);
    const ys = (m: GuessMarks) => m.lines.find((l) => l.fill === YOURS)!.pts.map((p) => p[1]);
    const end = marks.get("guess_1")!;
    expect(yoursX(end)[0]).toBeCloseTo(x0 + off[0], 3);
    expect(ys(end)[0]).toBeCloseTo(ys(still.marks.get("guess_1")!)[0] + off[1], 3);
    expect(Math.abs(off[1])).toBeGreaterThan(1);
    // Hidden while it moved.
    expect(history.some((h) => h.owner === "guess_1" && h.m === null)).toBe(true);
    const shown = JSON.stringify(end);
    player.renderUpTo(0);
    player.renderUpTo(4);
    expect(JSON.stringify(marks.get("guess_1"))).toBe(shown);
  }, 20000);

  test("unkept marks end when their bar moves; kept ones end when it turns", async () => {
    const moved = makePlayer("bar_chart", BARS, [DRAW, ask(), { move: { target: "bar_2", by: [0, 20] } } as Command]);
    moved.player.askGate = async () => "50";
    await moved.player.play();
    expect(moved.marks.get("guess_1")).toBeNull();
    const turned = makePlayer("bar_chart", BARS, [DRAW, ask({ keep: true }), { move: { target: "bar_2", rotate: 20 } } as Command, { speak: "End." }]);
    turned.player.askGate = async () => "50";
    await turned.player.play();
    expect(turned.marks.get("guess_1")).toBeNull();
    turned.player.renderUpTo(4);
    expect(turned.marks.get("guess_1") ?? null).toBeNull();
  }, 20000);

  test("an animate of vars only leaves unkept marks alone", async () => {
    const { player, marks, plan } = makePlayer("bar_chart", BARS, [DRAW, ask(), { animate: { "vars.k": 3 }, duration: 0.2 } as unknown as Command, { speak: "End." }], { k: 1 });
    expect(plan.steps[2].kind).toBe("animate");
    player.askGate = async () => "50";
    await player.play();
    expect(marks.get("guess_1")).toBeTruthy();
    player.renderUpTo(4);
    expect(marks.get("guess_1")).toBeTruthy();
  });

  test("a revise's first guess follows the bar frame by frame too", async () => {
    const { player, history } = makePlayer("bar_chart", BARS, [DRAW, ask({ reveal: false }), ask({ store: "h", revise: "g", keep: true }), LEFT]);
    player.askGate = async () => "50";
    await player.play();
    const prev = history.filter((x) => x.owner === "guess_2_prev" && x.m).map((x) => Math.min(...x.m!.lines.flatMap((l) => l.pts.map((p) => p[0]))));
    expect(new Set(prev.map((v) => v.toFixed(1))).size).toBeGreaterThan(2);
  });
});
