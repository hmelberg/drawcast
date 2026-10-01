# Rank and sort — the viewer orders cards or sorts them into boxes

Date: 2026-10-01 · Status: approved in conversation ("spec and build"); round 2 of
`2026-10-01-guess-and-reveal-design.md` §6.

## 1. Purpose

Two more ways to answer on the figure, for answers that are an ORDER or a
GROUPING rather than a number:

- **Rank:** "Order these countries by health spending, highest first",
  "Put these events in time order", "Which kills most: …".
- **Sort:** "Fixed cost or variable cost?", "Virus or bacterium?",
  "Renewable or not?".

Like a guess, the viewer commits first; then the cards glide to the truth and
the misses are marked.

## 2. Decisions

1. **One structure, one field.** A new `cards` element carries the truth;
   the ask points at it with the same `on` a guess uses. No new verb.
   - **Rank:** `items` listed in their TRUE order (first = top/left);
     optional `ends: ["most", "least"]` writes the meaning of the two ends.
   - **Sort:** `bins: ["Fixed", "Variable"]` and each item `{text, bin}`.
2. **Cards are drawn shuffled** (a fixed, seeded order that puts as few
   cards as possible in their true place), so drawing them before the
   question gives nothing away. The cast DRAWS the cards (and bins) before
   the ask; the ask moves them.
3. **The Answer button always shows** — ordering and sorting take several
   moves.
4. **The reveal:** every card glides to its true place (0.8 s) while the
   feedback line is spoken; then the misses are marked in the guess colour —
   rank: "you: 4th" by each card the viewer had wrong (every slot holds some
   card, so an outline there would say nothing); sort: a dashed outline round
   each card they got wrong or never placed, where it truly belongs. After the question the
   cards stand in their true places (plan offsets), so scrubbing is honest.
5. **Scoring:** `{g}` "3 of 5", `{g.within}`, `{g.count}`, `{g.ok}`: rank —
   cards in their true slot; sort — cards in their true bin. Right when all
   are right (with `tolerance` t: when at least (1 − t) of them are).
6. **Movies** never wait: the cards glide from shuffled to true.

## 3. The `cards` element (sugar, `src/spec/cards.ts`)

```json
{"id": "spend", "type": "cards", "items": ["USA", "Germany", "Norway", "UK", "Spain"], "ends": ["most", "least"]}
{"id": "costs", "type": "cards", "bins": ["Fixed", "Variable"],
 "items": [{"text": "Rent", "bin": "Fixed"}, {"text": "Raw materials", "bin": "Variable"}]}
```

Fields: `items` (2–8; strings for rank, `{text, bin}` for sort), `bins`
(2–4), `ends` (rank), `arrange` (`row` default | `column`, rank only — not `layout`, which a group reads as arranging its members), `x`,
`y`, `width` (the area; defaults fill the page's middle).

Expands to:
- `<id>_1 … <id>_n` — the cards (`node`, rect), numbered in TRUE order,
  laid out at their SHUFFLED places;
- rank: `<id>_end_1`, `<id>_end_2` (the ends' words);
- sort: `<id>_bin_1 …` (each a group: an open box `<id>_bin_k_box` and its
  title `<id>_bin_k_title`);
- the group `<id>` (everything; it carries the authored fields back, as a
  scale's group does).

## 4. Interaction (`src/ui/cards-gate.ts`)

- Press a card and drag it (it follows the pointer on the figure).
- Rank: let go over another slot → the card takes that slot and the others
  shift to make room.
- Sort: let go over a box → the card stacks in it; elsewhere → back to the
  row. A card in a box can be dragged out again.
- Answer (bottom centre) resolves; Skip counts as a miss.

## 5. Out of scope

Keyboard ordering (to come), more than 8 cards, cards with pictures.
