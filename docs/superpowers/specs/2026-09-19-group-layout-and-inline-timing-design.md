# Structure without coordinates, and actions inside a sentence

Status: Part A IMPLEMENTED 2026-09-19 (plan:
docs/superpowers/plans/2026-09-19-group-layout.md, 8744 tests, tsc+build
green, round-trip gate intact). Part B (inline timing) designed, not
implemented. Two independent features in one document because they came out
of one conversation; neither depends on the other.

Two deviations in Part A, both deliberate:

(a) `boxed` (§2) was NOT built. `box` members already carry their own border,
so it serves only rows of formulas, images and portraits, and it would have
landed a second border mechanism in the same week as the border fix.

(b) §4 feared a two-pass emit for `equalize`. It is a pre-pass instead: a rect
node already honours a declared `width`/`height` (`tier2.ts`), so the sizes
are written onto the members before anything is emitted. §4 is corrected below.

One limitation worth naming: `at` on a group still does nothing — a group
pushes no drawables of its own, so pass 3 has nothing to shift. A laid-out
group stays centred on its members' own centroid, and `fit` is how you put it
somewhere specific. That predates this round and is unchanged by it.

Part A (§1–§9) answers "I have to write x and y to put three boxes in a row".
Part B (§10–§14) answers "sometimes the action belongs inside the sentence,
not on a line under it".

Both follow the round that fixed borders (2026-09-19, main 95870fe) and the
three script phases that preceded it.

## 0. What was decided in conversation, and why

1. **Structure is not a template.** `template?: string` is singular
   (`src/spec/types.ts:733`), so a page has exactly one — and **42 of the 258
   bundled examples already combine a template with their own elements**. If
   boxes-with-structure were a template they could never share a page with
   `supply_demand` or a freehand drawing. So the mechanism is a property of a
   GROUP, which composes with everything.
2. **No DAG layout** (Hans asked; measured and declined). Of 121 bundled casts
   with elements, **4** have a node-and-edge structure at all, **none** has
   five or more connected nodes, and **2 of the 4 are cycles** — which a DAG
   layout cannot lay out by definition. Row, column, grid and the free-node
   ring already cover all four. `layout: "dag"` remains a value that can be
   added to the same field later; §9 names the trigger.
3. **Predictability over optimality.** A narrated figure says "the box on the
   left". An optimizing layout moves nodes when an edge is added, which would
   silently falsify narration that nothing in the pipeline checks. An explicit
   row is worth more here than a tighter packing.
4. **One border per item, not one around the row** (Hans). A row of three
   phrases is three boxes; a border around all three is `mark around <group>`,
   which shipped in 95870fe.
5. **The layout equalizes its members' borders.** Only the layout knows the
   other members' sizes, and a row of unequal boxes reads as accidental.
6. **Drawn and spoken step by step is the normal case** (Hans). Layout is
   computed once for the whole figure and the beats then reveal it, so a row
   reserves every slot up front and members drawn later do not shift the ones
   already on the canvas.
7. **Inline actions must mean what they look like.** Two ways to write the
   same thing would leave the printer to pick one and reformat the other away.
   So the inline form is the only way to say "at this point in the sentence",
   and indentation stays the only way to say "during this sentence".

---

# Part A — Group layout

## 1. What this is

A `group` element gains `layout`. Its members are placed by the engine, in
words, with no coordinates:

```
To slags aktører.
    row
        box hush "Husholdninger"
        box bedr "Bedrifter"

Bedriftene betaler lønn.
    arrow lonn bedr -> hush curved
```

Today that cast carries `x: 220, y: 375` and `x: 780, y: 375`, and **34% of
all elements in the corpus carry raw x/y** (text alone is 73 of 170). The
vocabulary to avoid it half-exists already — `at: {ref, side, gap}` for "left
of X", `at: {place}` for "top-right of the canvas", the free-node ring, the
auto-row from the places round — and what is missing is the one thing those
cannot say: *these things belong together, in this arrangement*.

## 2. The field

```ts
/** group: how the members are arranged. Absent = they keep their own positions. */
layout?: "row" | "column" | "grid";
/** layout: space between neighbours, logical units (default 40). */
gap?: number;
/** layout grid: members per row. */
columns?: number;
/** layout: the cross-axis alignment (default center). */
align?: "center" | "start" | "end";
/** layout: give every member that has a border the same size — the largest
 *  needed (default true). */
equalize?: boolean;
/** layout: draw a border around each member that has none of its own. */
boxed?: boolean;
```

`gap` and `columns` already exist on `arrange` (`ArrangeArgs`) with these
meanings and the names are deliberately the same. `align` is new — `arrange`
has no cross-axis alignment, because it lays out pieces of a cut shape rather
than boxes that have to line up.

## 3. Where the group itself goes

Placement and arrangement are separate, and both already have answers:

- No `at`, no `fit`: the group takes the auto-placed slot, exactly as any
  other positionless element does since the places round.
- `at: {place: "top"}` or `at: {ref, side}`: the assembled group is placed
  there, at its natural size.
- `fit: "left"`: the existing behaviour — the assembled group is SCALED into
  that region (`src/spec/types.ts:149`). Layout runs first, `fit` second, so
  "a row of five boxes fitted into the left half" is one group with both.

## 4. How members are sized

With `equalize` (the default), every member that draws a border — a `node` of
any shape, or any member under `boxed` — is given the same size: the largest
width and height any member needs. A row of boxes then reads as a row rather
than as rectangles that happen to be adjacent.

Members with no border (a `text`, a `math`, an `image`) keep their own size
and are aligned by `align` on the cross axis.

This is a PRE-pass, not the two-pass this section first assumed. A rect node
already honours a declared `width`/`height`, so the natural size of each
member is computed with the same arithmetic `nodeDrawables` uses
(`naturalNodeSize` in `src/layout/group-layout.ts`), the largest is taken, and
both are written onto the members before anything is emitted. One formula,
two callers, so an equalized width is always a width that actually gets drawn.

## 5. Membership from a later beat

A member may be declared anywhere, and says which group it belongs to:

```
    row kretslop

Husholdningene eier arbeidskraften.
    box hush "Husholdninger" in kretslop

Bedriftene lager varene.
    box bedr "Bedrifter" in kretslop
```

`in <group>` writes the element's id into that group's `members`, in
declaration order. This is the form the examples should teach, because it
keeps each noun born where it is first spoken about — the principle the whole
script format rests on — while the layout still collects them.

**Nothing shifts.** Layout runs once over the finished spec and the plan then
reveals elements beat by beat, so the row's slots are computed from its final
membership. A member drawn two sentences later lands where the row always
intended and the members already on the canvas do not move. This is the
property that makes step-by-step drawing look deliberate, and it is why the
layout must not be incremental.

## 6. Nesting

A group may contain a group — `members` already allows it and
`groupClosure` (`src/layout/place.ts`) already walks it. That is what gives
branching without a graph algorithm:

```
    row
        box a "Søk"
        column stage
            box b "Filtrer"
            box c "Rangér"
        box d "Svar"
    arrow a -> b
    arrow a -> c
    mark around stage
```

## 7. Arrows

Nothing new. `arrow` with `from: {ref}` / `to: {ref}` already runs between two
elements and already backs off each end by the target's radius
(`tier2.ts:1279`), and a connector declared after the layout sees the settled
geometry. Arrows are ordinary elements, so they are drawn on their own beats
when the story wants them later than the boxes.

## 8. The script

- `row`, `column`, `grid` are heads that declare a group with that layout.
  The id is optional, as for any element.
- Lines indented under one of those heads are its **members** — a new rule,
  narrow and local: inside a layout block, a deeper-indented line whose head
  is an element type is a member declaration rather than a key/value
  continuation of the line above.
- `in <id>` on any element declares membership from anywhere. It is not a
  spec field: the parser collects it and writes the id into that group's
  `members` when the page is finished, so a member may name a group that is
  declared later in the file.
- `gap`, `columns`, `align`, `boxed`, `equalize` are ordinary keys and flags.
- Bare quoted items are NOT legal. `row { "Innsats" }` would save four
  characters and buy a failure mode where a mistyped head silently becomes a
  box instead of an error with a line number.

**Printing.** A group whose members are all first drawn in the same beat as
the group prints as a nested block; otherwise the group prints alone and each
member carries `in <id>`. Deterministic, so the round-trip gate holds.

## 9. What Part A does not do

- **No DAG layout**, for the reasons in §0.2. The trigger for revisiting: a
  figure with eight or more connected nodes and real branching, more than
  once. `layout: "dag"` then drops into §2's field and reads the group's own
  arrows as its edge list — no authored cast changes.
- **No edge routing.** Arrows run point to point. Routing that dodges boxes is
  a separate project and is what a dense graph would actually need.
- **No mermaid block and no auto-minted boxes.** A block would be a second
  language inside the language, unable to reference anything outside itself —
  which throws away the composability that made §0.1 the answer. Auto-minting
  turns a typo into a phantom box instead of an error.

---

# Part B — Inline timing

## 10. What this is

An action written inside a spoken line, at the moment in the sentence where it
belongs:

```
Pengene går rundt (@arrow hush -> bedr@) og kommer tilbake til dem som brukte dem.
```

The arrow starts when the narration reaches that point — roughly half way,
here — rather than at the start of the sentence. What goes inside `(@ … @)`
is an ordinary direction: a verb (`point at.ref hush`), or an element
declaration, which declares and draws it at the cue exactly as an indented
declaration declares and draws it with the line.

## 11. Why it is a timing feature and not a second syntax

A beat's indented directions all run *during* the sentence. If the inline form
meant the same thing, it would be a false affordance: the notation would
promise a position and deliver the start of the line. It would also leave the
printer with two spellings of one fact, so anything written inline would be
reformatted onto its own line the first time the model revised the cast.

So the inline form carries something indentation cannot: an **offset**.
Indentation keeps meaning "during this sentence"; inline means "at this point
in it". The two are not synonyms, the printer never chooses, and the round
trip is exact.

## 12. The field and the timing

```ts
/** With speak: when in the sentence this command starts, 0–1 of the way
 *  through the spoken line. Absent = at the start, with the line. */
cue?: number;
```

The offset is the action's **character position** in the line, divided by the
line's length, taken before the action spans are removed. A line of 60
characters with an action at character 30 gets `cue: 0.5`.

That is a proxy for word timing and a deliberate one. Google's TTS can return
SSML timepoints, but the engine does not carry them, and the export and the
silent path both work in proportions of a line already: baked audio stores ms
per line (`playlist/audio.ts`), and the silent path estimates a duration from
the text. Proportional cueing therefore works identically in the player, in a
baked-audio cast and in the video export, with nothing new plumbed through.
For "the arrow appears as I say *goes around*" it is good enough; for anything
finer, word timing would be its own spec.

**A beat still ends when its speech AND its actions are done.** An action cued
late simply extends the beat — the same rule a paired speak already follows —
rather than being clipped or dropped.

## 13. The grammar

- `(@` opens an action and `@)` closes it, both on one line. A closer that is
  not a bare `)` matters because an action can contain a quoted string with a
  parenthesis in it.
- `(@` counts as an opener only when the text that follows it is a known head.
  Anything else is prose, so no escape is needed for a parenthesis followed by
  an at-sign in ordinary writing.
- Several actions in one line are ordered by their offsets.
- A line may carry both inline actions and indented directions. The indented
  ones have no cue and run with the line, as they do today.
- Multi-line actions stay indented. Keeping the scanner line-oriented is what
  makes every error nameable by line.

## 14. What Part B does not do

- **No word-level speech marks.** §12 explains the proxy and its limit.
- **No inline form for a direction that has no cue.** That is what keeps the
  two spellings from being synonyms.
- **No inline speech inside a direction.** Column 0 is the voice; that rule
  does not bend.

---

# 15. Order of work, and the risks

Two rounds, either order, no dependency between them.

**Part A** is the larger. Its risk is `equalize`: feeding a computed size back
into a `node` that sizes itself from its text touches the part of `tier2.ts`
that every figure goes through. The mitigation is that a group with no
`layout` changes nothing, so the blast radius is exactly the casts that opt
in — and the corpus has none yet.

**Part B**'s risk is timing in the video export, which is deterministic and
frame-scheduled. A cue that lands mid-frame must round the same way every
render or two exports of one cast would differ. The corpus round-trip gate
covers the format; export timing needs its own test.

Both rounds carry the standing prompt rule: a new spec field is taught in
`src/llm/prompts/compiler-v1.md`, in the schema description, and in a
prompt-size re-pin, in the same round it lands.
