// The identify quiz's stage loop (interactivity spec §9 "identify", §13):
// a figgate overlay poses generated "click the ___" drills against the
// paused figure — same widget geometry as the ask gates, same marks, but
// intrinsic: no spec, no plan steps, never mounted by export. Free play
// stands down automatically while it runs (the instruments' blocked()
// checks see the .cs-figgate). A wrong click reveals the target, a right
// piano click sounds its note; five questions, a score, Again ↻.
//
// Three data spaces, one loop. A question is a prompt plus the set of
// answers that count plus the cells to ring on a miss — the set is what lets
// the periodic table ask "click a halogen", where five different clicks are
// all correct, without the loop knowing anything about chemistry.

import type { RenderHandle } from "../render";
import {
  chessSquareAt,
  chessSquareBox,
  periodicCellAt,
  periodicCellBox,
  periodicSymbols,
  pianoKeyAt,
  pianoKeyBox,
  pianoOctaves,
} from "../render/widgets";
import { elementBBoxes, elementRings } from "../layout/layout";
import type { BBox } from "../layout/geometry";
import { leafDrawables, type TextDrawable } from "../layout/model";
import { INITIAL_STATE } from "../render/plan";
import { makeBrowserMeasure } from "../render/svg-backend";
import { getLoadedEngines } from "../scenes/engines";
import type { ElementsEngine } from "../scenes/elements/types";
import type { AnatomyEngine } from "../scenes/anatomy/types";
import { scenes } from "../scenes/registry";
import { clientPointFor, h, logicalPoint } from "./dom";
import { hitElement } from "./hit";
import { partsOf, partsQuizTargets, type Part } from "./parts-model";
import { chessQuizTargets, periodicQuizTargets, pianoQuizTargets, quizPrompt, type Activity } from "./quiz-model";

const QUIZ_LEN = 5;
const RIGHT_LINGER_MS = 700;
const WRONG_LINGER_MS = 1500;

/** One question: what to ask, what counts, and what a miss should reveal. */
interface Question {
  prompt: string;
  accepts: string[];
  reveal: string[];
}

/**
 * The figure's named parts (parts-model.ts), read off the mounted layout:
 * the command-addressable boxes, and every drawn word with the top-level
 * drawable it belongs to — the same walk the info card does, because a
 * drawn word's owner is only reliable from the drawable tree. Measured with
 * the browser's own text metrics, once per call; the tray calls it once to
 * decide whether to offer the drill, the drill once more when it starts.
 */
export function partsFor(hd: RenderHandle): Part[] {
  const ownerOf = new Map<string, string>();
  for (const top of hd.layout.drawables) for (const leaf of leafDrawables([top])) ownerOf.set(leaf.id, top.id);
  const texts = leafDrawables(hd.layout.drawables)
    .filter((d): d is TextDrawable => d.kind === "text")
    .map((d) => ({ id: d.id, text: d.text, owner: ownerOf.get(d.id) }));
  return partsOf(hd.spec, { boxes: elementBBoxes(hd.layout, makeBrowserMeasure()), texts, sceneNames: sceneNamesFor(hd) });
}

/**
 * Names the SCENE knows for its parts (interactivity spec §6: the knowledge
 * lives in the template): a body figure's atlas names, in the figure's own
 * language. That is what lets the drill run with the labels OFF — the
 * anatomy example that says "let me explore the body myself" draws no
 * names, and asking "click the liver" there is the whole point. Read off
 * the manifest's `explore` flag, never the template id.
 */
function sceneNamesFor(hd: RenderHandle): { id: string; name: string }[] {
  const explore = hd.spec.template ? scenes[hd.spec.template]?.manifest.explore : undefined;
  if (explore !== "body") return [];
  let eng: AnatomyEngine;
  try {
    eng = getLoadedEngines(["anatomy"]).anatomy as AnatomyEngine;
  } catch {
    return []; // a body cannot be on screen without its engine, but never throw at a viewer
  }
  const p = (hd.spec.params ?? {}) as Record<string, unknown>;
  const lang = p.names === "nb" || p.names === "la" ? p.names : "en";
  const sex = p.sex === "female" || p.sex === "male" ? p.sex : "neutral";
  const all = eng.parts({ systems: ["skeleton", "viscera"], sex });
  const out: { id: string; name: string }[] = [];
  for (const id of hd.layout.order) {
    const part = all[id];
    if (part) out.push({ id, name: part.name[lang] ?? part.name.en });
  }
  return out;
}

export function mountQuiz(stage: HTMLElement, hd: RenderHandle, activity: Activity): void {
  stage.querySelector(".cs-quizgate, .cs-vsgate")?.remove();
  const kind = activity.kind;
  const flip = hd.spec.params?.["flip"] === true;
  const octaves = pianoOctaves(hd.spec.params);

  // The periodic table's geometry is the layout's own cell ids, so the boxes
  // are measured once here rather than recomputed per click (the info card
  // caches the same map for the same reason).
  let cellBoxes: ReadonlyMap<string, BBox> | null = null;
  const boxes = (): ReadonlyMap<string, BBox> => (cellBoxes ??= elementBBoxes(hd.layout, makeBrowserMeasure()));

  // The generic identify drill's data space: the figure's named parts, their
  // outlines for the hit test (a liver's box swallows half a lung — hit.ts),
  // and the words that print their names, hidden while the drill runs so
  // "find the bridge" is not a reading test, and restored when it ends.
  const parts: Part[] = kind === "parts" ? partsFor(hd) : [];
  const partById = new Map(parts.map((p) => [p.id, p]));
  const rings = kind === "parts" ? elementRings(hd.layout) : undefined;
  let askable: Part[] = [];
  let hiddenNames: string[] = [];
  const hideNames = (): void => {
    hiddenNames = [...new Set(askable.flatMap((p) => p.nameIds))];
    hd.timeline.dimElements(hiddenNames, 0);
  };
  const showNames = (): void => {
    hd.timeline.dimElements(hiddenNames, 1);
    hiddenNames = [];
  };

  const gate = h("div", { class: "cs-figgate cs-quizgate" });
  const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" });
  const closeBtn = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", title: "Close the quiz" }, "✕");
  gate.append(hint, closeBtn);

  let questions: Question[] = [];
  let i = 0;
  let score = 0;
  let waiting = false; // the linger between questions ignores clicks
  let timer = 0;
  let dead = false;

  const teardown = (): void => {
    if (dead) return;
    dead = true;
    window.clearTimeout(timer);
    hd.timeline.callbacks.onState = prevOnState;
    hd.timeline.callbacks.onStep = prevOnStep;
    showNames();
    stage.classList.remove("cs-exploring");
    gate.remove();
  };

  // Any honest timeline movement ends the drill — play resumes the movie,
  // a scrub/step lands a different scene under the questions. Chained, and
  // restored on teardown (nothing else chains during the quiz's lifetime).
  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing") teardown();
  };
  const prevOnStep = hd.timeline.callbacks.onStep;
  hd.timeline.callbacks.onStep = (completed, total) => {
    prevOnStep?.(completed, total);
    teardown();
  };

  const clearMarks = (): void => {
    for (const m of gate.querySelectorAll(".cs-figgate-mark")) m.remove();
  };

  const markAt = (clientX: number, clientY: number, cls: string): void => {
    const gr = gate.getBoundingClientRect();
    const m = h("span", { class: `cs-figgate-mark${cls ? ` ${cls}` : ""}` });
    m.style.left = `${clientX - gr.left}px`;
    m.style.top = `${clientY - gr.top}px`;
    gate.appendChild(m);
  };

  /** Where one answer lives on the figure, in logical units. */
  const boxFor = (answer: string): BBox | null =>
    kind === "parts"
      ? (partById.get(answer)?.box ?? null)
      : kind === "chess"
        ? chessSquareBox(flip, answer)
        : kind === "piano"
          ? pianoKeyBox(octaves, answer)
          : periodicCellBox(boxes(), answer);

  /** The answer under a click, or null off the instrument. For parts: the
   *  smallest askable part whose outline (or box) contains the click — the
   *  click ask's own rule, with the same fat-finger slop. */
  const hitAt = (p: [number, number]): string | null =>
    kind === "parts"
      ? hitElement(new Map(askable.map((q) => [q.id, q.box])), p, 18, rings)
      : kind === "chess"
        ? chessSquareAt(flip, p)
        : kind === "piano"
          ? pianoKeyAt(octaves, p)
          : periodicCellAt(boxes(), p);

  /** The steel ring on every cell the question would have accepted. */
  const revealTarget = (): void => {
    for (const answer of questions[i].reveal) {
      const box = boxFor(answer);
      const c = box && clientPointFor(stage, [box.x + box.w / 2, box.y + box.h / 2]);
      if (!c) continue;
      const m = h("span", { class: "cs-figgate-mark from" });
      m.style.left = `${c[0]}px`;
      m.style.top = `${c[1]}px`;
      gate.appendChild(m);
    }
  };

  const soundNote = (note: string): void => {
    try {
      hd.timeline.tones?.play([{ notes: `${note}:q` }], 160);
    } catch {
      /* silent */
    }
  };

  const ask = (): void => {
    clearMarks();
    waiting = false;
    // The drill's own icon, from the pill the viewer pressed — slicing code
    // units off an emoji is a trap waiting for a two-glyph label.
    const icon = activity.label.split(" ")[0];
    hint.textContent = `${icon} ${questions[i].prompt} · ${i + 1}/${questions.length}`;
  };

  const showFinal = (): void => {
    clearMarks();
    showNames(); // the score is read with the names back on
    hint.textContent = `🎯 ${score}/${questions.length}${score === questions.length ? " — perfect!" : ""}`;
    const again = h("button", { class: "cs-cardgate-pill cs-quiz-again" }, "Again ↻");
    again.addEventListener("click", (e) => {
      e.stopPropagation();
      again.remove();
      start();
    });
    gate.appendChild(again);
  };

  /** The drawn elements this figure can be asked about — the drill's whole
   *  data space, exactly as the piano's is the keys it drew. */
  const drawnElements = () => {
    let eng: ElementsEngine;
    try {
      eng = getLoadedEngines(["elements"]).elements as ElementsEngine;
    } catch {
      return []; // a periodic figure cannot be on screen without its engine, but never throw at a viewer
    }
    return periodicSymbols(boxes().keys())
      .map((s) => eng.bySymbol(s))
      .filter((e): e is NonNullable<typeof e> => e !== null);
  };

  const start = (): void => {
    if (kind === "parts") {
      // Only what is on screen at this boundary can be asked — a part the
      // storyboard has not drawn yet is not a wrong answer, it is absent.
      const n = hd.timeline.position;
      const visible = new Set(n > 0 ? hd.plan.states[n - 1].visible : INITIAL_STATE.visible);
      askable = parts.filter((p) => visible.has(p.id));
    }
    questions =
      kind === "parts"
        ? partsQuizTargets(QUIZ_LEN, askable)
        : kind === "chess"
          ? chessQuizTargets(QUIZ_LEN).map((sq) => ({ prompt: quizPrompt("chess", sq), accepts: [sq], reveal: [sq] }))
          : kind === "piano"
            ? pianoQuizTargets(QUIZ_LEN, octaves).map((n) => ({ prompt: quizPrompt("piano", n), accepts: [n], reveal: [n] }))
            : periodicQuizTargets(activity.id, QUIZ_LEN, drawnElements());
    i = 0;
    score = 0;
    if (questions.length === 0) {
      // Nothing this figure can be asked (a table showing one element, a
      // family drill with no family of two, a figure whose named parts are
      // still undrawn). Say so rather than showing an empty gate the viewer
      // has to work out for themselves.
      hint.textContent = kind === "parts" ? "Nothing named is drawn yet — play a little further, then try again." : "Not enough drawn here to quiz — try the whole table.";
      return;
    }
    if (kind === "parts") hideNames();
    ask();
  };

  gate.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target instanceof Element && e.target.closest("button")) return;
    if (waiting || dead || questions.length === 0) return;
    const p = logicalPoint(stage, e);
    const hit = p && hitAt(p);
    if (!hit) return; // off the instrument: not an answer
    waiting = true;
    const right = questions[i].accepts.includes(hit);
    markAt(e.clientX, e.clientY, right ? "" : "wrong");
    if (right) {
      score++;
      if (kind === "piano") soundNote(questions[i].accepts[0]);
    } else {
      revealTarget();
    }
    timer = window.setTimeout(
      () => {
        i++;
        if (i >= questions.length) showFinal();
        else ask();
      },
      right ? RIGHT_LINGER_MS : WRONG_LINGER_MS,
    );
  });

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    teardown();
  });

  stage.classList.add("cs-exploring"); // the big ▶ hides under the gate
  stage.appendChild(gate);
  start();
}
