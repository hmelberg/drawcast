# Stored Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every quiz and ask answer is stored — under an explicit `store:` name and under the automatic `_answers` namespace, with seconds and right/wrong — survives across playlist items, and is appended to a local per-cast record.

**Architecture:** The player keeps the variable map (narration and `if` read it); the playlist session seeds each new player from a carried map and a static question offset, so `_answers.N` counts questions in playlist order. Video export mirrors the same names with the auto answers. The record is a separate localStorage append, wired where the answer event already leaves the player (viewer and editor).

**Tech Stack:** TypeScript, vitest (no jsdom — session wiring is guarded by source-text tests, logic by pure helpers), Netlify build runs `npm test && npm run build` (tsc).

**Spec:** `docs/superpowers/specs/2026-09-15-stored-answers-design.md`

## Global Constraints

- Token grammar: `{name}`, `{name.field}`, `{_answers.N}`, `{_answers.N.secs}`, `{_answers.N.ok}`, `{_answers.last}`, `{_answers.last.secs}`, `{_answers.last.ok}`, `{_answers.count}`. Names are lowercased at storage and lookup.
- Reserved: `score`, `score_total` (existing). `_answers` cannot be a store name because store names must start with a letter (existing regex) — no new check needed.
- `_answers.N` is the N-th quiz/ask **command** in playlist order (items concatenated, cards excluded), assigned from the plan at construction — a skipped or re-answered question keeps its ordinal. `_answers.count` = questions answered so far (in this playlist).
- Seconds: from the gate opening to the answer, latest attempt wins, formatted `toFixed(1)`. Only live gates (a viewer) produce them; movies and skipped questions store no `.secs`.
- `.ok` is `"true"`/`"false"`; a collect-mode ask (no `answer`) sets no `.ok`.
- Quiz store value: chosen option's text; skipped or auto: the correct option's text.
- Latest wins on re-answer. No history in variables (the record keeps every attempt).
- `score` stays per item.
- Every prompt/schema sentence added re-pins `tests/prompt-size.test.ts` in the same round, with a dated note.

---

### Task 1: Token grammar and the reserved namespace

**Files:**
- Modify: `src/spec/answers.ts`
- Test: `tests/ask-schema.test.ts` (extend the `subVars` test block)

**Produces:** `VAR_RE` admitting dotted names and a leading underscore; `AUTO_NAMESPACE = "_answers"`; `isReservedVar(name): boolean` (score, score_total, or `_answers` / `_answers.*`); `baseName(name): string` (text before the first dot).

- [ ] **Step 1: Write the failing tests** in `tests/ask-schema.test.ts`:

```ts
import { AUTO_NAMESPACE, baseName, isReservedVar, subVars, VAR_RE } from "../src/spec/answers";

test("dotted and underscore-led tokens interpolate", () => {
  const vars = new Map([["_answers.2", "b"], ["_answers.2.secs", "3.4"], ["age.ok", "true"], ["_answers.last", "b"]]);
  expect(subVars("You chose {_answers.2} in {_answers.2.secs} s; ok={age.ok}; last {_answers.last}; {nope.x}", vars))
    .toBe("You chose b in 3.4 s; ok=true; last b; {nope.x}");
  expect("{_Answers.1}".match(VAR_RE)?.[0]).toBe("{_Answers.1}");
});
test("reserved names and base names", () => {
  expect(AUTO_NAMESPACE).toBe("_answers");
  expect(isReservedVar("score")).toBe(true);
  expect(isReservedVar("_answers")).toBe(true);
  expect(isReservedVar("_answers.3.secs")).toBe(true);
  expect(isReservedVar("age")).toBe(false);
  expect(baseName("age.secs")).toBe("age");
  expect(baseName("age")).toBe("age");
});
```

- [ ] **Step 2: Run** `npx vitest run tests/ask-schema.test.ts` — FAIL (exports missing).
- [ ] **Step 3: Implement** in `src/spec/answers.ts`:

```ts
export const VAR_RE = /\{(_?[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\}/gi;
export const AUTO_NAMESPACE = "_answers";
export function baseName(name: string): string { const i = name.indexOf("."); return i < 0 ? name : name.slice(0, i); }
export function isReservedVar(name: string): boolean {
  const base = baseName(name.toLowerCase());
  return (RESERVED_VARS as readonly string[]).includes(base) || base === AUTO_NAMESPACE;
}
```

- [ ] **Step 4: Run** the file — PASS. Run the full suite once (VAR_RE is shared) — PASS.
- [ ] **Step 5: Commit** `feat(answers): dotted tokens and the _answers namespace`.

### Task 2: `store:` on quiz

**Files:**
- Modify: `src/spec/types.ts` (QuizArgs), `src/spec/schema.ts` (quiz properties + reserved/name checks), `src/render/plan.ts` (quiz step carries `store`), `src/render/player.ts` (quiz case + skip path), `src/export/video.ts` (collectSpeakLines)
- Test: `tests/ask-schema.test.ts`, `tests/score-tally.test.ts`

**Produces:** `QuizArgs.store?: string`; plan quiz step `store?: string`; player sets `vars[store]` to the chosen/correct option text before the feedback lines; export sets it to the correct option.

- [ ] **Step 1: Tests.** Schema (ask-schema.test.ts):

```ts
test("quiz store: a simple name passes, a reserved or malformed one fails", () => {
  expect(validateSpec({ elements: [], commands: [{ quiz: { question: "?", choices: ["a", "b"], correct: 1, store: "pick" } }] }).ok).toBe(true);
  expect(validateSpec({ elements: [], commands: [{ quiz: { question: "?", choices: ["a", "b"], correct: 1, store: "score" } }] }).ok).toBe(false);
  expect(validateSpec({ elements: [], commands: [{ quiz: { question: "?", choices: ["a", "b"], correct: 1, store: "_answers" } }] }).ok).toBe(false);
});
```

Player (score-tally.test.ts):

```ts
test("a quiz with store keeps the chosen option's text; a skip keeps the correct one", async () => {
  const cmds: Command[] = [
    { quiz: { question: "Pick?", choices: ["apples", "pears"], correct: 2, store: "pick" } },
    { speak: "You chose {pick}." },
  ];
  let speech = new RecordingSpeech(); let player = makePlayer(cmds, speech);
  player.quizGate = async () => 0; await player.play();
  expect(speech.spoken.at(-1)).toBe("You chose apples.");
  speech = new RecordingSpeech(); player = makePlayer(cmds, speech);
  player.quizGate = async () => null; await player.play();
  expect(speech.spoken.at(-1)).toBe("You chose pears.");
});
```

Export: in a new `tests/stored-answers.test.ts`:

```ts
import { collectSpeakLines } from "../src/export/video";
test("the movie stores the correct option under a quiz store", () => {
  const lines = collectSpeakLines({ elements: [], commands: [
    { quiz: { question: "Pick?", choices: ["apples", "pears"], correct: 2, store: "pick" } },
    { speak: "You chose {pick}." } ] } as Spec);
  expect(lines.map((l) => l.text)).toContain("You chose pears.");
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** types.ts QuizArgs: `/** Store the chosen option's text under this name; later lines may use {name}. Movies and skips store the correct option. */ store?: string;`. schema.ts quiz.properties: `store: { type: "string", description: "Store the chosen option's TEXT under this simple name (letters, digits, underscores; starts with a letter): later speak lines may use {name}, {name.ok} and {name.secs}. Movies and skipped questions store the correct option." }`; in the quiz validation branch add the same two checks ask has (name regex; `isReservedVar`). plan.ts quiz step type gains `store?: string`; the builder spreads `...(cmd.quiz.store !== undefined ? { store: cmd.quiz.store } : {})`. player.ts quiz case, right after `this.updateScoreVars();`: `if (step.store) this.vars.set(step.store.toLowerCase(), step.choices[chosen ?? step.correct]);` — and in the skip path: `if (step.kind === "quiz" && step.store) this.vars.set(step.store.toLowerCase(), step.choices[step.correct]);`. video.ts inside `if (c.quiz)`: after `publishScore();` add `if (c.quiz.store) vars.set(c.quiz.store.toLowerCase(), c.quiz.choices[c.quiz.correct - 1]);` BEFORE the reveal push.
- [ ] **Step 4: Run** the three files then the full suite — PASS.
- [ ] **Step 5: Commit** `feat(quiz): store the chosen option under store:`.

### Task 3: The `_answers` namespace, `.ok` and `.secs` in the player

**Files:**
- Modify: `src/render/player.ts`
- Test: `tests/stored-answers.test.ts`

**Produces:** `Player` opts gain `vars?: ReadonlyMap<string,string>` (seed) and `questionOffset?: number`; `Player.ordinalOf: Map<number, number>` (step index → 1-based ordinal, built from the plan at construction); private `recordAnswer(index, store, value, ok: boolean|null, secs: number|null)`; `Player.answered: number`.

- [ ] **Step 1: Tests:**

```ts
function makePlayer(commands: Command[], speech: RecordingSpeech, opts: { vars?: Map<string,string>; questionOffset?: number } = {}) {
  return new Player(planCommands(commands, []), new Map(), speech, null, { mode: "narrated", ...opts });
}
test("every question lands under _answers.N with .ok, .secs, last and count", async () => {
  const speech = new RecordingSpeech();
  const player = makePlayer([
    { quiz: { question: "One?", choices: ["a", "b"], correct: 1 } },
    { ask: { question: "Name?", store: "name", default: "friend" } },
    { ask: { question: "Two?", answer: "x" } },
    { speak: "{_answers.1}/{_answers.1.ok} {_answers.2}/{name.ok} {_answers.3}/{_answers.3.ok} last={_answers.last} n={_answers.count}" },
  ], speech);
  player.quizGate = async () => 1; player.askGate = async (_s, step) => (step.store ? "Hans" : "x");
  await player.play();
  expect(speech.spoken.at(-1)).toBe("b/false Hans/{name.ok} x/true last=x n=3");
  expect(player.vars.get("_answers.1.secs")).toMatch(/^\d+\.\d$/);
  expect(player.vars.get("name.secs")).toMatch(/^\d+\.\d$/);
});
test("questionOffset continues the numbering; a seeded map is readable", async () => {
  const speech = new RecordingSpeech();
  const player = makePlayer([
    { quiz: { question: "One?", choices: ["a", "b"], correct: 1 } },
    { speak: "Hi {name}: {_answers.3} then {_answers.1}" },
  ], speech, { vars: new Map([["name", "Hans"], ["_answers.1", "old"]]), questionOffset: 2 });
  player.quizGate = async () => 0; await player.play();
  expect(speech.spoken.at(-1)).toBe("Hi Hans: a then old");
});
test("no gate, no seconds; a skipped question keeps its ordinal", async () => {
  const speech = new RecordingSpeech();
  const player = makePlayer([
    { quiz: { question: "One?", choices: ["a", "b"], correct: 1 } },
    { quiz: { question: "Two?", choices: ["a", "b"], correct: 2 } },
    { speak: "{_answers.2} {_answers.count}" },
  ], speech);
  const answers: (number|null)[] = [null, 1]; player.quizGate = async () => answers.shift() ?? null;
  await player.play();
  expect(speech.spoken.at(-1)).toBe("b 2");
  player.autoAnswers = true; // (a fresh bare player has no gate)
  const bare = makePlayer([{ quiz: { question: "One?", choices: ["a", "b"], correct: 1 } }, { speak: "{_answers.1.secs}" }], new RecordingSpeech());
  await bare.play();
  expect(bare.vars.has("_answers.1.secs")).toBe(false);
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** In the constructor opts type add `vars?: ReadonlyMap<string, string>; questionOffset?: number;`. In the constructor body: `if (opts.vars) for (const [k, v] of opts.vars) this.vars.set(k, v);` then build `this.ordinalOf`: iterate `plan.steps`, `let n = opts.questionOffset ?? 0; steps.forEach((s, i) => { if (s.kind === "quiz" || s.kind === "ask") this.ordinalOf.set(i, ++n); })`. Add fields `readonly ordinalOf = new Map<number, number>(); private answeredSteps = new Set<number>();` and:

```ts
/** Publish one answer under its ordinal (_answers.N), the namespace's last/count, and the explicit store name — value, ok, secs. */
private recordAnswer(index: number, store: string | undefined, value: string, ok: boolean | null, secs: number | null): void {
  const n = this.ordinalOf.get(index);
  const fields = (base: string): void => {
    this.vars.set(base, value);
    if (ok !== null) this.vars.set(`${base}.ok`, ok ? "true" : "false"); else this.vars.delete(`${base}.ok`);
    if (secs !== null) this.vars.set(`${base}.secs`, secs.toFixed(1)); else this.vars.delete(`${base}.secs`);
  };
  if (n !== undefined) { fields(`${AUTO_NAMESPACE}.${n}`); this.answeredSteps.add(index); }
  fields(`${AUTO_NAMESPACE}.last`);
  this.vars.set(`${AUTO_NAMESPACE}.count`, String(this.answeredSteps.size));
  if (store) fields(store.toLowerCase());
}
```

Quiz case: `const live = !this.autoAnswers && this.quizGate !== null; const t0 = performance.now();` before the gate; after the outcome: `const secs = live ? (performance.now() - t0) / 1000 : null; this.recordAnswer(index, step.store, step.choices[chosen ?? step.correct], live ? chosen === step.correct : true, secs);` — replace the Task 2 `if (step.store)` line with this call (the call sets the store too). Ask case: time each `askGate` call (`t0 = performance.now()` right before each await, `lastSecs = (performance.now() - t0)/1000` after, only when `this.askGate` was used and `!this.autoAnswers`); replace the two `if (step.store) this.vars.set(...)` lines with `this.recordAnswer(index, step.store, typed ?? step.fallback ?? step.answer ?? "", null, lastSecs)` at the "Store BEFORE feedback" point (collect mode: ok null — return follows), and after the retry loop, before `this.outcomes.set`, `this.recordAnswer(index, step.store, typed ?? auto, isRight(typed), lastSecs)`. Skip path: `if (step.kind === "quiz" && step.store) ...` stays (Task 2); do not record ordinals for skipped questions. Import `AUTO_NAMESPACE` from `../spec/answers`.
- [ ] **Step 4: Run** the test file and `tests/score-tally.test.ts`, then the full suite — PASS.
- [ ] **Step 5: Commit** `feat(player): _answers namespace with .ok and .secs, seeded vars, question offset`.

### Task 4: Carry across playlist items

**Files:**
- Create: `src/playlist/carry.ts`
- Modify: `src/render/index.ts` (RenderOptions `vars`, `questionOffset` → Player opts), `src/playlist/session.ts`
- Test: `tests/stored-answers.test.ts` (carry helper), `tests/learn-session.test.ts` (source guards)

**Produces:** `questionCount(spec): number`; `questionOffsets(specs): number[]`; `class AnswerCarry { readonly vars = new Map(); absorb(from: ReadonlyMap<string,string>): void }`. `RenderOptions.vars?: ReadonlyMap<string,string>; RenderOptions.questionOffset?: number`.

- [ ] **Step 1: Tests:**

```ts
import { AnswerCarry, questionCount, questionOffsets } from "../src/playlist/carry";
test("question offsets are static sums of earlier items' quiz/ask commands", () => {
  const a = { elements: [], commands: [{ quiz: { question: "?", choices: ["a","b"], correct: 1 } }, { ask: { question: "?", answer: "x" } }, { speak: "x" }] } as Spec;
  const b = { elements: [], commands: [{ ask: { question: "?", store: "n", default: "d" } }] } as Spec;
  expect(questionCount(a)).toBe(2);
  expect(questionOffsets([a, b, a])).toEqual([0, 2, 3]);
});
test("the carry absorbs a player's map, latest wins", () => {
  const c = new AnswerCarry();
  c.absorb(new Map([["name", "Hans"], ["_answers.1", "a"]]));
  c.absorb(new Map([["_answers.1", "b"], ["_answers.count", "1"]]));
  expect(c.vars.get("name")).toBe("Hans"); expect(c.vars.get("_answers.1")).toBe("b");
});
```

Source guards in learn-session.test.ts:

```ts
test("both item mounts seed the render from the carry and its static offset, and every answer is absorbed", () => {
  expect(src.match(/vars: carry\.vars, questionOffset: offsets\[/g)?.length).toBe(2);
  expect(src).toMatch(/onAnswer: \(a\) => \{\s*carry\.absorb\(hd\.timeline\.vars\);/);
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** carry.ts:

```ts
import type { Spec } from "../spec/types";
/** Quiz/ask commands in a spec — one plan step, one ordinal, each. */
export function questionCount(spec: Spec): number { return (spec.commands ?? []).filter((c) => c.quiz !== undefined || c.ask !== undefined).length; }
/** offsets[i] = questions in items before i — static, so a backward jump keeps every ordinal. */
export function questionOffsets(specs: Spec[]): number[] { const out: number[] = []; let n = 0; for (const s of specs) { out.push(n); n += questionCount(s); } return out; }
/** The variables one playlist carries from item to item (spec §2: two stores). */
export class AnswerCarry {
  readonly vars = new Map<string, string>();
  absorb(from: ReadonlyMap<string, string>): void { for (const [k, v] of from) this.vars.set(k, v); }
}
```

index.ts: RenderOptions gains `/** Variables carried from earlier playlist items (playlist/carry.ts). */ vars?: ReadonlyMap<string, string>; /** Questions in earlier items — _answers.N continues from here. */ questionOffset?: number;` and the Player opts object gains `vars: options.vars, questionOffset: options.questionOffset`. session.ts: `const carry = new AnswerCarry(); const offsets = questionOffsets(items.map((i) => i.spec));` after `renderOpts`; both item renders become `render(items[i].spec, host, { ...renderOpts, vars: carry.vars, questionOffset: offsets[i] })` (single path uses `0` as the index literal `offsets[0]`); in chainCallbacks the onAnswer wrapper starts with `carry.absorb(hd.timeline.vars);` and the `"done"` branch also calls `carry.absorb(hd.timeline.vars);` (a collect ask fires no onAnswer). Cards (title, chapter) keep plain `renderOpts`.
- [ ] **Step 4: Run** both test files, full suite — PASS. `npx tsc --noEmit -p .` — clean.
- [ ] **Step 5: Commit** `feat(playlist): carry stored answers across items`.

### Task 5: Export mirrors the names across items

**Files:**
- Modify: `src/export/video.ts` (`collectSpeakLines(spec, carry?)`), the caller that iterates playlist items (find with `grep -n "collectSpeakLines(" src`)
- Test: `tests/stored-answers.test.ts`

**Produces:** `collectSpeakLines(spec: Spec, carry?: { vars: Map<string,string>; questionOffset: number }): SpeakLine[]` — mutates `carry.vars` so the next item continues.

- [ ] **Step 1: Test:**

```ts
test("export names every question _answers.N with the auto answer and carries across items", () => {
  const carry = { vars: new Map<string,string>(), questionOffset: 0 };
  const a = { elements: [], commands: [{ ask: { question: "Name?", store: "name", default: "friend" } }, { quiz: { question: "?", choices: ["a","b"], correct: 2 } }] } as Spec;
  const b = { elements: [], commands: [{ speak: "Hi {name}, {_answers.2}, {_answers.2.ok}, {_answers.last}" }] } as Spec;
  collectSpeakLines(a, carry);
  const lines = collectSpeakLines(b, { ...carry, questionOffset: 2 });
  expect(lines.map((l) => l.text)).toContain("Hi friend, b, true, b");
  expect(carry.vars.has("_answers.1.secs")).toBe(false);
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** `const vars = carry?.vars ?? new Map<string,string>(); let n = carry?.questionOffset ?? 0;` and a local `const auto = (store: string | undefined, value: string, ok: boolean | null) => { n++; for (const base of [`${AUTO_NAMESPACE}.${n}`, `${AUTO_NAMESPACE}.last`, ...(store ? [store.toLowerCase()] : [])]) { vars.set(base, value); if (ok !== null) vars.set(`${base}.ok`, "true"); } vars.set(`${AUTO_NAMESPACE}.count`, String(n)); }`. Quiz: `auto(c.quiz.store, c.quiz.choices[c.quiz.correct - 1], true)` replacing the Task 2 store line. Ask: `auto(c.ask.store, c.ask.answer ?? c.ask.default ?? "", c.ask.answer !== undefined ? true : null)` replacing the store line. Find the playlist-level caller and pass a shared carry with `questionOffsets` from carry.ts.
- [ ] **Step 4: Run** file and suite — PASS.
- [ ] **Step 5: Commit** `feat(export): _answers names and carry in the movie's lines`.

### Task 6: The record

**Files:**
- Create: `src/render/record.ts`
- Modify: `src/render/player.ts` (AnswerEvent gains `id: string; secs?: number`; both onAnswer sites), `src/spec/types.ts` + `src/spec/schema.ts` (`record?: boolean` on Spec), `src/learn.ts` (AnswerPayload `secs?: number`), `src/viewer.ts` (report + append), `src/main.ts` (append in the editor's session, key `local:<doc.id>`)
- Test: `tests/stored-answers.test.ts`, `tests/learn-viewer.test.ts` (source guard)

**Produces:** `interface AnswerRecord { item: number; step: number; id: string; question: string; given: string[]; expected: string; correct: boolean; secs?: number; at: string }`; `appendRecord(storage, castKey, rec): boolean`; `readRecords(storage, castKey): AnswerRecord[]`; `RECORD_PREFIX = "drawcast.answers:"`.

- [ ] **Step 1: Tests:**

```ts
import { appendRecord, readRecords, RECORD_PREFIX } from "../src/render/record";
function memStorage() { const m = new Map<string,string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; }
test("records append per cast and survive a broken entry", () => {
  const s = memStorage();
  expect(appendRecord(s, "o/r/a.yaml", { item: 0, step: 2, id: "name", question: "?", given: ["Hans"], expected: "", correct: true, secs: 1.2, at: "2026-09-16T00:00:00Z" })).toBe(true);
  s.setItem(RECORD_PREFIX + "o/r/b.yaml", "{not json");
  expect(readRecords(s, "o/r/a.yaml")).toHaveLength(1);
  expect(readRecords(s, "o/r/b.yaml")).toEqual([]);
  expect(appendRecord(null, "x", { item: 0, step: 0, id: "_answers.1", question: "?", given: [], expected: "a", correct: false, at: "t" })).toBe(false);
});
test("the answer event names its id and seconds", async () => {
  const events: AnswerEvent[] = [];
  const player = new Player(planCommands([{ quiz: { question: "?", choices: ["a","b"], correct: 1, store: "pick" } }, { ask: { question: "?", answer: "x" } }], []), new Map(), new RecordingSpeech(), null, { mode: "narrated" }, { onAnswer: (e) => events.push(e) });
  player.quizGate = async () => 0; player.askGate = async () => "x"; await player.play();
  expect(events.map((e) => e.id)).toEqual(["pick", "_answers.2"]);
  expect(typeof events[0].secs).toBe("number");
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** record.ts with try/catch around every storage call (the views.ts pattern), array JSON per key, cap at 500 entries (drop oldest). AnswerEvent: `id: string; secs?: number;` set at both sites from `step.store?.toLowerCase() ?? `${AUTO_NAMESPACE}.${this.ordinalOf.get(index)}`` and the same `secs` the record uses (undefined when null). Spec `record?: boolean` ("false stops the player from keeping the viewer's answers in this browser's local record"). learn.ts payload `secs?: number`. viewer.ts onAnswer: build the payload with `...(a.secs !== undefined ? { secs: a.secs } : {})`, then `if (items[index]... ` — simpler: `if (shouldRecord(item.spec)) appendRecord(localStorageOrNull(), castKey ?? `local:${req.gdoc ?? "doc"}`, {...})`; note the onAnswer is only wired when `reporter` exists today — restructure so recording happens regardless of reporter and reporting only with it. main.ts: in the `mountPlaylist` call add `onAnswer: (a, item, index) => { if (item.spec.record !== false) appendRecord(safeLocal(), `local:${doc.id}`, {...}); }`.
- [ ] **Step 4: Run** file, learn tests, suite — PASS; tsc clean.
- [ ] **Step 5: Commit** `feat(record): local per-cast answer record with seconds and ids`.

### Task 7: Lint: carried names, dotted tokens, helpful message

**Files:**
- Modify: `src/lint/lint.ts` (`lintCommands(spec, opts?: { knownVars?: ReadonlySet<string>; questionOffset?: number })`), `src/llm/revise.ts` (pass earlier items' stores + offsets), `src/main.ts` (the editor's per-item lint if it calls lintCommands — it does not; the compile/revise paths do)
- Test: `tests/stored-answers.test.ts`

- [ ] **Step 1: Tests:**

```ts
import { lintCommands } from "../src/lint/lint";
const rules = (spec: Spec, opts?: Parameters<typeof lintCommands>[1]) => lintCommands(spec, opts).filter((i) => i.rule === "ask-var");
test("dotted and _answers tokens never warn; a carried name is known; the message lists the automatic names", () => {
  const spec = { elements: [], commands: [
    { quiz: { question: "?", choices: ["a","b"], correct: 1 } },
    { speak: "{_answers.1} {_answers.1.secs} {_answers.last} {name} {name.secs} {age}" } ] } as Spec;
  const issues = rules(spec, { knownVars: new Set(["name"]), questionOffset: 4 });
  expect(issues).toHaveLength(1);
  expect(issues[0].message).toContain("{age}");
  expect(issues[0].message).toContain("_answers.5 (quiz at commands[0])");
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** `flagVars`: `const base = baseName(name); if (isReservedVar(base)) continue; if (stored.has(base) || opts?.knownVars?.has(base)) continue;` and the message ends with ` — automatic names here: ${autoNames.join(", ") || "none"}` where `autoNames` is built up front from the commands with `questionOffset`. revise.ts: keep a `known = new Set<string>()` and `offset = 0` across items, pass `{ knownVars: known, questionOffset: offset }`, then add the item's `ask.store`/`quiz.store` names and `questionCount`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(lint): ask-var knows carried names, dotted tokens and the automatic names`.

### Task 8: Prompt and schema sync, prompt-size re-pin

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md` (quiz bullet: `store`; ask bullet: `_answers`, `.ok`/`.secs`, carry-over across parts), `tests/prompt-size.test.ts` (re-pin BOTH constants with a dated note)
- Test: `tests/prompt-size.test.ts`

- [ ] **Step 1:** Add to the quiz bullet: `Add "store": "pick" to keep the chosen option's text for later lines ({pick}); every question is ALSO stored automatically as {_answers.N} (N counts questions across the whole lecture), with {_answers.N.ok} (true/false) and {_answers.N.secs} (seconds the viewer took; empty in movies), plus {_answers.last} and {_answers.count} — and a stored name gets {name.ok}/{name.secs} the same way. Stored answers survive into later parts of a lecture.` Add to the ask bullet after the `{name}` sentence: `Use {name.secs} or {_answers.last} the same way as for quiz.`
- [ ] **Step 2:** Run `npx vitest run tests/prompt-size.test.ts`; read the two measured lengths from the failure, re-pin both constants, add a note dated 2026-09-16 naming the two sentences and the deltas.
- [ ] **Step 3:** Run the file — PASS. Commit `docs(prompt): quiz store and the _answers namespace; re-pin prompt size`.

### Task 9: Verification and merge

- [ ] `npx vitest run` — all green; `npm run build` — tsc clean.
- [ ] Update the spec's status line to "built 2026-09-16"; add the round to `ROADMAP.md` under the shipped list (two sentences, with the spec path).
- [ ] Merge `worktree-stored-answers` into `main` (fast-forward or merge), push, verify with `git ls-remote origin main`, then check the Netlify deploy state.
