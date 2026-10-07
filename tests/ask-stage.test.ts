// A question on its own page (spec 2026-10-03-round6 §6): with stage "own"
// the rest of the figure fades to 15 % while the question stands — the asked
// parts, their cards, options and blanks stay at full strength — and comes
// back over ~300 ms after the reveal and its lines. Movies never wait; a
// scrub lands on the right opacities.

import { beforeAll, describe, expect, test } from "vitest";
import { Player, STAGE_DIM, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects, RenderedElement } from "../src/render/backend";
import { planCommands, type PlanOptions } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { Command, Spec } from "../src/spec/types";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { withOverrides } from "../src/render/params";
import { guessParts, guessSetup, patchFor } from "../src/guess/handles";
import { validateSpec } from "../src/spec/schema";
import { lintCommands } from "../src/lint/lint";
import { cardsGeometry, type CardsElementLike } from "../src/spec/cards";
import { encodeArrangement } from "../src/cards/model";
import { encodeTreeAnswer } from "../src/tree/blanks";
import type { DecisionTreeParams } from "../src/scenes/decision_tree/layout";
import type { Pt } from "../src/layout/model";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

beforeAll(() => {
  registerPack("data", dataYaml);
});

class QuietSpeech extends SpeechManager {
  said: string[] = [];
  override get available(): boolean { return false; }
  override speak(text: string): Promise<void> {
    this.said.push(text);
    return Promise.resolve();
  }
  override cancel(): void {}
}

const TREE_ROOT = {
  id: "start", type: "decision", label: "Choose",
  children: [
    { label: "Treat", node: { id: "treat", type: "chance", label: "", children: [
      { label: "Cured", probability: 0.3, node: { id: "cured", type: "terminal", label: "", payoff: 10 } },
      { label: "Not", node: { id: "not", type: "terminal", label: "", payoff: 4 } },
    ] } },
    { label: "Wait", node: { id: "wait", type: "terminal", label: "", payoff: 5 } },
  ],
};

const BOXES: Record<string, { x: number; y: number; w: number; h: number }> = {
  door_1: { x: 0, y: 0, w: 100, h: 200 },
  door_2: { x: 200, y: 0, w: 100, h: 200 },
  title: { x: 0, y: 400, w: 300, h: 40 },
  note: { x: 400, y: 400, w: 300, h: 40 },
};
const IDS = Object.keys(BOXES);

/** Fake handles: each remembers its latest opacity (1 when never set). */
function fakeElements(ids: string[]) {
  const alpha = new Map<string, number>();
  const els = new Map<string, RenderedElement>();
  for (const id of ids) {
    els.set(id, {
      id,
      durationMs: 0,
      setProgress: () => {},
      finish: () => {},
      hide: () => {},
      setOpacity: (a: number) => void alpha.set(id, a),
    });
  }
  const at = (id: string) => alpha.get(id) ?? 1;
  return { els, at };
}

const effects = () =>
  new Proxy({} as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => {}) }) as unknown as BackendEffects;

function makePlayer(commands: Command[], ids: string[] = IDS, opts: PlanOptions = {}) {
  const plan = planCommands(commands, ids, { bboxOf: (id) => BOXES[id] ?? null, ...opts });
  const { els, at } = fakeElements(ids);
  const speech = new QuietSpeech();
  const player = new Player(plan, els, speech, null, { mode: "narrated", breath: false, effects: effects() });
  return { player, plan, at, speech };
}

const DOORS = (stage?: "own"): Command[] => [
  { draw: IDS },
  { ask: { question: "Which door?", choose: ["door_1", "door_2"], answer: "door_2", right: "Yes.", wrong: "No.", ...(stage ? { stage } : {}) } } as Command,
  { speak: "On we go." },
];

describe("the plan: what a staged question keeps at full strength", () => {
  test("choose: the options (a group's members too); nothing without stage", () => {
    const { plan } = makePlayer(DOORS("own"));
    const ask = plan.steps.find((s) => s.kind === "ask");
    expect(ask?.kind === "ask" && ask.stage?.sort()).toEqual(["door_1", "door_2"]);
    const plain = makePlayer(DOORS()).plan.steps.find((s) => s.kind === "ask");
    expect(plain?.kind === "ask" && plain.stage).toBeUndefined();
  });

  test("the page's heading never fades: it stays on top through the ask (2026-10-07)", () => {
    const ids = [...IDS, "card_1_title", "card_1_line"];
    const plan = planCommands([{ draw: ids }, { ask: { question: "Which door?", choose: ["door_1", "door_2"], answer: "door_2", stage: "own" } } as Command], ids, { bboxOf: (id) => BOXES[id] ?? null });
    const ask = plan.steps.find((s) => s.kind === "ask");
    expect(ask?.kind === "ask" && ask.stage?.sort()).toEqual(["card_1_line", "card_1_title", "door_1", "door_2"]);
  });

  test("a guess: the parts it paints and shows", () => {
    const plan = planCommands([{ draw: ["axes", "bar_1"] }, { ask: { question: "How tall?", on: "bar_2", stage: "own" } } as Command], ["axes", "bar_1", "bar_2", "value_2"], {
      guessParts: () => ({ parts: ["bar_2"], shows: ["bar_2", "value_2"] }),
    });
    const ask = plan.steps.find((s) => s.kind === "ask");
    expect(ask?.kind === "ask" && ask.stage?.sort()).toEqual(["bar_2", "value_2"]);
  });

  test("cards: the element's cards, boxes and numbers", () => {
    const ids = ["c", "c_1", "c_2", "c_bin_1", "title"];
    const plan = planCommands([{ draw: ["title"] }, { ask: { question: "Sort", on: "c", stage: "own" } } as Command], ids, {
      cardsFor: (id) => (id === "c" ? { cards: ["c_1", "c_2"], offsets: {} } : null),
    });
    const ask = plan.steps.find((s) => s.kind === "ask");
    expect(ask?.kind === "ask" && ask.stage?.sort()).toEqual(["c", "c_1", "c_2", "c_bin_1"]);
  });

  test("a formula: its blanks and its tiles", () => {
    const ids = ["area", "area_blank_1", "area_tiles_1", "title"];
    const plan = planCommands([{ draw: ["title", "area"] }, { ask: { question: "Fill", on: "area", stage: "own" } } as Command], ids, {
      formulaFor: (id) => (id === "area" ? { blanks: 1 } : null),
    });
    const ask = plan.steps.find((s) => s.kind === "ask");
    expect(ask?.kind === "ask" && ask.stage?.sort()).toEqual(["area", "area_blank_1", "area_tiles_1"]);
  });

  test("a tree: the template's own parts whole, never a user element that shares a prefix", () => {
    const tree = ["edge_start_treat", "value_treat", "node_treat"];
    const ids = [...tree, "note", "label_x", "p_x"];
    const plan = planCommands([{ draw: ids }, { ask: { question: "Fill", blanks: ["value_treat"], stage: "own" } } as Command], ids, { templateIds: tree });
    const ask = plan.steps.find((s) => s.kind === "ask");
    expect(ask?.kind === "ask" && ask.stage?.sort()).toEqual(["edge_start_treat", "node_treat", "value_treat"]);
  });

  test("a real decision tree with label_x and p_x beside it: those two are not the tree", () => {
    const spec = expandSpec({
      template: "decision_tree",
      params: { root: TREE_ROOT, rollback: true },
      elements: [
        { id: "label_x", type: "text", text: "Note", x: 80, y: 80 },
        { id: "p_x", type: "text", text: "p", x: 900, y: 80 },
      ],
      commands: [],
    } as unknown as Spec);
    const layout = layoutSpec(spec);
    expect(layout.templateIds).toBeDefined();
    expect(layout.templateIds).not.toContain("label_x");
    expect(layout.templateIds).not.toContain("p_x");
    const plan = planCommands([{ draw: layout.order }, { ask: { question: "EV?", blanks: ["value_treat"], stage: "own" } } as Command], layout.order, { templateIds: layout.templateIds });
    const ask = plan.steps.find((s) => s.kind === "ask");
    if (ask?.kind !== "ask") throw new Error("no ask");
    expect(ask.stage).toContain("value_treat");
    expect(ask.stage!.some((id) => id.startsWith("edge_"))).toBe(true);
    expect(ask.stage).not.toContain("label_x");
    expect(ask.stage).not.toContain("p_x");
  });
});

describe("the player: the rest fades while the question stands", () => {
  test("live: the options full, the rest at 15 %; after the lines everything comes back", async () => {
    const { player, at, speech } = makePlayer(DOORS("own"));
    const during: Record<string, number> = {};
    let lineAt: Record<string, number> = {};
    player.askGate = async () => {
      // A moment for the fade in.
      await new Promise((r) => setTimeout(r, 400));
      for (const id of IDS) during[id] = at(id);
      return "door_2";
    };
    const say = speech.speak.bind(speech);
    speech.speak = (text: string) => {
      if (text === "Yes.") lineAt = Object.fromEntries(IDS.map((id) => [id, at(id)]));
      return say(text);
    };
    await player.play();
    expect(during.door_1).toBe(1);
    expect(during.door_2).toBe(1);
    expect(during.title).toBeCloseTo(STAGE_DIM);
    expect(during.note).toBeCloseTo(STAGE_DIM);
    // Still dimmed while the reveal's line is spoken.
    expect(lineAt.title).toBeCloseTo(STAGE_DIM);
    expect(speech.said).toContain("On we go.");
    for (const id of IDS) expect(at(id)).toBe(1);
  });

  test("fades back over about 300 ms", async () => {
    const { player, at } = makePlayer(DOORS("own"));
    player.askGate = async () => "door_2";
    const seen: number[] = [];
    const timer = setInterval(() => seen.push(at("title")), 2);
    await player.play();
    clearInterval(timer);
    // In-between values on the way back up (a ramp, not a snap).
    const rising = seen.slice(seen.findIndex((a) => a <= STAGE_DIM + 1e-6));
    expect(rising.some((a) => a > STAGE_DIM + 0.05 && a < 0.95)).toBe(true);
  });

  test("without stage nothing fades", async () => {
    const { player, at } = makePlayer(DOORS());
    let title = -1;
    player.askGate = async () => {
      await new Promise((r) => setTimeout(r, 350));
      title = at("title");
      return "door_2";
    };
    await player.play();
    expect(title).toBe(1);
  });

  test("a movie (no gate) never waits on it, and ends at full strength", async () => {
    const { player, at, speech } = makePlayer(DOORS("own"));
    // No askGate: the laser taps the answer and the cast runs on.
    await player.play();
    expect(speech.said).toContain("On we go.");
    for (const id of IDS) expect(at(id)).toBe(1);
  });

  test("a scrub back into the middle of the question puts the figure back at full strength", async () => {
    const { player, at } = makePlayer(DOORS("own"));
    let release: (v: string) => void = () => {};
    player.askGate = (signal) =>
      new Promise((resolve) => {
        release = resolve;
        signal.addEventListener("abort", () => resolve(null as unknown as string));
      });
    const run = player.play();
    await new Promise((r) => setTimeout(r, 400));
    expect(at("title")).toBeCloseTo(STAGE_DIM);
    player.renderUpTo(1);
    expect(at("title")).toBe(1);
    release("door_2");
    await run;
    await new Promise((r) => setTimeout(r, 50));
    // Nothing the aborted question left behind dims it again.
    expect(at("title")).toBe(1);
    expect(at("note")).toBe(1);
    player.renderUpTo(3);
    for (const id of IDS) expect(at(id)).toBe(1);
  });

  test("a guess's live frames carry the dim (the reveal repaints the figure)", async () => {
    const params = { labels: ["A", "B", "C"], values: [40, 80, 20], value_labels: true };
    const spec = expandSpec({ template: "bar_chart", params, commands: [] } as unknown as Spec);
    const layout = layoutSpec(spec);
    const ids = [...layout.order];
    const plan = planCommands([{ draw: ["axes", "bar_1", "bar_3"] }, { ask: { question: "How tall?", on: "bar_2", stage: "own" } } as Command], ids, {
      animateBase: params,
      guessParts: (on) => {
        const parts = guessParts(spec, on);
        return { parts, shows: parts };
      },
    });
    const { els, at } = fakeElements(ids);
    const player = new Player(plan, els, new QuietSpeech(), null, { mode: "narrated", breath: false, effects: effects() });
    const frames: Record<string, number>[] = [];
    const rp: Reprojector = {
      frame: (_p, scene) => void frames.push({ ...scene.opacities }),
      commit: () => els,
      committed: () => null,
    };
    player.reprojector = rp;
    const runtime: GuessRuntime = {
      setup: (on, from, p) => guessSetup(spec, withOverrides(params, p), layout, guessParts(spec, on), { from }),
      patch: (setup, values) => patchFor(spec, setup, values),
    };
    player.guess = runtime;
    let during: Record<string, number> = {};
    player.askGate = async () => {
      await new Promise((r) => setTimeout(r, 400));
      during = { axes: at("axes"), bar_1: at("bar_1"), bar_2: at("bar_2") };
      return "50";
    };
    await player.play();
    expect(during.axes).toBeCloseTo(STAGE_DIM);
    expect(during.bar_1).toBeCloseTo(STAGE_DIM);
    expect(during.bar_2).toBe(1);
    // A reveal frame painted while the question still stands keeps the rest dim.
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some((f) => (f.axes ?? 1) < 0.5 && (f.bar_2 ?? 1) === 1)).toBe(true);
    for (const id of ["axes", "bar_1", "bar_2"]) expect(at(id)).toBe(1);
  });
});

describe("the player: every ask kind with figure parts", () => {
  test("cards: the cards full, the rest faded, back after", async () => {
    const geom = cardsGeometry({ id: "c", type: "cards", rank: true, items: ["Ant", "Bee", "Cat"] } as unknown as CardsElementLike);
    const truth: Record<string, Pt> = {};
    geom.cards.forEach((c, i) => (truth[c] = [geom.truth[i][0] - geom.home[i][0], geom.truth[i][1] - geom.home[i][1]]));
    const ids = ["title", geom.id, ...geom.cards];
    const plan = planCommands([{ draw: ["title", geom.id] }, { ask: { question: "Order", on: geom.id, stage: "own" } } as Command], ids, {
      cardsFor: (id) => (id === geom.id ? { cards: geom.cards, offsets: truth } : null),
    });
    const { els, at } = fakeElements(ids);
    const player = new Player(plan, els, new QuietSpeech(), null, { mode: "narrated", breath: false, effects: effects() });
    player.reprojector = { frame: () => {}, commit: () => els, committed: () => null };
    player.guess = { setup: () => ({ handles: [], pin: {}, warnings: [] }), patch: () => ({ params: {} }), cards: (id) => (id === geom.id ? geom : null) };
    let during: Record<string, number> = {};
    player.askGate = async () => {
      await new Promise((r) => setTimeout(r, 400));
      during = Object.fromEntries(ids.map((id) => [id, at(id)]));
      return encodeArrangement(geom, { order: [0, 1, 2], boxes: [] });
    };
    await player.play();
    expect(during.title).toBeCloseTo(STAGE_DIM);
    for (const id of geom.cards) expect(during[id]).toBe(1);
    for (const id of ids) expect(at(id)).toBe(1);
  });

  test("a tree: the tree full, user elements label_x and p_x beside it faded; a movie runs straight through", async () => {
    const root = {
      id: "start", type: "decision", label: "Choose",
      children: [
        { label: "Treat", node: { id: "treat", type: "chance", label: "", children: [
          { label: "Cured", probability: 0.3, node: { id: "cured", type: "terminal", label: "", payoff: 10 } },
          { label: "Not", node: { id: "not", type: "terminal", label: "", payoff: 4 } },
        ] } },
        { label: "Wait", node: { id: "wait", type: "terminal", label: "", payoff: 5 } },
      ],
    };
    const ids = ["edge_start_treat", "value_treat", "label_x", "p_x"];
    const make = () => {
      const plan = planCommands([{ draw: ids }, { ask: { question: "EV?", blanks: ["value_treat"], stage: "own" } } as Command, { speak: "After." }], ids, {
        templateIds: ["edge_start_treat", "value_treat"],
      });
      const { els, at } = fakeElements(ids);
      const speech = new QuietSpeech();
      const player = new Player(plan, els, speech, null, { mode: "narrated", breath: false, effects: effects() });
      player.reprojector = { frame: () => {}, commit: () => els, committed: () => null };
      player.guess = {
        setup: () => ({ handles: [], pin: {}, warnings: [] }),
        patch: () => ({ params: {} }),
        tree: () => ({
          params: { root, rollback: true } as unknown as DecisionTreeParams,
          boxes: () => new Map([["value_treat", { x: 100, y: 200, w: 30, h: 12 }]]),
          edges: () => ({ edge_start_treat: [[0, 0], [100, 200]] }),
        }),
      };
      return { player, at, speech };
    };
    const live = make();
    let during: Record<string, number> = {};
    live.player.askGate = async () => {
      await new Promise((r) => setTimeout(r, 400));
      during = Object.fromEntries(ids.map((id) => [id, live.at(id)]));
      return encodeTreeAnswer([5.8], null);
    };
    await live.player.play();
    expect(during.label_x).toBeCloseTo(STAGE_DIM);
    expect(during.p_x).toBeCloseTo(STAGE_DIM);
    expect(during.edge_start_treat).toBe(1);
    expect(during.value_treat).toBe(1);
    for (const id of ids) expect(live.at(id)).toBe(1);

    const movie = make();
    (movie.player as unknown as { autoAnswers: boolean }).autoAnswers = true;
    await movie.player.play();
    expect(movie.speech.said).toContain("After.");
    for (const id of ids) expect(movie.at(id)).toBe(1);
  });
});

describe("the player: a market prediction on its own page", () => {
  test("the curve full, the rest faded, back after", async () => {
    const params = { demand: { steepness: "medium" }, supply: { steepness: "medium" }, tax: { amount: 0, side: "seller", kind: "ad_valorem" } };
    const spec = expandSpec({ template: "supply_demand", params, commands: [] } as unknown as Spec);
    const layout = layoutSpec(spec);
    const ids = [...layout.order];
    const plan = planCommands(
      [{ draw: ids }, { ask: { question: "Show it", on: "supply_curve", predict: true, stage: "own" } } as Command, { animate: { "tax.amount": 40 }, duration: 0.2 }],
      ids,
      { animateBase: params, guessParts: (on) => ({ parts: Array.isArray(on) ? on : [on], shows: Array.isArray(on) ? on : [on] }) },
    );
    const { els, at } = fakeElements(ids);
    const player = new Player(plan, els, new QuietSpeech(), null, { mode: "narrated", breath: false, effects: effects() });
    player.reprojector = { frame: () => {}, commit: () => els, committed: () => null };
    player.guess = {
      setup: (on, from, p, _onScreen, o) =>
        guessSetup(spec, withOverrides(params, p), layout, guessParts(spec, on), {
          from,
          ...(o?.end ? { end: { params: withOverrides(params, o.end.params), targets: o.end.targets } } : {}),
        }),
      patch: (setup, values) => patchFor(spec, setup, values),
    };
    const other = ids.find((id) => id !== "supply_curve")!;
    let during: Record<string, number> = {};
    player.askGate = async () => {
      await new Promise((r) => setTimeout(r, 400));
      during = { curve: at("supply_curve"), other: at(other) };
      return "0;40";
    };
    await player.play();
    expect(during.curve).toBe(1);
    expect(during.other).toBeCloseTo(STAGE_DIM);
    for (const id of ids) expect(at(id)).toBe(1);
  });
});

describe("lint: a question whose cards or options sit over the figure", () => {
  const node = (id: string, text: string, x: number, y = 375) => ({ id, type: "node", shape: "rect", text, x, y, width: 160, height: 80 });
  const stageIssues = (spec: Spec) => layoutSpec(expandSpec(spec)).issues.filter((i) => i.rule === "ask-stage");
  const doors = (ask: Record<string, unknown>, extra: object[] = [], draw = ["door_1", "door_2", "door_3"]): Spec =>
    ({
      elements: [node("door_1", "Door 1", 200), node("door_2", "Door 2", 500), node("door_3", "Door 3", 800), ...extra],
      commands: [{ draw }, { ask: { question: "Which?", choose: ["door_1", "door_2", "door_3"], answer: "door_2", ...ask } }],
    }) as unknown as Spec;
  const sticker = { id: "sticker", type: "text", text: "SALE SALE", x: 500, y: 375, size: 22 };

  test("options clear of everything else: no warning", () => {
    expect(stageIssues(doors({}))).toEqual([]);
  });

  test("a drawn text across an option: a warning naming it and suggesting stage own", () => {
    const issues = stageIssues(doors({}, [sticker], ["door_1", "door_2", "door_3", "sticker"]));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].ids).toEqual(["sticker"]);
    expect(issues[0].message).toMatch(/stage: "own"/);
  });

  test("with stage own it is fine; and a text not on screen at the question does not count", () => {
    expect(stageIssues(doors({ stage: "own" }, [sticker], ["door_1", "door_2", "door_3", "sticker"]))).toEqual([]);
    expect(stageIssues(doors({}, [sticker]))).toEqual([]);
  });

  test("cards dealt over a drawn node warn too", () => {
    const cards = { id: "c", type: "cards", rank: true, items: ["Ant", "Bee", "Cat"], x: 200, y: 375, width: 600 };
    const spec = {
      elements: [node("box", "Behind", 500, 375), cards],
      commands: [{ draw: ["box", "c"] }, { ask: { question: "Order them", on: "c" } }],
    } as unknown as Spec;
    const issues = stageIssues(spec);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/cards sit over box/);
    const staged = { ...spec, commands: [{ draw: ["box", "c"] }, { ask: { question: "Order them", on: "c", stage: "own" } }] } as unknown as Spec;
    expect(stageIssues(staged)).toEqual([]);
  });

  test("stage on a typed question does nothing and says so", () => {
    const spec = { elements: [], commands: [{ ask: { question: "Name?", store: "n", stage: "own" } }] } as unknown as Spec;
    const issues = lintCommands(spec).filter((i) => i.rule === "ask-stage");
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/ignored/);
  });

  test("the schema takes stage: own and nothing else", () => {
    expect(validateSpec(doors({ stage: "own" })).ok).toBe(true);
    expect(validateSpec(doors({ stage: "alone" })).ok).toBe(false);
  });
});
