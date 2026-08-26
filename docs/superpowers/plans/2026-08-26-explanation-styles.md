# Explanation Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make drawcast explanations varied and engaging: screen-first openings, an aha mandate, hook/ingredient/tone/#human tags (Phase 1, prompt+tags+lint), then dialogue forms with two voices and per-line delivery hints (Phase 2, schema+speech).

**Architecture:** Phase 1 is pure prompt/tag/lint work — no schema change: new tag groups in `src/llm/tags.ts`, rewritten narration rules in `src/llm/prompts/compiler-v1.md`, and a new command-level lint that feeds the existing revise loop. Phase 2 adds `voice`/`delivery` fields to speak commands and `voice` (gender) to the spec root, threads them through plan→player→speech, and teaches both speech backends (browser `SpeechManager`, cloud `CloudSpeech`/`BufferSpeech`) to pick voices and apply fixed delivery deltas.

**Tech Stack:** TypeScript, vitest (`npm test`), ajv JSON-schema validation, Web Speech API, Google Cloud TTS.

**Spec:** `docs/2026-08-26-explanation-styles-design.md` — read it before starting; every brief and rule below implements a section of it.

## Global Constraints

- Run the FULL suite (`npx vitest run`) plus `npx tsc --noEmit` before every commit; `npm run build && npm run build:engine` in the final task.
- All tag names single-token lowercase (Hans's naming rule). Tag briefs are English prose sentences ending in a period.
- Determinism: no `Math.random()`/`Date.now()` anywhere in delivery/voice code — same spec must replay identically.
- Backward compatibility: a spec without the new fields must render byte-identically to today (no opts → exact current voice pick and rates).
- The engine build re-exports `SpeechLike` (xplainer implements it): the interface may only GAIN an optional trailing parameter, never change existing ones.
- Do not reformat or reflow untouched prompt lines in `compiler-v1.md` — diffs stay reviewable.

---

### Task 1: Hook tags + `teaching`→`style` rename (tags.ts)

**Files:**
- Modify: `src/llm/tags.ts`
- Test: `tests/tags.test.ts`

**Interfaces:**
- Consumes: existing `TAGS`, `parseTags`, `buildBrief`.
- Produces: `TagGroup` union gains `"style" | "hook"` (drops `"teaching"`); tags `#question`, `#debate`, `#provoke`; exported `const GUARDRAIL: string` reused by Task 2.

- [ ] **Step 1: Write the failing tests** (append to `tests/tags.test.ts`)

```ts
describe("hook tags", () => {
  test("hook tags are exclusive (last wins) and independent of style", () => {
    const r = parseTags("Explain elasticity #question #debate #socratic");
    expect(r.tags).toEqual(["debate", "socratic"]);
    expect(r.clean).toBe("Explain elasticity");
  });
  test("hook briefs are draw-under and debate/provoke carry the guardrail", () => {
    for (const t of ["question", "debate", "provoke"]) {
      const brief = buildBrief([t]).toLowerCase();
      expect(brief).toContain("draw");
    }
    expect(buildBrief(["debate"])).toContain("never manufacture");
    expect(buildBrief(["provoke"])).toContain("never manufacture");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/tags.test.ts` → FAIL (unknown tags surface in `r.unknown`).

- [ ] **Step 3: Implement.** In `src/llm/tags.ts`:
  1. `TagGroup`: replace `"teaching"` with `"style"`, add `"hook"`.
  2. On the `socratic` def, change `group: "teaching"` → `group: "style"`.
  3. Export the shared guardrail (place above `TAGS`):

```ts
/** Shared truthfulness guardrail for reality-referencing tags (spec principle 4). */
export const GUARDRAIL =
  "Only include claims, people, and numbers you are confident are real; if unsure, choose different material — never manufacture a controversy, quote, or statistic.";
```

  4. Add to `TAGS` (after `socratic`):

```ts
  {
    tag: "question",
    group: "hook",
    hint: "open on a question the figure answers",
    brief:
      "Open on a real question: in the first beats, pose the puzzle the figure will answer in a speak line WHILE drawing the setup (never over a blank canvas), let the drawing answer it step by step, and end by answering the opening question explicitly.",
  },
  {
    tag: "debate",
    group: "hook",
    hint: "A says X, B says Y — the drawing decides",
    brief:
      "Open on a disagreement: voice two rival claims ('Some say X; others say Y — who is right?') while drawing both candidate pictures, then resolve it by drawing what is actually true, and strike or cross out the losing claim with an annotation at the moment of resolution. " +
      GUARDRAIL,
  },
  {
    tag: "provoke",
    group: "hook",
    hint: "state a common belief, then draw why it fails",
    brief:
      "Open on a provocation: state a common belief while drawing the naive picture of it, then visibly correct the picture (erase, redraw, or animate) as the narration shows why the belief fails. Only use beliefs people actually hold. " +
      GUARDRAIL,
  },
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/tags.test.ts` → PASS. Then `npx vitest run` (full) + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add src/llm/tags.ts tests/tags.test.ts && git commit -m "feat: hook tags (#question/#debate/#provoke), teaching group renamed to style"`

---

### Task 2: Ingredient tags + `#verylong` refactor (tags.ts)

**Files:**
- Modify: `src/llm/tags.ts`
- Test: `tests/tags.test.ts`

**Interfaces:**
- Consumes: `GUARDRAIL` from Task 1.
- Produces: composable tags `#why #controversy #history #facts #proscons`, `TagGroup` gains `"why" | "controversy" | "history" | "facts" | "proscons"`; `#verylong` brief no longer names controversy/history directly.

- [ ] **Step 1: Write the failing tests**

```ts
describe("ingredient tags", () => {
  test("ingredients stack (each its own group)", () => {
    const r = parseTags("Explain NPV #why #history #facts");
    expect(r.tags).toEqual(["why", "history", "facts"]);
  });
  test("controversy/history/facts carry the guardrail, why/proscons do not need it", () => {
    for (const t of ["controversy", "history", "facts"]) expect(buildBrief([t])).toContain("never manufacture");
  });
  test("verylong now delegates enrichment to ingredients", () => {
    const brief = buildBrief(["verylong"]);
    expect(brief).not.toContain("controversy");
    expect(brief).toContain("TWO enrichment");
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (unknown tags; verylong still says "controversy").

- [ ] **Step 3: Implement.**
  1. `TagGroup` union: add `"why" | "controversy" | "history" | "facts" | "proscons"`.
  2. New defs (after the hook tags), each in its own group so they stack:

```ts
  {
    tag: "why",
    group: "why",
    hint: "say why the concept matters",
    brief:
      "Include the stakes: one or two speak lines on why this concept matters in the real world — who uses it, what goes wrong without it — woven in near the start or the synthesis, within the length budget.",
  },
  {
    tag: "controversy",
    group: "controversy",
    hint: "mention a real debate about the topic",
    brief:
      "Include one genuine controversy or debate related to the topic — what the sides claim and why it is unresolved — in one or two speak lines, within the length budget. " + GUARDRAIL,
  },
  {
    tag: "history",
    group: "history",
    hint: "the person or moment behind the concept",
    brief:
      "Include a brief historical note — the person or moment behind the concept — told in one or two speak lines where it illuminates the idea, within the length budget. " + GUARDRAIL,
  },
  {
    tag: "facts",
    group: "facts",
    hint: "real empirical numbers, not invented ones",
    brief:
      "Ground the explanation in real empirical numbers — actual magnitudes, dates, or study results, not invented placeholders — within the length budget. " + GUARDRAIL,
  },
  {
    tag: "proscons",
    group: "proscons",
    hint: "one strengths-and-weaknesses moment",
    brief:
      "Include one balanced strengths-and-weaknesses moment: what this concept or method does well and where it breaks down, in one or two speak lines, within the length budget.",
  },
```

  3. In the `verylong` def, replace the sentence `"Give context for why the concept matters, include one pros/cons or debate/controversy moment related to it, and optionally a brief historical remark. "` with:

```ts
      "You have room for up to TWO enrichment moments (why it matters, a real debate, a historical note, empirical numbers, or strengths and weaknesses) — pick only what genuinely fits the topic. " +
```

- [ ] **Step 4: Run tests** — tags file then full suite + tsc. (If an existing test pins the old verylong wording, update its expectation to the new sentence.)
- [ ] **Step 5: Commit** — `git commit -m "feat: composable ingredient tags; verylong delegates enrichment to them"`

---

### Task 3: Tone tags + `#human` phase-1 brief (tags.ts)

**Files:**
- Modify: `src/llm/tags.ts`
- Test: `tests/tags.test.ts`

**Interfaces:**
- Produces: `TagGroup` gains `"tone" | "human"`; tags `#fun #dry #pun` (exclusive in `tone`) and `#human`; exported `const RESTRAINT: string`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("tone and human tags", () => {
  test("tone tags are exclusive; human composes with tone", () => {
    const r = parseTags("Explain inflation #pun #dry #human");
    expect(r.tags).toEqual(["dry", "human"]);
  });
  test("every tone brief carries the restraint clause", () => {
    for (const t of ["fun", "dry", "pun"]) expect(buildBrief([t])).toContain("bores fast");
  });
  test("human brief forbids literal stutters", () => {
    expect(buildBrief(["human"])).toContain("th-the");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.**
  1. `TagGroup`: add `"tone" | "human"`.
  2. Shared clause above `TAGS` (next to `GUARDRAIL`):

```ts
/** Shared restraint clause for the tone tags (spec: tone briefs). */
export const RESTRAINT =
  "At most 1–2 light touches per drawcast, never forced — exaggerated humor bores fast — and the explanation stays rigorous; a joke rides on a narrated action and never delays the drawing.";
```

  3. New defs:

```ts
  {
    tag: "fun",
    group: "tone",
    hint: "playful: a quirky tongue-in-cheek example",
    brief:
      "Playful register: let the CONCRETE EXAMPLE itself be quirky or gently absurd, tongue-in-cheek (umbrella rentals in a rainstorm; a zombie outbreak for infection curves) — the numbers stay real and the reasoning exact; only the setting winks. " +
      RESTRAINT,
  },
  {
    tag: "dry",
    group: "tone",
    hint: "deadpan understatement, delivered straight",
    brief:
      "Dry humor: one or two deadpan asides delivered completely straight — understatement, no exclamation marks, the joke never announced. " + RESTRAINT,
  },
  {
    tag: "pun",
    group: "tone",
    hint: "one or two puns, landed at reveals",
    brief:
      "Include one pun, at most two, placed at a reveal so the pun lands on something now visible on the canvas — never in the opening line. " + RESTRAINT,
  },
  {
    tag: "human",
    group: "human",
    hint: "hesitations and natural pauses in the narration",
    brief:
      "Sound human, not machine-read: an occasional hesitation ('Hmm —', 'well,', 'so…') at a genuine thinking moment (a few per drawcast, not per line), at most one self-correction ('about 30 — actually, closer to 33'), and em dashes or ellipses for natural micro-pauses. Never write literal stutters ('th-the') — text-to-speech reads them as glitches.",
  },
```

- [ ] **Step 4: Run tests** — tags then full + tsc.
- [ ] **Step 5: Commit** — `git commit -m "feat: tone tags (#fun/#dry/#pun) and #human (text-level hesitations)"`

---

### Task 4: Command-level lint — slow-start and talky-stretch

**Files:**
- Modify: `src/lint/lint.ts`, `src/llm/revise.ts` (line ~65, inside `checkPlaylist`), `src/llm/compile.ts` (line ~291)
- Test: `tests/lint.test.ts`

**Interfaces:**
- Consumes: `Command`, `Spec` from `src/spec/types` (type-only import).
- Produces: `export function lintCommands(spec: Spec): LintIssue[]`; `LintIssue.rule` union gains `"slow-start" | "talky-stretch"`. Both feed the revise loop's lint report (self-correcting).

- [ ] **Step 1: Write the failing tests** (append to `tests/lint.test.ts`; import `lintCommands` from `../src/lint/lint` and `type Spec` from `../src/spec/types`)

```ts
describe("lintCommands", () => {
  const spec = (commands: object[]): Spec => ({ elements: [{ id: "e1", type: "label", text: "x", attach_to: "e1" }], commands }) as unknown as Spec;

  test("one standalone speak before ink is fine; two warn slow-start", () => {
    expect(lintCommands(spec([{ speak: "Intro." }, { draw: ["e1"] }]))).toEqual([]);
    const issues = lintCommands(spec([{ speak: "One." }, { speak: "Two." }, { draw: ["e1"] }]));
    expect(issues.map((i) => i.rule)).toEqual(["slow-start"]);
    expect(issues[0].severity).toBe("warn");
  });

  test("three consecutive standalone speaks warn talky-stretch once; pauses do not reset the run", () => {
    const issues = lintCommands(
      spec([{ draw: ["e1"] }, { speak: "a" }, { pause: 0.5 }, { speak: "b" }, { speak: "c" }, { speak: "d" }]),
    );
    expect(issues.map((i) => i.rule)).toEqual(["talky-stretch"]);
  });

  test("narrated actions break the run", () => {
    expect(
      lintCommands(spec([{ draw: ["e1"] }, { speak: "a" }, { speak: "b" }, { point: { at: { ref: "e1" } }, speak: "c" }, { speak: "d" }, { speak: "e" }])),
    ).toEqual([]);
  });

  test("speaks with no draw at all count toward slow-start", () => {
    const issues = lintCommands(spec([{ speak: "a" }, { speak: "b" }, { speak: "c" }]));
    expect(issues.map((i) => i.rule).sort()).toEqual(["slow-start", "talky-stretch"]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/lint.test.ts` → FAIL (`lintCommands` not exported).

- [ ] **Step 3: Implement** in `src/lint/lint.ts`:
  1. Extend the rule union: `rule: "overlap-label-label" | "overlap-label-stroke" | "out-of-canvas" | "font-too-small" | "slow-start" | "talky-stretch";`
  2. Add (type-only import `import type { Command, Spec } from "../spec/types";`):

```ts
const ACTION_KEYS = ["draw", "pause", "wait", "show", "hide", "erase", "clear", "highlight", "point", "move", "camera", "animate"] as const;

function isStandaloneSpeak(c: Command): boolean {
  return c.speak !== undefined && !ACTION_KEYS.some((k) => c[k] !== undefined);
}

/** Something new appears or changes on screen. */
function isVisibleAction(c: Command): boolean {
  return c.draw !== undefined || c.show !== undefined || c.animate !== undefined;
}

/**
 * Screen-first lint (spec principle 1): the canvas must start fast and keep
 * moving. Deterministic, spec-level — feeds the same report as lintLayout so
 * the LLM repair round self-corrects talky storyboards.
 */
export function lintCommands(spec: Spec): LintIssue[] {
  const cmds = spec.commands ?? [];
  const issues: LintIssue[] = [];

  let speaksBeforeInk = 0;
  for (const c of cmds) {
    if (isVisibleAction(c)) break;
    if (isStandaloneSpeak(c)) speaksBeforeInk++;
  }
  if (speaksBeforeInk > 1) {
    issues.push({
      rule: "slow-start",
      ids: [],
      message: `${speaksBeforeInk} narration lines before anything is drawn — put the opening line ON the first draw (at most one standalone speak before ink)`,
      severity: "warn",
    });
  }

  // A run of speak/pause commands with 3+ spoken lines and nothing on screen.
  let run = 0;
  for (const c of cmds) {
    const idle = isStandaloneSpeak(c) || (c.pause !== undefined && c.speak === undefined);
    if (!idle) {
      run = 0;
      continue;
    }
    if (isStandaloneSpeak(c)) run++;
    if (run === 3) {
      issues.push({
        rule: "talky-stretch",
        ids: [],
        message: "three or more narration lines in a row with nothing happening on screen — attach speak to draw/point/highlight/animate or interleave an action",
        severity: "warn",
      });
    }
  }
  return issues;
}
```

  3. Wire in `src/llm/revise.ts` `checkPlaylist` (import `lintCommands` next to `lintReportText`): directly after the `lintIssues.push(...layoutSpec(item.spec, measure).issues);` line add `lintIssues.push(...lintCommands(item.spec));`.
  4. Wire in `src/llm/compile.ts` (~line 291): change `lintIssues = layoutSpec(best, measure).issues;` to `lintIssues = [...layoutSpec(best, measure).issues, ...lintCommands(best)];` (import `lintCommands`; keep the local variable names the file actually uses).

- [ ] **Step 4: Run tests** — lint file, then FULL suite (this can flag existing fixtures in `generate-loop`/`revise` tests that were deliberately talky — if a fixture now produces warn issues an assertion counts, fix the fixture by attaching its speaks to draws, not by weakening the rule). Then tsc.
- [ ] **Step 5: Commit** — `git commit -m "feat: screen-first command lint (slow-start, talky-stretch) feeding the revise loop"`

---

### Task 5: Prompt rewrite — screen-first + aha mandate + ingredient choice

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md`, `public/help.html` (tag table)
- Test: existing `tests/prompt.test.ts` / `tests/fewshots.test.ts` (assertion updates only, if they pin changed wording)

**Interfaces:** none (prose). The fewshots/examples bar (≤1 announcement speak before first draw) already matches the new cap — no fewshot churn in this task.

- [ ] **Step 1: Edit `compiler-v1.md`** — four exact changes:

  1. Replace line 3 (the `You are a teacher…` paragraph) with:

```
You are a teacher. Your job is to EXPLAIN one thing so that a viewer who did not understand it before understands it afterwards — and can FEEL that they do. Every drawcast is built around one insight: the sentence the viewer could not have said before watching. Ground it in a concrete example, build step by step so everything converges on that insight, and end by naming what the viewer can now see.
```

  2. In the bullet on line 23, replace the sentence `` `speak` alone is for the opening announcement and the closing synthesis. `` with:

```
`speak` alone is for the rare standalone line (e.g. the closing synthesis) — the opening line belongs ON the first draw.
```

  3. Replace the whole line-30 bullet (`- **Say what you are about to explain.** …`) with these TWO bullets:

```
- **Start on the canvas.** Something must appear within seconds: put the opening line ON the first draw command — announce the goal, or pose the hook, WHILE the first strokes appear. At most ONE short standalone `speak` before any ink, and only when the figure gives it a reason. Never a teaser question or riddle over a blank, unmoving canvas.
- **Keep the canvas moving.** Never more than two consecutive speak-only commands anywhere — between sentences something happens (draw, point, highlight, animate, erase, camera). Prefer attaching every sentence to an action.
```

  4. Append two bullets at the end of the narration bullet list (directly after the `- **Explain step by step, through an example.** …` bullet, before the `Gesture verbs…` paragraph):

```
- **Make it land.** Identify the one insight — the sentence the viewer could not have said before watching — build so every beat converges on its reveal, and end with a one-line synthesis that names what the viewer can now see.
- **Choose one enrichment, or none.** If (and only if) it genuinely fits the topic, weave in ONE brief enrichment moment — why it matters, a real debate, a historical note, an empirical number, or a strengths-and-weaknesses aside. Skip it when nothing earns its place; never stuff several. Only include claims, people, and numbers you are confident are real.
```

- [ ] **Step 2: Update `public/help.html`** — in the #tag table, add rows for the ten new Phase-1 tags using each def's `hint` text verbatim (`question`, `debate`, `provoke`, `why`, `controversy`, `history`, `facts`, `proscons`, `fun`, `dry`, `pun`, `human`), matching the existing rows' markup exactly.
- [ ] **Step 3: Run FULL suite + tsc** — update any prompt-pinning assertions to the new wording (assertion text only; if a test asserts the OLD opening-announcement rule, its expectation flips to the new "Start on the canvas" wording).
- [ ] **Step 4: Manual smoke (cheap):** `node -e "const s=require('fs').readFileSync('src/llm/prompts/compiler-v1.md','utf8'); if(!s.includes('Start on the canvas')||s.includes('The FIRST command is a standalone')) process.exit(1)"` → exit 0.
- [ ] **Step 5: Commit** — `git commit -m "feat: screen-first prompt, aha mandate, choose-one-enrichment default; help.html tag rows"`

**Phase 1 complete — the app is shippable at this commit.**

---

### Task 6: Spec surface — `Command.voice`/`Command.delivery`, `Spec.voice`

**Files:**
- Modify: `src/spec/types.ts`, `src/spec/schema.ts`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Produces: `Command.voice?: "a" | "b"`, `Command.delivery?: "soft" | "grave" | "brisk"`, `Spec.voice?: "male" | "female"`; schema accepts all three; semantic error when voice/delivery appear without speak. Tasks 8–11 rely on these exact names.

- [ ] **Step 1: Write the failing tests** (append to `tests/schema.test.ts`, following its existing valid-spec fixture pattern)

```ts
describe("voice and delivery", () => {
  test("valid: spec voice, command voice+delivery with speak", () => {
    const r = validateSpec({
      voice: "male",
      elements: [{ id: "c1", type: "curve", slope: "down" }],
      commands: [{ draw: ["c1"], speak: "Here.", voice: "b", delivery: "grave" }],
    });
    expect(r.errors).toEqual([]);
  });
  test("voice/delivery without speak is a semantic error", () => {
    const r = validateSpec({
      elements: [{ id: "c1", type: "curve", slope: "down" }],
      commands: [{ draw: ["c1"], voice: "b" }],
    });
    expect(r.errors.join(" ")).toContain("voice and delivery only apply");
  });
  test("bad enum rejected structurally", () => {
    const r = validateSpec({ voice: "robot", elements: [{ id: "c1", type: "curve", slope: "down" }] });
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — voice/delivery rejected as additional properties today.

- [ ] **Step 3: Implement.**
  1. `src/spec/types.ts` — inside `interface Command` (after `blocking`):

```ts
  /** With speak: which dialogue voice reads the line ("a" = lead/teacher, the default; "b" = second voice). */
  voice?: "a" | "b";
  /** With speak: named prosody nudge — soft (confiding), grave (slow reveal), brisk (light recap). Use sparingly. */
  delivery?: "soft" | "grave" | "brisk";
```

  and inside `interface Spec` (after `level`):

```ts
  /** Narrator gender preference (stamped from #male/#female). In dialogue this is speaker "a"; "b" gets the contrast. */
  voice?: "male" | "female";
```

  2. `src/spec/schema.ts` — in `commandSchema.properties` (after `blocking`):

```ts
    voice: {
      type: "string",
      enum: ["a", "b"],
      description: 'With speak in a dialogue: which speaker reads this line — "a" (the lead/teacher, the default) or "b" (the second voice).',
    },
    delivery: {
      type: "string",
      enum: ["soft", "grave", "brisk"],
      description:
        "With speak: named delivery nudge — soft = confiding lean-in (slightly slower, lower, quieter); grave = slow and weighty for the key reveal; brisk = lightly quicker for recaps. Mark only the few lines where the meaning warrants it.",
    },
```

  In the root `specSchema.properties` (after `level`):

```ts
    voice: {
      type: "string",
      enum: ["male", "female"],
      description: 'Narrator voice. Usually stamped from the #male/#female tags — omit unless the request states it. In dialogue this is speaker "a"; speaker "b" gets the contrasting voice.',
    },
```

  In `semanticErrors`, inside the per-command loop (after the `blocking` check):

```ts
    if ((cmd.voice !== undefined || cmd.delivery !== undefined) && cmd.speak === undefined) {
      errors.push(`commands[${i}]: voice and delivery only apply to a command with speak`);
    }
```

- [ ] **Step 4: Run tests** — schema file then full + tsc.
- [ ] **Step 5: Commit** — `git commit -m "feat: spec surface for dialogue voice and delivery hints"`

---

### Task 7: `#male` / `#female` tags → `Spec.voice` stamping

**Files:**
- Modify: `src/llm/tags.ts`, `src/main.ts` (lines ~1928 and ~2069)
- Test: `tests/tags.test.ts`

**Interfaces:**
- Consumes: `Spec.voice` (Task 6).
- Produces: `ParsedTags.voiceGender: "male" | "female" | null`; `TagGroup` gains `"voice"`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("voice tags", () => {
  test("#male/#female parse into voiceGender with empty brief", () => {
    const r = parseTags("Explain GDP #male");
    expect(r.voiceGender).toBe("male");
    expect(r.tags).toEqual(["male"]);
    expect(buildBrief(["male"])).toBe("");
  });
  test("exclusive: last wins", () => {
    expect(parseTags("x #male #female").voiceGender).toBe("female");
  });
  test("absent → null", () => {
    expect(parseTags("Explain GDP").voiceGender).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.**
  1. `TagGroup`: add `"voice"`. New defs (brief `""` — these flow into the SPEC, not the prompt):

```ts
  {
    tag: "male",
    group: "voice",
    hint: "male narrator voice (lead speaker in dialogue)",
    brief: "",
  },
  {
    tag: "female",
    group: "voice",
    hint: "female narrator voice (lead speaker in dialogue)",
    brief: "",
  },
```

  2. `ParsedTags`: add `/** Narrator gender from #male/#female, stamped into the spec (never a brief). */ voiceGender: "male" | "female" | null;` and in `parseTags`'s return, mirror the `level` pattern:

```ts
  const vg = byGroup.get("voice")?.tag ?? null;
  // …in the returned object:
  voiceGender: vg === "male" || vg === "female" ? vg : null,
```

  3. Amend the header comment of `tags.ts`: replace `A tag changes what the AI writes — never how the app plays (playback stays in Settings/controls).` with `A tag changes what lands in the SPEC — commands, briefs that shape them, or spec metadata like level and voice — never Settings (device playback stays in Settings/controls).`
  4. `src/main.ts` — directly under line ~1928 (`if (parsed.level && !outcome.spec.level) outcome.spec.level = parsed.level;`) add:

```ts
    if (parsed.voiceGender && !outcome.spec.voice) outcome.spec.voice = parsed.voiceGender;
```

  and next to line ~2069 (`outcome.spec.level ??= …`) add:

```ts
    outcome.spec.voice ??= parsed.voiceGender ?? undefined;
```

- [ ] **Step 4: Run tests** — tags then full + tsc.
- [ ] **Step 5: Commit** — `git commit -m "feat: #male/#female stamp Spec.voice deterministically"`

---

### Task 8: Delivery table + browser voice selection (speech.ts)

**Files:**
- Create: `src/render/delivery.ts`
- Modify: `src/render/speech.ts`
- Test: create `tests/speech-voices.test.ts`

**Interfaces:**
- Produces (used verbatim by Tasks 9–11):

```ts
// src/render/delivery.ts
export type Delivery = "soft" | "grave" | "brisk";
export interface SpeakOpts { speaker?: "a" | "b"; delivery?: Delivery; gender?: "male" | "female" }
export interface SpeakLine { text: string; speaker?: "a" | "b"; delivery?: Delivery; gender?: "male" | "female" }
export const DELIVERY: Record<Delivery, { rate: number; pitchSt: number; gainDb: number }>;
export function speechKey(line: SpeakLine): string;   // `${gender ?? ""}|${speaker ?? "a"}|${delivery ?? ""}|${text}`
export function dbToGain(db: number): number;          // 10 ** (db / 20)
export function effectiveGender(opts?: SpeakOpts): "male" | "female" | null; // null when no gender/speaker requested
```

- `SpeechLike.speak` gains an optional trailing `opts?: SpeakOpts` (backward compatible — 3-param implementers still satisfy it).
- `SpeechManager.bestVoice(lang, gender?)` — gender filter via known-name lists, falling back to the ungendered best.

- [ ] **Step 1: Create `src/render/delivery.ts`**

```ts
// Named prosody deltas for speak commands (spec: delivery hints). One table
// drives BOTH speech backends so live playback and video export sound alike.
// Deterministic by design — no jitter; variation is authored, never random.

export type Delivery = "soft" | "grave" | "brisk";

export interface SpeakOpts {
  /** Dialogue speaker; "a" (default) is the lead voice, "b" the contrast. */
  speaker?: "a" | "b";
  delivery?: Delivery;
  /** Speaker "a"'s gender (from Spec.voice); "b" gets the opposite. */
  gender?: "male" | "female";
}

export interface SpeakLine {
  text: string;
  speaker?: "a" | "b";
  delivery?: Delivery;
  gender?: "male" | "female";
}

export const DELIVERY: Record<Delivery, { rate: number; pitchSt: number; gainDb: number }> = {
  soft: { rate: 0.93, pitchSt: -1.5, gainDb: -3 },
  grave: { rate: 0.88, pitchSt: 0, gainDb: 0 },
  brisk: { rate: 1.07, pitchSt: 0, gainDb: 0 },
};

/** Canonical cache/buffer key for one spoken line across backends. */
export function speechKey(line: SpeakLine): string {
  return `${line.gender ?? ""}|${line.speaker ?? "a"}|${line.delivery ?? ""}|${line.text}`;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * The gender this line should be voiced in, or null when the caller asked for
 * nothing (legacy path — must keep today's voice pick byte-identical).
 */
export function effectiveGender(opts?: SpeakOpts): "male" | "female" | null {
  if (!opts || (opts.gender === undefined && opts.speaker === undefined)) return null;
  const a = opts.gender ?? "female";
  return (opts.speaker ?? "a") === "a" ? a : a === "male" ? "female" : "male";
}
```

- [ ] **Step 2: Write the failing tests** (`tests/speech-voices.test.ts`)

```ts
import { describe, expect, test } from "vitest";
import { DELIVERY, dbToGain, effectiveGender, speechKey } from "../src/render/delivery";

describe("delivery table", () => {
  test("keys are stable and distinct per speaker/delivery/gender", () => {
    expect(speechKey({ text: "Hi" })).toBe("|a||Hi");
    expect(speechKey({ text: "Hi", speaker: "b", delivery: "soft", gender: "male" })).toBe("male|b|soft|Hi");
  });
  test("effectiveGender: null without request; b contrasts a", () => {
    expect(effectiveGender(undefined)).toBeNull();
    expect(effectiveGender({ speaker: "a" })).toBe("female");
    expect(effectiveGender({ speaker: "b" })).toBe("male");
    expect(effectiveGender({ gender: "male", speaker: "b" })).toBe("female");
  });
  test("deltas are gentle", () => {
    for (const d of Object.values(DELIVERY)) {
      expect(d.rate).toBeGreaterThan(0.8);
      expect(d.rate).toBeLessThan(1.2);
    }
    expect(dbToGain(-3)).toBeCloseTo(0.708, 2);
  });
});
```

Run: `npx vitest run tests/speech-voices.test.ts` → PASS immediately for this file (module exists from Step 1) — the RED half of this task is Step 3's `bestVoice` test; write it now too (same file):

```ts
import { SpeechManager } from "../src/render/speech";

function fakeVoice(name: string, lang: string): SpeechSynthesisVoice {
  return { name, lang, voiceURI: name, localService: true, default: false } as SpeechSynthesisVoice;
}

describe("gendered voice pick", () => {
  test("bestVoice(lang, gender) prefers a known-gender name and falls back to the ungendered best", () => {
    const m = new SpeechManager();
    (m as unknown as { synth: unknown }).synth = { getVoices: () => [fakeVoice("Samantha", "en-US"), fakeVoice("Daniel", "en-GB")] };
    expect(m.bestVoice("en", "male")?.name).toBe("Daniel");
    expect(m.bestVoice("en", "female")?.name).toBe("Samantha");
    (m as unknown as { synth: unknown }).synth = { getVoices: () => [fakeVoice("Samantha", "en-US")] };
    expect(m.bestVoice("en", "male")?.name).toBe("Samantha"); // shared-voice fallback
  });
});
```

(If `SpeechManager`'s constructor requires browser globals, follow the stubbing pattern used by existing speech-touching tests — check `tests/player-sync.test.ts` / `tests/export-pause.test.ts` for the established `vi.stubGlobal` setup — and keep the private-field cast shown above.)

- [ ] **Step 3: Run to verify the bestVoice test fails**, then implement in `src/render/speech.ts`:
  1. Name lists next to the existing GOOD list:

```ts
// Gender is not exposed by the Web Speech API — infer it from well-known
// voice names ("Samantha (Enhanced)" matches by prefix). Unknown names stay
// ungendered and only win when no gendered match exists.
const FEMALE_NAMES = ["Samantha", "Karen", "Victoria", "Moira", "Fiona", "Tessa", "Kate", "Serena", "Allison", "Ava", "Susan", "Zoe", "Nora", "Nicky", "Joana", "Martha"];
const MALE_NAMES = ["Daniel", "Alex", "Oliver", "Thomas", "Fred", "Aaron", "Arthur", "Gordon", "Lee", "Rishi", "Jamie", "Henrik"];

function voiceGenderOf(v: SpeechSynthesisVoice): "male" | "female" | null {
  const name = v.name;
  if (FEMALE_NAMES.some((n) => name.startsWith(n))) return "female";
  if (MALE_NAMES.some((n) => name.startsWith(n))) return "male";
  return null;
}
```

  2. `bestVoice(lang: "en" | "nb", gender?: "male" | "female" | null)`: keep the existing scoring loop, but when `gender` is given run it twice — first over voices whose `voiceGenderOf` matches, and only if that finds nothing fall back to the current ungendered scan. No gender argument → byte-identical behavior.
  3. `SpeechLike.speak` and `SpeechManager.speak` gain `opts?: SpeakOpts` (import type from `./delivery`). Inside `speak`:

```ts
    const d = opts?.delivery ? DELIVERY[opts.delivery] : null;
    const deliveryRate = d?.rate ?? 1;
```

  - fallback estimate: `const estimate = SpeechManager.estimateMs(text) / (speedMultiplier * deliveryRate);`
  - `utterance.rate = Math.min(4, Math.max(0.25, this.rate * speedMultiplier * deliveryRate));`
  - `utterance.pitch = Math.min(2, Math.max(0, 1 + (d?.pitchSt ?? 0) * 0.06));`
  - `utterance.volume = this.mutedFlag ? 0 : dbToGain(d?.gainDb ?? 0);`
  - voice pick: `const g = effectiveGender(opts); const voice = explicit ?? this.bestVoice(lang, g);` (explicit user-chosen voice still wins).

- [ ] **Step 4: Run tests** — new file green, then FULL suite + tsc (no existing test may change behavior: no opts → identical).
- [ ] **Step 5: Commit** — `git commit -m "feat: delivery table and gendered browser voice selection"`

---

### Task 9: Thread voice/delivery through plan and player

**Files:**
- Modify: `src/render/plan.ts`, `src/render/player.ts`, `src/render/index.ts`
- Test: `tests/narrated-actions.test.ts` (or `tests/player-sync.test.ts`, whichever already stubs a speech double)

**Interfaces:**
- Consumes: `Command.voice/.delivery` (Task 6), `SpeakOpts` (Task 8).
- Produces: plan speak-steps carry `speaker?/delivery?`; action steps carry `narrationSpeaker?/narrationDelivery?`; `Player.setNarratorGender(g: "male" | "female" | null)`; every `speech.speak(…)` call passes a `SpeakOpts`.

- [ ] **Step 1: Write the failing test** — in the chosen test file, extend the existing fake-speech pattern to record opts:

```ts
test("player passes speaker, delivery and gender to speech", async () => {
  const calls: Array<{ text: string; opts?: unknown }> = [];
  // reuse the file's existing SpeechLike stub, extending speak to:
  //   speak(text, _m, _s, opts) { calls.push({ text, opts }); return Promise.resolve(); }
  // Build a spec whose commands are:
  //   { draw: ["<some id the fixture already uses>"], speak: "B draws.", voice: "b", delivery: "grave" }
  //   { speak: "A reacts.", voice: "a" }
  // Mount/play it exactly as the file's other tests do, with player.setNarratorGender("male").
  expect(calls[0].opts).toMatchObject({ speaker: "b", delivery: "grave", gender: "male" });
  expect(calls[1].opts).toMatchObject({ speaker: "a", gender: "male" });
});
```

(Adapt the fixture spec/ids and the play/await plumbing to the host file's existing helpers — copy a neighboring test and change only commands + assertions.)

- [ ] **Step 2: Run to verify failure** (opts undefined).

- [ ] **Step 3: Implement.**
  1. `src/render/plan.ts`: the speak step variant becomes `{ kind: "speak"; text: string; blocking: boolean; speaker?: "a" | "b"; delivery?: Delivery }`; set `speaker: cmd.voice, delivery: cmd.delivery` at BOTH sites that build speak steps (lines ~136 and ~292). The step interface's `narration?: string` gains siblings `narrationSpeaker?: "a" | "b"; narrationDelivery?: Delivery` — set them at every site that sets/copies `narration` (grep `narration` in the file; the copy at ~line 99 must copy all three together).
  2. `src/render/player.ts`: add `private narratorGender: "male" | "female" | null = null;` and `setNarratorGender(g: "male" | "female" | null): void { this.narratorGender = g; }`. At the two speak call sites (~275, ~295) append the opts argument:

```ts
this.speech.speak(step.narration, this.speedVal, signal, { speaker: step.narrationSpeaker, delivery: step.narrationDelivery, gender: this.narratorGender ?? undefined })
// and for the standalone speak step:
this.speech.speak(step.text, this.speedVal, signal, { speaker: step.speaker, delivery: step.delivery, gender: this.narratorGender ?? undefined })
```

  3. `src/render/index.ts`: where the `Player` is constructed in `render(…)`, call `player.setNarratorGender(spec.voice ?? null)` (the spec is in scope there; if `render` receives a playlist item, use that item's spec).

- [ ] **Step 4: Run tests** — target file then FULL + tsc.
- [ ] **Step 5: Commit** — `git commit -m "feat: thread dialogue voice and delivery from spec through plan and player"`

---

### Task 10: Cloud TTS voices, delivery, and keyed export buffers

**Files:**
- Modify: `src/export/tts.ts`, `src/export/video.ts` (synthesizeAll call site), `src/playlist/playlist.ts` + `src/playlist/session.ts` (`collectSpeakTexts`/`playlistSpeakTexts` → line descriptors), `src/main.ts:1435`, `src/viewer.ts:98`
- Test: `tests/export.test.ts` (buffer keying) + `tests/speech-voices.test.ts` (voice map)

**Interfaces:**
- Consumes: `SpeakLine`, `SpeakOpts`, `DELIVERY`, `speechKey`, `effectiveGender` (Task 8); step fields (Task 9).
- Produces: `VOICES: Record<"en" | "nb", Record<"female" | "male", { languageCode: string; name?: string }>>`; `synthesizeOne(cfg, text, audioCtx, opts?: SpeakOpts)`; `synthesizeAll(cfg, lines: SpeakLine[], …): Map<string, AudioBuffer>` keyed by `speechKey`; `CloudSpeech.prefetch(lines: SpeakLine[], speedMultiplier: number)`; `playlistSpeakLines(playlist): SpeakLine[]` (replaces `playlistSpeakTexts`).

- [ ] **Step 1: Write the failing tests**

In `tests/speech-voices.test.ts`:

```ts
import { VOICES } from "../src/export/tts";

test("cloud voice map has a gender pair per language", () => {
  for (const lang of ["en", "nb"] as const) {
    expect(VOICES[lang].female.name).toBeTruthy();
    expect(VOICES[lang].male.name).toBeTruthy();
    expect(VOICES[lang].female.name).not.toBe(VOICES[lang].male.name);
  }
});
```

In `tests/export.test.ts` (follow its existing BufferSpeech setup):

```ts
test("BufferSpeech resolves buffers by speechKey, so the same text in two voices stays distinct", async () => {
  // build a buffers map with two entries for text "Hi":
  //   speechKey({ text: "Hi", speaker: "a" }) -> bufferA
  //   speechKey({ text: "Hi", speaker: "b" }) -> bufferB
  // assert BufferSpeech.speak("Hi", 1, undefined, { speaker: "b" }) starts bufferB
  // (assert via the AudioContext/source stubs the file already uses).
});
```

- [ ] **Step 2: Run to verify failure** (`VOICES` not exported / keyed lookup misses).

- [ ] **Step 3: Implement in `src/export/tts.ts`:**
  1. Voice map (exported now):

```ts
/** Per-language, per-gender voice defaults; if a name drifts out of the catalog, the API picks. */
export const VOICES: Record<"en" | "nb", Record<"female" | "male", { languageCode: string; name?: string }>> = {
  en: { female: { languageCode: "en-US", name: "en-US-Neural2-F" }, male: { languageCode: "en-US", name: "en-US-Neural2-D" } },
  nb: { female: { languageCode: "nb-NO", name: "nb-NO-Wavenet-E" }, male: { languageCode: "nb-NO", name: "nb-NO-Wavenet-B" } },
};
```

  2. `synthesizeOne(cfg, text, audioCtx, opts?: SpeakOpts)`: `const g = effectiveGender(opts) ?? "female"; const voice = VOICES[detectLang(text)][g];` and in `audioConfig`: `speakingRate: Math.min(4, Math.max(0.25, cfg.rate * (opts?.delivery ? DELIVERY[opts.delivery].rate : 1)))`, plus — only when a delivery is set — `pitch: DELIVERY[opts.delivery].pitchSt` and `volumeGainDb: DELIVERY[opts.delivery].gainDb` (omit both keys entirely when no delivery, so today's requests are byte-identical).
  3. `CloudSpeech.buffer(text, rate, audioCtx, opts?)`: key becomes `` `${rate.toFixed(2)}|${speechKey({ text, speaker: opts?.speaker, delivery: opts?.delivery, gender: opts?.gender })}` ``; pass opts to `synthesizeOne`. `speak(text, m, signal, opts?)` threads opts to `buffer` and to the `super.speak` fallbacks. `prefetch(lines: SpeakLine[], speedMultiplier)`: for each line call `this.buffer(line.text, rate, ctx, line)`.
  4. `synthesizeAll(cfg, lines: SpeakLine[], …)`: dedup by `speechKey(line)`; `buffers.set(speechKey(line), await synthesizeOne(cfg, line.text, audioCtx, line))`.
  5. `BufferSpeech.speak(text, m, signal, opts?)`: look up `this.buffers.get(speechKey({ text, speaker: opts?.speaker, delivery: opts?.delivery, gender: opts?.gender }))`.
  6. Playlist collection: rename `collectSpeakTexts` → `collectSpeakLines` returning `SpeakLine[]` — for each command with `speak`, emit `{ text: cmd.speak, speaker: cmd.voice, delivery: cmd.delivery, gender: item.spec.voice }`; rename `playlistSpeakTexts` → `playlistSpeakLines` (dedupe by `speechKey`). Update the call sites tsc surfaces: `src/main.ts:1435`, `src/viewer.ts:98` (prefetch takes the lines directly), and the `synthesizeAll` call in `src/export/video.ts`.

- [ ] **Step 4: Run FULL suite + tsc** — every call-site rename must be caught by tsc, none left stringly.
- [ ] **Step 5: Commit** — `git commit -m "feat: cloud TTS gender pair, delivery prosody, speechKey-keyed export buffers"`

---

### Task 11: Dialogue style tags, `#human` part 2, dialogue fewshot, help

**Files:**
- Modify: `src/llm/tags.ts`, `src/llm/prompts/fewshots.json`, `public/help.html`
- Test: `tests/tags.test.ts`, existing `tests/fewshots.test.ts` (the new fewshot must pass its bar unchanged)

**Interfaces:**
- Consumes: everything above. Produces: `style`-group tags `#qa`, `#podcast`, `#story`; extended `#human` brief; one dialogue fewshot.

- [ ] **Step 1: Write the failing tests**

```ts
describe("dialogue style tags", () => {
  test("style tags are exclusive with socratic", () => {
    expect(parseTags("x #socratic #qa").tags).toEqual(["qa"]);
  });
  test("dialogue briefs carry the whiteboard rule and voice marking", () => {
    for (const t of ["qa", "podcast"]) {
      const b = buildBrief([t]);
      expect(b).toContain('voice "a" or "b"');
      expect(b.toLowerCase()).toContain("whiteboard");
    }
  });
  test("human brief now teaches delivery hints", () => {
    expect(buildBrief(["human"])).toContain('"grave"');
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement tags.** New `style`-group defs:

```ts
  {
    tag: "qa",
    group: "style",
    hint: "dialogue: one asks and reacts, one answers and draws",
    brief:
      'Two speakers at a whiteboard, not two people at microphones. Speaker A (voice "a") is the teacher: A answers and draws. Speaker B (voice "b") asks and reacts — and is not a question machine: B also mis-guesses, reacts ("Oh — so the gap IS the loss?"), and summarizes; a wrong guess then corrected is where the insight lands. Mark EVERY speak line with voice "a" or "b". B\'s lines ride on gestures (point at what is being asked about) and A\'s on draws; never more than two speak-only lines in a row — the canvas keeps moving. Scale to the length budget: a short qa is one question, one drawn answer, one reaction.',
  },
  {
    tag: "podcast",
    group: "style",
    hint: "two peers talking informally while sketching",
    brief:
      'Two peers (voices "a" and "b") in an informal conversation at a whiteboard, not two people at microphones — either may draw and narrate; interruptions and sentences finished by the other are welcome, but always over a moving canvas: attach lines to draw/point/highlight/animate wherever possible, never more than two speak-only lines in a row. Mark EVERY speak line with voice "a" or "b".',
  },
  {
    tag: "story",
    group: "style",
    hint: "a historical episode or character, drawn as told",
    brief:
      "Tell it as a story: a historical episode or a running character, drawn as it is told — the timeline, data points, or schematic appear beat by beat with the telling. The story IS the hook; no separate opening needed. " +
      GUARDRAIL,
  },
```

Extend the `#human` brief by appending (inside the same string):

```ts
      ' Where the meaning warrants it, mark 2–4 speak lines with a delivery hint: "soft" for a confiding lean-in, "grave" to let a key reveal land slowly, "brisk" for recaps and transitions; leave all other lines unmarked.'
```

- [ ] **Step 4: Add the dialogue fewshot** to `src/llm/prompts/fewshots.json`: copy fewshot[0]'s `supply_demand` spec (same `template`/`params`/element ids) as the base, request `"Explain with a dialogue why a price ceiling creates a shortage #qa"`. Rewrite ONLY `title` and `commands` as a qa dialogue over those existing ids — every speak line marked `"voice": "a"` or `"voice": "b"`, the opening line ON the first draw, B mis-guessing once, exactly one `"delivery": "grave"` on the key reveal, no more than two consecutive speak-only commands. `tests/fewshots.test.ts` is the gate: the spec must validate, layout, resolve all command ids, and lint clean (including the new `lintCommands`).
- [ ] **Step 5: Update `public/help.html`** — tag rows for `qa`, `podcast`, `story`, `male`, `female` (hints verbatim) and one sentence under the video/narration section: delivery hints (`soft`/`grave`/`brisk`) subtly vary the voice per line and `#male`/`#female` choose the narrator.
- [ ] **Step 6: Run FULL suite + tsc.**
- [ ] **Step 7: Commit** — `git commit -m "feat: qa/podcast/story dialogue styles, human delivery hints, dialogue fewshot"`

---

### Task 12: Final verification

- [ ] **Step 1:** `npx vitest run` — all green.
- [ ] **Step 2:** `npx tsc --noEmit` — clean.
- [ ] **Step 3:** `npm run build && npm run build:engine && node scripts/check-engine-build.mjs` (engine smoke — `SpeechLike` gained only an optional param, xplainer adapters must still typecheck; if the script name differs, use the engine-check script referenced in `package.json`).
- [ ] **Step 4:** Byte-stability spot check: render one existing example spec (no new fields) and confirm no test snapshot moved — the suite covers this, but scan `git diff` for accidental snapshot churn.
- [ ] **Step 5: Commit** any stragglers; report status (do NOT push without Hans's normal flow for this repo — pushing after green is the established default here, so push and state the commit).

## Self-review notes (already applied)

- Spec coverage: principles 1–4 → Tasks 4+5 (screen-first, lint), 5 (aha, choice), 1–3 (guardrail/restraint); dials → 1 (hook), 2 (ingredients), 3 (tone/human), 11 (form); Phase 2 spec surface → 6–7; voices/delivery → 8–10; fewshot/help → 11.
- The `#qa` speaker convention is **a = teacher/lead, b = questioner** (matches "absent voice = a = the default voice"); the design doc's earlier "B in #qa" phrasing was corrected to this in the same commit as this plan.
- `slow-start` allows one standalone opening speak — the same bar `tests/examples.test.ts` already enforces, so no fewshot/example churn in Phase 1.
