# Drill openings — a third pill on the chess board

Status: specification, ready to plan. Written 2026-09-20 with Hans, after the
data-assets round (main d37da65) made a cast able to carry a set of openings.
Implementer: read this whole file first; it assumes the drawcast repo and
nothing else.

## 1. What this is

A chess board already offers the viewer a row of things to do while paused.
This adds a third: **Drill openings** — you are named an opening and a side,
you play the line, and the app corrects you until you have it. Then another
opening, until you stop.

Hans, 2026-09-20: *"Clicking in a chess board (or opening the tray) lets you
choose between different things you can do. One is just to play against the
computer. Another is being asked about 'best next move' drill. Yet another is
'drill openings' in which you are asked to play an opening (often several
moves)."*

## 2. The architecture is already there — read this before designing anything

This spec was nearly built as a second template with an extracted board
layout. That was wrong, and the correction is the most useful thing in this
document.

`src/ui/quiz-model.ts` holds an **activity registry**:

```ts
export function activitiesFor(interactions: readonly string[], partsCount = 0): Activity[] {
  const out: Activity[] = [];
  if (interactions.includes("chess")) {
    out.push({ kind: "chess", id: "square_quiz", label: "🎯 Find the square" });
    out.push({ kind: "chess", id: "vs_computer", label: "♟ Play the computer" });
  }
  …
```

`src/ui/tray.ts` renders those as a pill row (`activitiesFor(interactions,
partsCount)`, ~line 805) and routes them (`if (a.id === "vs_computer")
mountChessVs(stage, hd)`, ~line 817). Right-click opens the same tray, so both
doors show one row. Free play is already the click-a-piece behaviour, hinted in
the same tray.

**So a new drill is a registry entry plus a mount function.** There is no new
template, no touching the ~700-line board layout in `src/scenes/packs/games.yaml`,
and no change to the widget contract. Everything below follows from that.

What the round also establishes: `src/ui/chessvs.ts` is the shape to copy.
A `.cs-figgate` overlay with a hint pill and a ✕, `boundaryChessFen` for the
starting position, every position previewed through a param override plus
`revealNew`, teardown on play or scrub, `legalTargets` from
`chessplay-model.ts`, and `chessSquareAt`/`chessSquareBox` from
`render/widgets.ts` for hit-testing.

## 3. Decisions taken

Hans's calls, with their reasoning, so a later round does not reverse them
silently.

1. **The pill is always present**, with a small built-in set. It does not
   appear only when a cast carries data.
2. **An asset REPLACES the built-in set**, never merges with it. Merging two
   sets with clashing names is murky, and an author who wants the defaults can
   paste them into their own file.
3. **The drill is strict**: a wrong move is taken back and you try again. Not
   name-and-continue, not judge-at-the-end.
4. **Openings come up at random, weighted toward recent misses**, and the
   session runs continuously until the viewer stops it.
5. **Explaining stays ordinary casts.** A narrated `chess_board` cast teaches
   the Italian Game — the Scholar's Mate example is already exactly that shape
   — and the drill is a separate thing you reach afterwards. The drill never
   narrates.
6. **"Best next move" is a later round.** It needs a tactics dataset with known
   solutions, which is different content. It cannot use the built-in opponent:
   `src/ui/chess-ai.ts` is deliberately weak ("two plies of material…
   beginner strength is the point"), so asking it for the best move would give
   wrong answers confidently. When it comes, it follows this round's pattern.

## 4. Where the set comes from

The drill reads `params.openings`. That may be inline rows, or `"@name"` —
the data-assets round already resolves an asset reference into rows inside
`normalizeSpec`, before anything reads params, so "an asset overrides the
default" needs no new lookup convention. It is simply "the param was set".

Absent, empty, or wholly invalid: the built-in set (§6).

A row:

```yaml
- name: Ruy Lopez
  eco: C60                       # optional, labelling only
  side: white                    # optional, default white
  moves: [e4, e5, Nf3, Nc6, Bb5]
  idea: "Pressure on the knight that defends e5."   # optional
```

`side` is REQUIRED as a field rather than inferred: the Sicilian is Black's
opening, but its move list still begins `1. e4 c5`, so the moves alone cannot
say who is drilling.

## 5. The spine: one prefix query

**Given a move prefix, which openings in the set match it?** One function does
three jobs, and building it once is most of the work:

- judging a move — does the line so far, plus this move, still match the
  opening being drilled;
- naming a wrong move — does the resulting prefix match some OTHER opening in
  the set ("that's the Vienna");
- classifying a free-play line — which opening has the viewer wandered into.

A round:

1. Pick an opening, weighted (§7).
2. Caption it: "Play the Ruy Lopez. You are White."
3. Reset the board to the initial position; flip it to the drilled side (§8).
4. The viewer moves. A match stands, and the opponent plays the next book ply
   after the same `THINK_MS` (650 ms) pause `chessvs` uses. A non-match is
   taken back, and named if the prefix matches another opening in the set.
5. After TWO misses on one ply, play the move for them and count the round a
   miss. Strict, but nobody is stranded on a line they have never seen.
6. Line complete: speak the row's `idea` if it has one, record the result,
   next opening.

Precedent worth reusing rather than reinventing: `ask` already has `retry`
(clear and ask again after a wrong attempt) and `reveal` (speak the answer
after a final wrong one). Step 5 is that shape.

## 6. The built-in set

About a dozen openings, 3–6 plies each, chosen so that **its members are each
other's likely confusions** — that is what makes step 4's naming fire on real
mistakes instead of theoretical ones. The Vienna is in the set precisely
because it is what people play when they mean the Italian.

White: Italian Game, Ruy Lopez, Scotch, Vienna, Queen's Gambit, English.
Black: Sicilian, French, Caro-Kann, Queen's Gambit Declined, King's Indian,
Nimzo-Indian.

A deliberate mix of sides, since `side` decides who the viewer drills as. The
plan writes the actual move lists; this spec names the set and its shape
deliberately, because §9's legality test is what proves the lines rather than
this document asserting them.

**Check every ECO code against a reference when writing the set** rather than
trusting recall. §9 explains why the tests cannot: the moves are checkable, the
codes are not, so a wrong code ships silently. They are kept anyway as
labelling, and that limit is accepted.

## 7. Weighting, and why it needs its own store

`src/render/record.ts` is NOT the right home, and this was checked rather than
assumed. It keeps answers **per cast** (`drawcast.answers:<castKey>`,
localStorage, capped at 500), shaped around plan steps, and described in its
own header as "the student's own log, and what a later Submit sends". Three
problems: misses would not follow a viewer between casts, although the built-in
set is the same set on every chess board; a drill round is not a plan step; and
forty drill attempts would drown the real answers a Submit sends to a teacher.

So: **its own small store, keyed by opening name, scoped per browser across
casts.** A Ruy Lopez you keep fumbling is still weighted up when you meet it in
a different drawcast. A custom set's "Ruy Lopez" shares stats with the built-in
one — accepted, because it is the same opening.

The scheme, kept simple enough to describe in a sentence, which is the bar for
something a viewer feels but never sees: **an opening's weight is 1 + 2 × (its
misses in its last three attempts)**, so weight runs 1 to 7 and a line you have
never missed is still drawn about a seventh as often as your worst one. The
three-attempt window IS the cap — no separate clamp, and a line you have
since fixed decays back to 1 on its own.

Storage may be absent or throw (private mode). Then weighting degrades to
uniform random, silently — the same rule `record.ts`, `views.ts` and `learn.ts`
already follow.

## 8. Boards the drill lands on

**It starts from the initial position** regardless of where the cast is paused,
which means on a mid-line board — or one with a custom `fen` — nearly every
square it needs is one the cast never touched. Piece ids exist only for squares
a cast's own line visits, so drilling the Sicilian on a Scholar's Mate board
needs `piece_c5`, which that line never reaches.

`withNewIdsVisible` in `src/render/params.ts` exists for exactly this — its own
comment names "a free-play preview (a chess move to a never-visited square)
mints element ids the plan's visible set has never heard of". So the machinery
is there; §9 pins it, because without it the drill is invisible on most boards.

**The drill flips the board to the side being drilled**, and restores the
orientation on ✕. Playing the Sicilian from White's view is needlessly
disorienting, and `flip` is already a param `chessvs` reads for hit-testing.

**✕ restores the lesson's exact position and orientation**, as `chessvs`
already does. The drill overrides `fen` and `flip` through params rather than
moving pieces with `move` offsets, so the persisting-offset trap from the
pointing round (2026-09-20) does not apply here — but the overrides must be
cleared.

## 9. Failures, and the tests that matter

**One rule governs every failure: degrade to a drill that runs with less, never
throw.** `record.ts` states the house version — "nothing here may ever throw
into playback" — and a drill takes clicks during playback, so it inherits it.

**Validate a custom set ONCE when the session opens, never per move.** The
chess engine throws on an illegal SAN, naming it; that is fine in a layout,
where `layoutSpec`'s catch turns it into a fall-through warning, and fatal at
click time. So every row is replayed through the engine up front, bad rows are
dropped and named, and a set that is empty or wholly invalid falls back to the
built-in with a line saying so. Without this decision a typo in someone's CSV
is a crash on a viewer's machine.

**The test to insist on: every line in the built-in set is legal**, replayed
through the engine. Shipped data with a bad SAN would throw at click time and
nothing else in the suite would catch it.

The rest of the pure surface — all of it testable without a DOM, following the
repo's own split of `chessplay-model.ts` from `chessplay.ts`:

- the prefix matcher: exact match, ambiguous prefix (`1.e4` matches many), no
  match, a full line, and a prefix longer than any line;
- weighting: a miss raises an opening's weight, the cap holds, a dead store
  gives uniform random, and a seeded rng makes it deterministic —
  `quiz-model.ts` already has the seeded `sample(pool, n, rng)` idiom;
- set validation: an illegal SAN drops its row and names it, an empty set falls
  back, a wholly invalid set falls back;
- `side` handling, including a Black opening whose move list starts with
  White's move.

Session-level coverage stays thin, matching how the repo tests its other
mounts: the pill appears in `activitiesFor` for a chess scene, the tray routes
its id, and ✕ restores position and orientation. Plus the `withNewIdsVisible`
pin from §8 — a drill move onto a square the cast never touched is visible.

## 10. Files

| File | Change |
| --- | --- |
| `src/ui/chess-openings.ts` | NEW. The built-in set, the prefix matcher, set validation, the weighting store. Pure — no DOM, no registry. |
| `src/ui/chessdrill.ts` | NEW. The session mount, modelled on `chessvs.ts`. |
| `src/ui/quiz-model.ts` | One more entry in the chess block of `activitiesFor`. |
| `src/ui/tray.ts` | Route the new pill id, as `vs_computer` is routed. |
| `tests/` | §9. |

## 11. Non-goals

- No "best next move" drill (§3.6) — later round, different dataset.
- No narration from the drill (§3.5) — explaining stays ordinary casts.
- No merging of a custom set with the built-in one (§3.2).
- No new template, no board extraction, no widget-contract change (§2).
- No server-side or cross-browser memory of misses — the store is local, like
  every other viewer record in this app.
