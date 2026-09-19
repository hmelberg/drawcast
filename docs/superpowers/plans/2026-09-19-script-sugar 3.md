# Script Sugar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A direction reads like a sentence — `box hush "Husholdninger" left`, `arrow bedr -> hush curved blue` — in both directions, so the editor shows it that way too.

**Architecture:** One new module, `src/spec/script/sugar.ts`, holding every alias and shorthand as DATA, read by the parser on the way in and the printer on the way out. Neither side gets a private copy: a table entry that cannot be written back is a table entry that breaks the corpus gate, which is exactly the check that keeps sugar from costing fidelity.

**Tech Stack:** TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-script-dsl-design.md` §6 (the sugar layer) and §11 (the two lint rules). Phases 1 and 2 shipped 2026-09-19.

## Global Constraints

- **The round-trip gate is the acceptance criterion, unchanged**: `parse(print(spec))` deep-equals `spec` for all 258 bundled examples and every scene pack's params, and printing twice changes nothing. Sugar that cannot be written back does not ship.
- **The deploy gate is `npm test && npm run build`.** vitest does not typecheck.
- **Every alias is reversible.** The printer emits a shorthand only when the field it stands for holds exactly the value the shorthand means (`thick` only for `stroke_width: 3`).
- **Parse-only sugar is allowed where a fold would be lossy** — and must be named as such, not left to be discovered.
- Work on branch `round/script-sugar`; merge and push in the last task.

## File Structure

| File | Responsibility |
|---|---|
| `src/spec/script/sugar.ts` | **new** — the alias tables and the two functions that apply them, one per direction. |
| `src/spec/script/parse.ts` | reads shorthands out of a direction's tokens. |
| `src/spec/script/print.ts` | writes them back. |
| `src/spec/script/lines.ts` | `*` / `+` choice lines. |
| `tests/script-sugar.test.ts` | **new** |
| `tests/script-roundtrip.test.ts` | unchanged — it is the gate, and it must stay green at every step. |

---

### Task 1: The alias tables and the shorthand reader

**Files:**
- Create: `src/spec/script/sugar.ts`
- Modify: `src/spec/script/parse.ts`
- Test: `tests/script-sugar.test.ts`

**Interfaces:**
- Produces: `ELEMENT_ALIASES`, `FLAGS`, `isColor`, `readShorthand(type, token, next)`, `sugarFor(el)`.

Aliases: `box`/`circle`/`person`/`decision`/`chance`/`terminal` → `node` with that `shape`; `note` → `text`; `dot` → `point` (already in place).

Flags: `dashed` → `style.dash: true`; `thick`/`thin` → `style.stroke_width: 3`/`1`; `curved`, `smooth`, `closed` → `true`; `rising`/`falling`/`flat` → `direction`; `convex`/`concave`/`linear` → `curvature`; `gentle`/`medium`/`steep` → `steepness`; `typed`/`instant` → `draw.mode`.

Values: a `#hex` or CSS colour name → `style.color`; `3s` → `draw.duration` on an element, `duration` on a verb; `a -> b` → `from.ref`/`to.ref`.

Placement: a side word followed by a bare id → `at: {side, ref}`; a side word alone → `side` on a label, `at: {place}` on anything else.

- [ ] **Step 1: Write the failing test** — see `tests/script-sugar.test.ts` in Task 1's test block below.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Write `sugar.ts` and read it from `parseDirection`.**
- [ ] **Step 4: Run the sugar test AND the round-trip gate.** The gate must still pass: parsing sugar cannot change what the printer produces yet.
- [ ] **Step 5: Commit.**

### Task 2: The printer writes the same sugar

**Files:** `src/spec/script/print.ts`, `tests/script-sugar.test.ts`

- [ ] **Step 1: Write the failing test** — every element in the sugar test prints back in its sugared form.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Teach `elementLine` to emit shorthands**, in a fixed order: head, id, text, `->`, placement, flags, colour, then the remaining `key value` pairs.
- [ ] **Step 4: Run the gate.** This is where a non-reversible alias shows up as 258 broken examples; fix the table, not the gate.
- [ ] **Step 5: Commit.**

### Task 3: Quiz choice lists

**Files:** `src/spec/script/lines.ts`, `parse.ts`, `print.ts`, `tests/script-sugar.test.ts`

`*` is a choice, `+` is the correct one, one level deeper than the `quiz` line.

- [ ] **Step 1: Write the failing test.**
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement** — the scanner keeps `*`/`+` as the head, the parser turns a run of them into `choices` + `correct`, the printer writes them back.
- [ ] **Step 4: Run the gate.**
- [ ] **Step 5: Commit.**

### Task 4: Connector labels, parse-only

**Files:** `src/spec/script/parse.ts`, `tests/script-sugar.test.ts`

`arrow lonn bedr -> hush "Lønn og inntekt"` also mints the attached label.

**This one does not print back**, deliberately: the label element carries an id (`l_lonn`, `label_S` — the corpus has no convention), and a fold that has to invent one is a fold that loses it. So the sugar helps the writer, the printer canonicalizes to two lines, and the gate is untouched. Named here so it is a decision, not a surprise.

- [ ] **Step 1: Write the failing test**, including one asserting the reprint is two lines.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the gate.**
- [ ] **Step 5: Commit.**

### Task 5: The two lint rules

**Files:** `src/spec/script/parse.ts`, `src/playlist/playlist.ts`, `tests/script-sugar.test.ts`

1. A spoken line whose first word is a known head and which has no sentence punctuation — *"line 7: this looks like a direction but sits at column 0, so it will be read aloud"*.
2. An id that shadows a shorthand word — *"line 4: `left` is also a placement word"*.

They surface as `ParsedScript.warnings`, which `parsePlaylistText` copies into `playlist.warnings` — the channel the editor already shows.

- [ ] **Step 1: Write the failing test.**
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the gate and the full suite** — a warning must never fire on the corpus, since the printer writes none of these shapes.
- [ ] **Step 5: Commit.**

### Task 6: The gate, the spec status, and the push

- [ ] **Step 1: `npx vitest run`** — everything green.
- [ ] **Step 2: `npm run build`** — tsc clean.
- [ ] **Step 3: Update the design doc's status** — §6 and §11 implemented.
- [ ] **Step 4: Merge to main, push, verify the Netlify deploy is `ready`.**
- [ ] **Step 5: Report** — with the economic circuit printed in its sugared form, against the 68-line YAML it started as.

## Self-Review

**Spec coverage:** §6's element aliases, positional shorthands and `->` are Tasks 1-2; its connector labels are Task 4, parse-only and said so. §8.3's `*`/`+` choice lists are Task 3. §11's two rules are Task 5. §8.2's dialogue and `@labels` and §8.4's fences shipped in phase 2.

**The risk:** an alias that reads cleanly but cannot be written back — `thick` for any stroke width, a colour word for a hex. The printer emits a shorthand only on an exact match, and the corpus gate is what proves it. If a table entry breaks the gate, the entry is wrong, never the gate.
