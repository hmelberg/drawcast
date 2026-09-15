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
- **Two stores.** *Variables* live in the player's map, are what narration
  and `if` read, survive items and chapters within one playlist, and die
  with the drawcast. *The record* lives in localStorage under the cast key,
  is what the student examines and a later submit sends, and survives
  reloads. Naming only matters for variables; the record identifies a
  question by cast, item, step and its text.
- **Automatic variables live in one namespace, `answers`**, so they can
  never collide with an author's `store:` name. Every quiz and ask is
  stored, always, no flag:
  - `{_answers.N}` — the N-th question in playlist order (items
    concatenated, cards excluded), its chosen option text or typed answer;
  - `{_answers.N.secs}`, `{_answers.N.ok}` — its seconds and right/wrong;
  - `{_answers.last}` — the most recent answer; `{_answers.count}`.
  The player's map is keyed by string, so a dotted key is just a key and
  `if.var` reads it unchanged (`src/render/player.ts:796`); only `VAR_RE`
  (`src/spec/answers.ts:6`) and the lint's copy admit dots and a leading underscore. The underscore is the "reserved" mark: no author or model picks it for a store name. Dotted tokens
  already exist for params (`{codeId.variable}`). `_answers` and `score` are
  the two reserved words; a `store:` of either is a lint error.
- **Explicit names get the same shape**: `store: age` gives `{age}`,
  `{age.secs}`, `{age.ok}`. Ordinals are predictable while writing; a slug
  or hash of the question text is not (spaces, punctuation, Norwegian
  letters, `{name}` tokens inside the question, duplicate drill questions,
  and every rephrase silently breaks the reference — an unknown token is
  spoken as its braces). Rejected: question text as name, `_1/_2` per
  re-answer (runtime count), reversible hashing (the report already carries
  the text). Inserting a question shifts ordinals, so anything referenced
  more than once carries a real `store:` name — same split as element ids.
- **Response time**, measured from the moment the gate opens (the question
  has been read aloud and the viewer can answer) to the answer, seconds
  with one decimal. Latest attempt wins. Movies and skipped questions never
  open a gate and store no time — a line that speaks the number must read
  without it or sit behind an `if`.
- **The record** is the existing answer event (`AnswerPayload`,
  `src/learn.ts:36`: item, step, question, every attempt, expected,
  correct) plus `secs` and `id: store ?? "_answers.N"`, appended per cast
  under a `drawcast.answers:` prefix. On by default; a spec-level
  `record: false` turns it off. Writing to the student's own browser sends
  nothing. Enrolled students keep the per-answer streaming to the course
  server as today, with `secs` added to the payload.
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
| `src/spec/answers.ts` | `VAR_RE` admits dotted names; reserved words `_answers`, `score` | 3 lines |
| `src/render/player.ts` | on quiz answer set `store`; timestamps around `quizGate`/`askGate`; set `answers.<n>`, `.secs`, `.ok`, `answers.last/count`, and `<store>.secs/.ok`; the ordinal comes from a `questionOffset` option so item 2 continues item 1's numbering | ~30 lines |
| `src/render/index.ts` | `RenderOptions.vars` seeds the player; `RenderOptions.questionOffset`; the handle exposes the player's `vars` | ~8 lines |
| `src/playlist/session.ts` | one carried `Map` and a question counter; pass both into the two *item* mounts (not title page or chapter cards); merge back on item done | ~12 lines |
| `src/lint/lint.ts` | `lintCommands(spec, knownVars?)`; dotted tokens; `store:` of a reserved word is an error; the panel lists each question's automatic name ("quiz at commands[4] stores as _answers.3") | ~20 lines |
| `src/render/record.ts` (new) + `src/spec/types.ts` | append each answer event + secs to localStorage per cast key; `record?: boolean` on the spec | ~30 lines |
| `src/learn.ts` + the course server (external; `apiBase()` in learn.ts) | `secs?: number` on `AnswerPayload`; the server must accept and store the field | ~6 lines here, plus the server |
| tests | two-item session test (ask in 1, `{name}` in 2); quiz store; `.secs` set on gate, absent in export; ordinal continues across items; lint quiet for carried names and loud for `store: _answers`; record appended and `record: false` respected | 7 tests |
| `src/llm/prompts/compiler-v1.md` | one sentence each: quiz `store`, the `_answers.N` namespace with `.secs`/`.ok`, the dotted token in `speak`, "stored answers survive into later parts"; prompt-size re-pin | same round (prompt-sync rule) |

Roughly a day and a half. Nothing in layout, plan, export or the engine changes.

## 4. Not in this round

- Teaching the **outline** to tell part N which variables earlier parts
  stored, so a generated lecture uses `{name}` on its own
  (`src/llm/outline.ts` briefs). Separate round, after the runtime has been
  seen working by hand.
- Cumulative `score` / `score_total` across items.
- Any history of re-answers in the variables (the record keeps every attempt).
- **Submit.** One button that sends the record: to the course server when
  enrolled (a batch of the existing payload, with a submission id so a
  second press never double-counts), otherwise as something the student
  sends themselves (copied text, a file, a link). A "My answers" panel
  reading the record, per cast and across casts in that browser. The
  teacher's page groups by `id` (a `store:` name survives rephrasing; an
  ordinal survives it too but not reordering) and falls back to text.

## 5. Verification

- `npm test` and `npm run build` (tsc; the Netlify gate).
- Hand smoke: a two-item playlist — item 1 asks `store: name`, item 2 opens
  with `speak: "Hi {name}, that took you {name.secs} seconds."`, then a quiz
  with `store: pick`, then `speak: "You chose {pick}, and {_answers.last} was
  your latest answer."`; export the movie and confirm the default/
  correct-option fallbacks and no seconds text; check localStorage holds
  three records with `secs` and that `record: false` leaves it empty.
