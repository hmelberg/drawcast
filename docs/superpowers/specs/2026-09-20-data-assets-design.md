# Data assets — a drawcast that carries its own data

Status: specification, ready to plan. Written 2026-09-20 with Hans after the
chess pointing round (main 3448ace). Implementer: read this whole file first;
it assumes the drawcast repo and nothing else.

## 1. What this is

A drawcast can carry **structured data of its own** — rows a template, a widget
and the questions read at play time — so one cast can drill fifty chess
openings, quiz across them, or redraw itself per row, without fifty
hand-written beats and without the author's files being present when a stranger
plays it.

Hans, 2026-09-20, after watching the chess examples: *"perhaps a way to include
data in the spec of a drawcast itself that can be used in this case, and
perhaps in other cases as well. It is not a unique thing. A template or a
drawcast that needs some data. an asset. it could be inside the spec, or
outside."*

Chess openings is the motivating case and the first consumer, but the feature
is general: a template that needs a table.

## 2. What already exists (read this before designing anything)

Measured in the repo on 2026-09-20, not recalled:

- **`spec.assets`** (`src/spec/assets.ts`) is a map of named payloads referenced
  as `"@name"`, serialized LAST so the readable part of the spec stays on top,
  and resolved by `normalizeSpec` before any consumer reads the element.
  Values are `string` and the only reference site is an element's `strokes`.
- **Hoisting** (`src/llm/hoist.ts`) already stashes each playlist item's whole
  `assets` map under `assets:<item>` before a model call and restores it after,
  precisely so encoded bytes never burn tokens or get corrupted on re-emission.
- **`assets` is a DOCUMENT field, not an authoring one** (`src/spec/schema.ts`
  `ASSET_FIELDS`, and `apiSchema()` in `src/llm/compile.ts` copies
  `specSchema`, which has no `assets`). The model has never seen an asset and
  cannot write one.
- **`params` already carries arbitrary structured data.** The wire schema has
  `params` as `additionalProperties: true`; `templateParamErrors`
  (`src/scenes/params-check.ts`) validates it against the template's own
  `params_schema`. A user template declaring `openings: {type: array …}` and a
  widget body reading `scene.params.openings` works TODAY and publishes
  self-contained.
- **Widget bodies** (`src/scenes/widget-types.ts`, `widget-effects.ts`) receive
  `scene.params` and may return `patch` (redraw from new params), `caption`,
  `glow`, `color`, `pointer`, `sound` and `answer`. A widget can therefore own a
  whole question loop by itself.
- **`＋ Insert`** (`src/ui/insert.ts`) is an existing file→asset surface:
  Portrait…, Source…, a file input, `hoistStrokes` writing into `assets`.
- **Data tokens** `"{id.var}"` reach params only from a CODE element's harvested
  script variables (`src/scenes/data-schema.ts`). They are shaped for numbers
  and columns, not rows of objects.

So the gap is narrower than it looks. What is missing is: getting a FILE in
without hand-editing a spec; keeping a fat payload out of every model call;
non-JSON formats; and a value type that is not a string.

## 3. Decisions taken

Each of these was Hans's call, recorded with its reasoning so a later round
does not silently reverse it.

1. **Runtime, not authoring-time.** The data ships with the cast and is read
   while it plays. The rejected alternative — the file feeds the model, which
   writes ordinary casts, and the data is left behind — is much smaller to
   build but yields casts that can only ever contain what was written into
   them.
2. **One map, not two.** `assets` holds bytes and data alike, rather than a
   separate `data:`. They share everything that matters: named, big, kept out
   of model calls, referenced by `@name`, written last in the file. Two
   near-identical mechanisms would be worse than one map with two value types.
3. **The model may REFERENCE an asset, never rewrite one.** It sees a
   descriptor, never the rows (§5). The author's data is the author's; a revise
   round cannot quietly edit a repertoire. This also makes corruption
   structurally impossible rather than merely unlikely.
4. **Assets stay per playlist item.** A playlist-level map is a header change
   worth making when something needs it. The openings trainer is one item.
5. **PGN is the chess pack's problem.** JSON and CSV are generic; chess
   notation → rows belongs with the trainer.
6. **The openings trainer is a SEPARATE round** (§9), for a reason found in the
   code: `widgetHostFor` (`src/ui/widget-host.ts:78`) mounts a widget for every
   scene using its template, so a widget on `chess_board` would fire on every
   ordinary chess diagram and fight the existing free play
   (`controls.ts:1012` and `:1051` attach both). A second template means the
   ~700-line board layout must be shared rather than duplicated, and that
   extraction is the trainer round's problem, not this one's.

## 4. The spec-level change

### 4.1 An asset may be data

```ts
// src/spec/types.ts
assets?: Record<string, unknown>;   // was Record<string, string>
```

A `string` value is bytes, exactly as today. Any other JSON value is data.

`src/spec/schema.ts` `ASSET_FIELDS` drops `additionalProperties: {type: "string"}`
for `additionalProperties: true`. This is the DOCUMENT schema only — the wire
schema still has no `assets`, so nothing the model writes is affected.

### 4.2 `"@name"` resolves in params, at any depth

```yaml
assets:
  openings:
    - {name: Italian Game, eco: C50, moves: [e4, e5, Nf3, Nc6, Bc4], idea: "Bishop eyes f7"}
    - {name: Ruy Lopez,    eco: C60, moves: [e4, e5, Nf3, Nc6, Bb5], idea: "Pressure on c6"}
params:
  set: "@openings"
```

A string that matches `ASSET_REF` exactly (`^@([A-Za-z0-9_][\w.-]*)$`, already
in `src/spec/assets.ts`) and appears anywhere inside `params` — including
nested in arrays and objects, e.g. `{sets: ["@openings", "@endgames"]}` — is
replaced by the asset's value. A partial match (`"see @openings"`) is left
alone; the regex is anchored, as it already is for strokes.

New in `src/spec/assets.ts`:

```ts
/** Replace every `@name` inside params with its asset value, IN PLACE.
 *  Returns the names that did not resolve. */
export function resolveParamAssetRefs(spec: { assets?: unknown; params?: unknown }): string[]
```

`resolveAssetRefs` (the strokes walk) stays as it is. Both are called from the
same place.

### 4.3 Where resolution happens — and the trap

`normalizeSpec` (`src/spec/schema.ts`) is the existing resolution point and
stays the one for rendering: `layoutSpec` calls it (`src/layout/layout.ts:88`),
it deep-clones, so the SAVED document keeps `params: {set: "@openings"}` and
only the in-memory copy carries rows. Widgets get resolved data for free —
`WidgetScene.params` is post-normalize.

**The trap.** Authoring-time param validation does NOT go through
`normalizeSpec`. `src/llm/compile.ts:590` calls `templateParamIssues` with
`check.resolvedParams ?? best.params` — params after DATA-TOKEN substitution,
before any asset resolution. Left alone, `{set: "@openings"}` would read as
"expected array, got string", the model would be told to repair it, and it
would repair it by inventing data. That is the worst possible failure: silent,
plausible, and it destroys the author's dataset.

So asset refs must be resolved on that path too. Both call sites go through one
exported helper so they cannot drift:

```ts
/** Params with every @name resolved — the form every validator and layout sees. */
export function paramsWithAssets(spec: Pick<Spec, "assets" | "params">): Record<string, unknown>
```

There is precedent for the alternative (compile.ts already loosens param
strictness when unresolved data tokens are present) but it is the wrong one
here: a data token cannot be resolved without running a script, whereas an
asset ref resolves from the spec itself, for free, with no runtime. Resolve,
don't excuse.

### 4.4 Errors

All four in `semanticErrors` (`src/spec/schema.ts`, beside the existing
dangling-strokes check at ~1248), each naming the asset and the site:

| Case | Message shape |
|---|---|
| `params` refers to `@x`, absent from assets | `params.set refers to asset "@x", which is not in assets` |
| `strokes` refers to an asset that is data | `element "p1" (portrait): strokes refers to asset "@openings", which is data, not encoded bytes` |
| `params` refers to an asset that is a string | `params.set refers to asset "@foto", which is encoded bytes, not data` |
| an asset exceeds the size cap | `asset "@openings" is 1.4 MB; the limit is 1 MB` |

The existing dangling-strokes message is kept verbatim so its test does not
move.

### 4.5 Size cap

**1 MB per asset**, as an error rather than a warning. Assets land in
IndexedDB with the rest of the library, and the course round of 2026-09-18
already lost work to a storage limit hit silently. A named limit with a clear
message is the lesson from that. The cap is a single exported constant so the
`＋ Insert` dialog can refuse a file before it is embedded rather than after.

## 5. What the model sees — the part that makes this affordable

`src/llm/hoist.ts` already lifts each item's `assets` map out before a model
call. Today it stashes blind, which for data would leave the model unable to
know the asset exists at all — and therefore unable to write
`params: {set: "@openings"}`.

So a hoisted DATA asset is replaced by a **descriptor string** rather than the
`@pinned` sentinel:

```yaml
assets:
  openings: "@data 50 rows — name, eco, moves[], idea"
  foto: "@pinned"                       # bytes: unchanged, still opaque
```

Descriptor shapes, all derived from the value, never authored:

| Value | Descriptor |
|---|---|
| array of objects | `@data 50 rows — name, eco, moves[], idea` (keys of the first row; `[]` marks an array-valued key) |
| array of scalars | `@data 120 numbers` / `@data 8 strings` |
| object | `@data object — openings, endgames, meta` |
| anything else | `@data value` |

Cost: about twelve tokens where the rows would have been three thousand. The
model can place beats, write narration around the set and reference it by name,
and is structurally incapable of corrupting a row because no row was ever in
the call. Restoration is by name, exactly as for strokes today.

A descriptor is a string, so a spec mid-round-trip still type-checks as
`Record<string, unknown>` with no special case.

### 5.1 Hoisting versus validation — an ordering that must change

**A hoisted spec is not a complete spec and must not be judged as one.** Today
that is true by accident rather than by design: the only reference site is an
element's `strokes`, hoisting rewrites the reference itself to `@pinned`, and
`assetRef` returns null for `HOISTED` — so the dangling check never sees it.

Params cannot use that dodge. The reference `"@openings"` is short, meaningful
and exactly what the model needs in order to keep the binding, so it stays in
the hoisted document; only the VALUE becomes a descriptor. Which means a reply
that drops the `assets:` block — likely, since `assets` is not in the wire
schema — hits validation with a reference to an asset that is no longer there.

And validation runs FIRST: `src/llm/revise.ts:66` validates each candidate,
`:241` restores blobs into the winner only.

The fix is to make the invariant explicit rather than accidental: **restore
before validate.** Blobs come back into each candidate before
`validateSpec` judges it, so every validator sees a complete spec and the
dangling check means what it says. The cost is restoring into candidates that
lose, which is a map lookup per asset.

The rejected alternatives, recorded so they are not re-proposed: sentinel-ing
the params reference too (the model then cannot know which asset a param is
bound to, and restoration needs a stashed path→name map); tolerating a missing
asset when the reference "looks hoisted" (a rule that cannot be stated
honestly); and downgrading the dangling-params error to a warning (it hides a
genuine typo, which is the case the check exists for).

A consequence for §4.4's third rule: during a round-trip an asset's value IS a
string — its descriptor — while params legitimately reference it. Restore-
before-validate means no validator ever sees that state, so the rule needs no
exemption. The plan must verify this holds on the compile path's internal
rounds (repair, pedagogy, visual — `src/llm/compile.ts:533`) as well as revise.

**Consequence to accept:** "add the Sicilian to my openings" is not a thing the
model can do in v1. Editing data is the author's job — the editor, or a
re-import. Revisit only if it turns out to be wanted; the safe default is that
a model round never touches the author's dataset.

## 6. Authoring: `＋ Insert → Data…`

A third entry beside Portrait… and Source… in `src/ui/insert.ts`:

1. File input accepting `.json` and `.csv`.
2. Name the asset — prefilled from the filename, slugified to the `ASSET_REF`
   character set, unique against existing asset names.
3. Parse. JSON as-is. CSV: header row becomes the keys, so a spreadsheet export
   lands as rows of objects without anyone writing JSON by hand. Numeric-looking
   cells stay STRINGS unless every cell in the column parses as a number — the
   overpromising trap from the `steepness` round: a rule that mostly works is
   worse than one that is stated.
4. Refuse over the cap, with the size, before embedding.
5. Write into the CURRENT item's `assets` (the viewed part, not always item 0 —
   the bug called out in insert.ts's own header comment).
6. Show the reference to use: `"@openings"`, copyable.

Two free paths alongside it: typing an `assets:` block in the editor, and the
model writing a small set as ordinary inline params when there is no file.

## 7. Non-goals for v1

- No external/fetched data (a URL resolved at play time). The `source`
  element's precedent exists if it is ever wanted, and §3.1's self-containment
  is the reason not to start there.
- No playlist-level asset map (§3.4).
- No model-authored or model-edited data (§5).
- No PGN (§3.5).
- No data-token bridge integration: `{openings.moves}` is NOT part of this.
  The token bridge is shaped for a script's numbers and columns; rows of
  objects reach templates through params.

## 8. Testing

The pins that a later round would otherwise break without noticing:

1. **Round-trip identity.** A data asset survives hoist → model call →
   restore byte-identical, for each descriptor shape. This is the one that
   protects the author's data.
1b. **Order (§5.1).** A reply that drops the `assets:` block while params still
   reference an asset validates clean — the regression test for restore-
   before-validate, on both the revise path and the compile path's internal
   rounds.
2. **Descriptor generation**, per shape in §5's table, including an empty array
   and a row whose keys differ from the first row's (first row wins; the
   descriptor is a hint, not a schema).
3. **Resolution at depth**: `@name` inside an array inside an object in params;
   a partial match left alone; a dangling name reported, not thrown.
4. **The ordering trap (§4.3)**: a spec whose params reference an asset
   produces NO param-schema error at authoring time. Written as a regression
   test against `templateParamIssues`, because that is the path that would
   destroy data.
5. **Both value types coexist**: one spec with a byte asset and a data asset,
   both resolving to their own reference sites, neither reachable from the
   other's (the two cross-type errors in §4.4).
6. **Self-containment**: a published cast carrying data plays with no author
   state — the existing publish/viewer test idiom, extended.
7. **Size cap** refuses at the boundary and the message names the size.

## 9. The first consumer (sketch only — its own round)

Enough to prove the mechanism carries it, not a design.

A `chess_openings` template in the games pack, params `set` (rows of
`{name, eco?, moves[], idea?}`), `mode` (`drill` | `name`), and a widget body
that:

- **drill**: picks a line, `patch`es `moves`/`plies_shown` to play the
  opponent's replies, takes the viewer's move through the existing chess click
  handling, `caption`s a correction naming the opening they actually played
  ("that's the Vienna"), and reports `answer` to a bound `ask`.
- **name**: `patch`es to a position from a row and asks which opening it is.

Everything it needs already exists except the data. The round's real question
is where the shared board layout lives, given §3.6 — a `kit` helper, something
the chess engine exposes, or a pack-level shared body. That question is open on
purpose.

## 10. Files

| File | Change |
|---|---|
| `src/spec/types.ts` | `assets?: Record<string, unknown>` |
| `src/spec/assets.ts` | `resolveParamAssetRefs`, `paramsWithAssets`, `describeAsset`, the size constant; `inlineStrokes` guards a non-string value |
| `src/spec/schema.ts` | `ASSET_FIELDS` widened (document schema only); normalize resolves params; four `semanticErrors` |
| `src/llm/hoist.ts` | descriptor instead of a blind stash for non-string assets |
| `src/llm/compile.ts` | validate through `paramsWithAssets` (§4.3); restore before validate on the internal rounds (§5.1) |
| `src/llm/revise.ts` | restore blobs into each candidate before `validateSpec` (§5.1) |
| `src/ui/insert.ts` | `Data…` entry, CSV/JSON parse, naming, cap |
| `tests/` | §8 |
