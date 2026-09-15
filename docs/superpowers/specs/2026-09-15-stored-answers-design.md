# Stored answers: names, timing, and carry-over across items

Date: 2026-09-15. Status: design agreed in conversation, not planned, not built.

## 1. The problem

An `ask` can store its answer (`store: name`) and later lines can say
`{name}`. Three gaps:

1. **The store dies with the item.** The variable map belongs to the player,
   and `render()` builds a new player for every playlist item
   (`src/render/player.ts:143`, `src/render/index.ts:345`). Ask for the
   viewer's name in item 1 and `{name}` in item 3 is empty. Chapters are not
   the boundary — a `chapter:` document is only a heading — the *item* is.
2. **Quizzes store nothing.** `store:` exists on `ask` only
   (`src/spec/types.ts:580`). The option a viewer chose is never kept, even
   inside one item; only right/wrong survives, folded into `score`.
3. **No timing.** Neither the player nor the learner report knows how long
   the viewer took to answer.

## 2. Rulings

- **Carry across items, latest wins.** The playlist session keeps one map
  for the whole playlist and seeds each new player with it. A re-answer (a
  `wrong_goto` loop, or the same name stored twice) overwrites. No history.
- **`store:` on quiz too.** The stored value is the chosen option's **text**
  (readable aloud), not its letter. Movies and skipped questions store the
  correct option — the quiz analogue of ask's `default`, so no new field.
- **Automatic names for the throwaway case**, next to the reserved `score`
  and `score_total` (`RESERVED_VARS`, `src/spec/answers.ts`):
  - `answer` — the most recent answer to any quiz or ask;
  - `answer_1`, `answer_2`, … — questions numbered in **playlist order**
    (items concatenated, cards excluded).
  Ordinals are predictable while writing; a slug of the question text is
  not (spaces, punctuation, Norwegian letters, `{name}` tokens inside the
  question, duplicate drill questions). Rejected: question text as name,
  and `_1/_2` suffixes per re-answer — the count is only known at runtime,
  so no line can reference it in advance. Inserting a question shifts
  ordinals, so anything referenced more than once should still carry a
  real `store:` name — same split as element ids.
- **Response time**, measured from the moment the gate opens (the question
  has been read aloud and the viewer can answer) to the answer. Stored as
  seconds with one decimal under `<name>_secs` (`reason_secs`,
  `answer_secs`, `answer_2_secs`). Latest attempt wins. Movies and skipped
  questions never open a gate and store nothing — a line that speaks the
  number must read without it or sit behind an `if`.
- **`score` stays per item** in this round. Cumulative score is the same
  ten lines later, when a lecture asks for a total.
- **The `ask-var` lint is relaxed, not rewritten.** It is a warning, never
  blocks, and never triggers repair. `lintCommands` gets an optional set of
  names stored by earlier items (the editor lints each item on mount and
  knows its index); those names and the automatic ones are not flagged.

## 3. The change, by file

| where | what | size |
|---|---|---|
| `src/spec/types.ts`, `schema.ts` | `store?: string` on `QuizArgs`; schema description | 5 lines |
| `src/spec/answers.ts` | `answer`, `answer_N`, `*_secs` join the reserved list (never lint-flagged) | 3 lines |
| `src/render/player.ts` | on quiz answer set `store`; timestamps around `quizGate`/`askGate`; set `answer`, `answer_<n>`, `<name>_secs`; the ordinal comes from a `questionOffset` option so item 2 continues item 1's numbering | ~25 lines |
| `src/render/index.ts` | `RenderOptions.vars` seeds the player; `RenderOptions.questionOffset`; the handle exposes the player's `vars` | ~8 lines |
| `src/playlist/session.ts` | one carried `Map` and a question counter; pass both into the two *item* mounts (not title page or chapter cards); merge back on item done | ~12 lines |
| `src/lint/lint.ts` | `lintCommands(spec, knownVars?)` | ~5 lines |
| `src/learn.ts` + the course server (external; `apiBase()` in learn.ts) | `secs?: number` on `AnswerPayload`; the server must accept and store the field | ~6 lines here, plus the server |
| tests | two-item session test (ask in 1, `{name}` in 2); quiz store; `_secs` set on gate, absent in export; ordinal continues across items; lint quiet for carried names | 5 tests |
| `src/llm/prompts/compiler-v1.md` | one sentence each: quiz `store`, automatic `answer`/`answer_N`, `_secs`, "stored answers survive into later parts"; prompt-size re-pin | same round (prompt-sync rule) |

Roughly one day. Nothing in layout, plan, export or the engine changes.

## 4. Not in this round

- Teaching the **outline** to tell part N which variables earlier parts
  stored, so a generated lecture uses `{name}` on its own
  (`src/llm/outline.ts` briefs). Separate round, after the runtime has been
  seen working by hand.
- Cumulative `score` / `score_total` across items.
- Any history of re-answers.

## 5. Verification

- `npm test` and `npm run build` (tsc; the Netlify gate).
- Hand smoke: a two-item playlist — item 1 asks `store: name`, item 2 opens
  with `speak: "Hi {name}, that took you {name_secs} seconds."`, then a quiz
  with `store: pick`, then `speak: "You chose {pick}."`; export the movie
  and confirm the default/correct-option fallbacks and no `_secs` text.
