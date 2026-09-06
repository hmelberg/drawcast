# The periodic table: a template and a third interaction kind

Status: agreed, Hans + Claude, 2026-09-07. Implemented on the `periodic`
branch alongside two other rounds in flight (`space`, `science-packs`), so
every shared file this round touches is named in §7.

## 1. Why this template

The periodic table is the purest case of the founding move in the
interactivity principles (§6: *capability follows the element*). The piano
owns 12 pitches and the chessboard 64 squares; the table owns **118
elements times seventeen properties**, and unlike key positions those
properties are the subject matter itself. Every drill it can generate —
click iron, click a halogen, which of these two is more electronegative —
is a chemistry question, not a geometry question.

Three things make it cheap where anatomy and maps were expensive:

- **The geometry is a grid.** Group and period *are* x and y. No contours,
  no projected polygons, no parser.
- **Every cell is already an addressable element.** Give each cell its own
  id and the info card, the drag targets and reveal-one-at-a-time all work
  through machinery that already ships. 118 info cards for no new code.
- **The data is small and dead.** ~14 kB, and it will not change.

And the chemistry pack is missing its anchor: `molecule`, `lewis_dot`,
`reaction_scheme` and `energy_diagram` all exist; the one picture every
chemistry lesson opens with does not.

## 2. Data: the `elements` engine

A new lazy engine `elements`, registered in `ENGINE_DEFS` beside `geo` and
`anatomy`, loading one generated JSON.

**Source.** `scripts/build-elements.mjs` reads the `periodic-table-data`
npm package (MIT; the data is PubChem's periodic-table export, a US
government work in the public domain) and writes
`src/scenes/elements/elements.json`. The package stays a **devDependency**
— nothing at runtime depends on it — and the generated JSON is committed,
exactly as the anatomy atlas is. `ATTRIBUTION.md` sits beside it.

Hand-authoring 118 × 17 measured values would be the "two charts invented
their data" failure in a new costume. The only values this round writes by
hand are the ones that are *structural* and exactly derivable, plus the
names (§2.2).

**Record.**

```
z, symbol, name: { en, nb, la|null }, mass, group, period, block,
category, config, electronegativity, radius, melt, boil, density,
state20, state_predicted, discovered
```

- `group`, `period`, `block` are **derived** in the build script from `z`
  by the table's own structure, not read from the source — they are
  definitional, and deriving them means the grid and the data can never
  disagree.
- Missing measurements are `null`, never 0. 23 elements have no measured
  electronegativity, 25 no boiling point. **A `null` renders as blank
  paper, never as the cold end of a scale** — a grey cell that reads as
  "very low electronegativity" would be a figure that lies. This is the
  single most important rule in the colouring code.
- `discovered` is a year, or the string `"ancient"` for the seven metals
  known to antiquity. "Ancient" is not year zero; it is its own bucket at
  the far end of the scale.
- `state20` normalises the source's five values to `solid|liquid|gas`,
  with `state_predicted` true for the superheavy elements whose state is
  computed rather than observed.

### 2.2 Names in three languages

Following the anatomy template's `names: en|nb|la` precedent, where names
resolve case-insensitively against the id *and* every language's name.

`la` is set **only where the Latin name explains a symbol the English name
does not** — Na/Natrium, K/Kalium, Fe/Ferrum, Cu/Cuprum, Ag/Argentum,
Sn/Stannum, Sb/Stibium, Au/Aurum, Hg/Hydrargyrum, Pb/Plumbum, W/Wolframium.
Elsewhere it is `null`. That field is not completeness for its own sake; it
is the whole answer to "why is iron Fe?", which is why `names: la` is worth
having at all.

The Norwegian and Latin names are the one part of the dataset with no
machine-readable source, so they are verified against Norwegian Wikipedia
and snl.no rather than recalled, and any name that cannot be verified stays
`null` and falls back to English.

## 3. The template `periodic_table`

One template in the chemistry pack, three forms, chosen by which params are
set:

| form | when | cells |
| --- | --- | --- |
| **whole** | default | 18 × 7 plus the two f-block rows; symbol + Z |
| **subset** | `group` / `period` / `first` / `category` / `elements` | drawn large, with the name |
| **detail** | `element: "Fe"` | one big cell: Z, symbol, name, mass, `[Ar]3d⁶4s²` |

**Params.** `element`, `elements[]`, `group`, `period`, `first`,
`category`, `highlight[]`, `colour_by`
(`none|category|electronegativity|radius|state|discovered|block`),
`names` (`en|nb|la`), `legend`, `title`.

**element_ids.**

- `grid` — the rulings, drawn as **one gesture**. This is the chessboard's
  lesson (`board` is a single element; the squares sit on top): a drawcast
  *draws*, and 118 boxes stroked one at a time is either endless or a mess.
- `cell_<Sym>` — one group per drawn cell (box, symbol, atomic number, and
  the name in the subset and detail forms). These ids are the whole
  interaction surface; see §4.
- `fill_<Sym>` — the colour wash when `colour_by` is set, as its own id so
  `animate` can sweep `colour_by` without redrawing the grid.
- `highlight_<i>`, `legend`, `title`.

A storyboard that wants to build the table up group by group uses
`reveal`/`highlight` on the cell ids rather than asking the layout to draw
slowly.

## 4. `periodic` as the third interaction kind

`KNOWN_INTERACTIONS = ["piano", "chess", "periodic"]`.

**The geometry is the layout's own ids, not a recomputation.** The piano
and the chessboard recompute key and square geometry in
`src/render/widgets.ts` because their layouts do not expose per-key ids.
The periodic table does, so `periodicCellAt` / `periodicCellBox` read
`elementBBoxes(layout)` and hit-test `cell_*` with the existing
`hitElement`. No second copy of the grid arithmetic can drift from the
first. (This is the round's one genuine improvement on the pattern it
copies.)

**No standing-aside in `infocard.ts`.** Piano and chess must stand aside on
their hit areas because a click there means "play this note", not "tell me
about this". On the table, the click *is* the info card. That is a
simplification, not a gap — and it is why 118 info cards cost nothing.

**Drills** (`activitiesFor` in `src/ui/quiz-model.ts`), each sampling only
the **drawn** subset, exactly as `pianoQuizTargets` samples only the drawn
keys:

- `🎯 Finn grunnstoffet` — "click iron" / "click Z = 26" / "click Fe"
- `🔎 Finn gruppen` — "click a halogen", "click a noble gas"
- `📈 Hvem er størst?` — two cells, higher electronegativity (the
  *quantify* archetype, §9)

The drills read element properties from the loaded engine
(`getLoadedEngines(["elements"])`), which is safe: a periodic figure cannot
be on screen unless its engine finished loading before layout ran.

**Drag.** `resolveDragTargets` gains a `cellBox?` fallback beside `noteBox`
and `squareBox`, so an author writes `items: ["Fe", "Cl", "Na"]` and not
`cell_Fe`.

## 5. The generic enum control in the tray

`colour_by` is where the teaching happens — flipping one grid between
electronegativity, radius, state and discovery year is periodicity becoming
*visible*, the same sawtooth returning. But the tray only renders numeric
sliders today.

So: `choiceSpecs(schema, params)` joins `sliderSpecs` in
`src/ui/tray-model.ts` — pure, DOM-free, same walk and dot paths — turning
any string param with a declared `enum` of 2–6 values into a
`ChoiceSpec { path, label, values }`. `tray.ts` renders it as a segmented
control above the sliders, committing through the same override route, so
an enum change re-lays-out exactly as a slider drag does.

Built generically rather than as this interaction's private row, because
the library gets it in the same moment: `names` in anatomy, `chart` in the
data pack, `octaves` in piano. The periodic table is its first user, not
its only one. The bound: only enums the template can actually re-layout on
— never a free-text field, never a 7-value enum (a segmented control stops
being readable, and a long enum is an authoring choice rather than an
exploration knob).

## 6. Delivery

Three bundled examples — a new template without one is invisible to the
model:

1. the whole table coloured by category,
2. the halogens as a subset with names,
3. "why is iron Fe?" as a detail cell with `names: la`.

Tests: spot checks on the generated data (H, Fe, Au, Og), group/period/block
derivation across the awkward rows, `null` measurements rendering blank
rather than cold, cell ↔ symbol both ways, `choiceSpecs`, drills sampling
only what is drawn — and a **measurement** of the label lint on the full
table, because 118 texts through the overlap solver is a claim rather than
a fact until it is timed.

## 7. Shared files, and the two rounds in flight

`space` has already changed `src/scenes/engines.ts`, `src/scenes/kit.ts`,
`src/scenes/packs.ts`, `src/ui/tray-model.ts`, `src/examples.json`,
`src/spec/schema.ts` and `src/spec/types.ts` on its own branch. This round
touches `engines.ts` (one loader plus one name in `KNOWN_ENGINES`),
`tray-model.ts` (one added function), `examples.json` (three entries
appended at the end), `chemistry.yaml`, `scenes/types.ts`
(`KNOWN_INTERACTIONS`), `render/widgets.ts`, `ui/quiz-model.ts`,
`ui/quiz.ts`, `ui/tray.ts`, `ui/drag-model.ts` and `styles.css`.

Every conflict is therefore an append rather than a rewrite, and whoever
merges second resolves a list, not a design. No file is edited with
`git add -A`: this repo is shared with live sessions, and every commit in
this round names its paths.

## 8. Deliberately out of scope

Electron shells and Bohr models, isotopes, an ionisation-energy plot, 3D
orbitals, and any per-element imagery. The table earns its place as a grid
that can be coloured, questioned and clicked; each of those four is its own
template if a lesson ever asks.
