# Design: Style and vocabulary — what Instructions, References, Templates and Packs actually are

*2026-09-01. Hans: "I am also unsure about the relationship between
instructions, references, templates and packs. We need to simplify and make it
clearer… Analyze and suggest." **Nothing here is implemented.** Smaller UI
items from the same message are collected in §7.*

## 1. What they are today — traced, not assumed

Every one of the four ends up in the same place: the text sent to the model.
The prompt source is a template with four placeholders, and each concept fills
exactly one slot.

```
Instructions  =  THE WHOLE PROMPT SOURCE          (UserPrompt.source)
                 ├── {{SCHEMA}}     the spec schema, injected
                 ├── {{CATALOG}}  ← Templates + Packs
                 ├── {{FEWSHOTS}}   bundled examples, fixed
                 └── {{EXEMPLARS}} ← References (3 picked per request)
```

| Concept | Stored as | Reaches the model via |
|---|---|---|
| **Instructions** | `UserPrompt { id, name, source, ts }` | it **is** the prompt — `variantSource` |
| **References** | `Exemplar { prompt, spec }` | `{{EXEMPLARS}}`, 3 chosen per request by `pickExemplars` |
| **Templates** | `MyTemplate { id, yaml }` | `{{CATALOG}}` |
| **Packs** | `settings.enabledPacks[]` | `{{CATALOG}}` — a pack that is off is invisible to the model |

## 2. Where the confusion comes from

Three specific things, and none of them are the user's fault.

**2.1 "Instructions" does not mean instructions. It means the entire system
prompt.** Choosing it replaces every word the model is given — schema
scaffolding, catalog rules, output format, the lot. That is why the modal needs
Save, Rename, Copy, Delete, Download .md, Upload .md and Improve-with-AI: seven
controls, because it is a prompt-authoring IDE. It is also why
`missingPlaceholders` exists and why dropping `{{SCHEMA}}` is a documented way
to break generation. Nobody wanting to say *"use more concrete examples when
you teach"* wants any of that.

**2.2 There is no "New".** Confirmed: no `promptNewBtn` exists. The only way to
get your own is **Copy** a bundled prompt and edit the copy — which starts you
with a thousand lines of machinery to wade through before you can add your one
sentence.

**2.3 Two axes are presented as four peers.** Instructions and References both
shape *how it draws*. Templates and Packs both determine *what it can draw*.
The sidebar lists them as unrelated items, so the pairing is invisible.

## 3. The proposed model

Two axes, named:

```
STYLE — how it draws        VOCABULARY — what it can draw
  Instructions                Templates   one plot or illustration
  (your teaching style)       Packs       a collection of templates
```

Two concepts, not four. **Instructions and References were the same thing in
two media** — prose and example — but Hans has ruled that the example half
leaves the user-facing model (§6), so Style is prose and Vocabulary is
templates. Templates and Packs remain one thing at two scales.

Hans's own sentence lands exactly here: *"it is always a collection of packs
(plus instructions)"* — vocabulary plus style is what a generation is made of.

## 4. Instructions becomes an addendum, not a replacement

**Today:** your instruction *is* the prompt.
**Proposed:** your instruction is *added to* the prompt, and overrides it where
they disagree.

```
prompt source (ours, fixed)
  …
  {{STYLE}}   ← your teaching-style text, last, so it wins
```

Everything Hans wanted to drop follows from this without argument:

| Control | Why it existed | Under the new model |
|---|---|---|
| Improve with AI | rewriting a thousand-line prompt is hard | **gone** — it is a paragraph you wrote |
| Download .md / Upload .md | prompts are big artefacts worth moving | **gone** — see the open question in §4.1 |
| Rename | you accumulate several forks of the prompt | **gone** — a style has a name when you make it |
| Copy | the only way to get an editable one | **replaced by New** |
| Save / Delete | — | **kept** |
| **New** | never existed | **added** — the actual missing verb |

A style profile becomes `{ id, name, text }`: a name and some prose. Nothing
can be "broken" by editing it, so `missingPlaceholders` and the
`{{SCHEMA}}`-is-missing failure mode leave the user-facing path entirely.

### 4.1 Where does a style profile live?

Hans asked: *"where to save disc? github? google drive?"*

A style profile is small text and belongs to a person, not a document. It is
already in `localStorage`, which is per-browser — so a style written on the
laptop does not exist on the desktop. Options, in order of size:

1. **localStorage only** (today). Zero work; does not travel.
2. **Export/import a single `.md`** — the very buttons §4 just removed, kept
   for the profile rather than for the prompt. Cheap and travels by hand.
3. **Save with the rest**, using the Save ▾ destinations that now exist —
   disk, GitHub, Drive. Consistent with everything else, and the GitHub route
   would give style profiles version history for free.

**Recommendation: 1 now, 3 when it stops being enough.** A style profile is a
paragraph; syncing it is a bigger machine than the thing it syncs.

## 5. Editing the real prompt becomes an advanced feature

Hans: *"Do not (?) allow people to edit the general prompt (unless you are
admin or maybe if you turn on advanced/developer features)."*

Agreed, and it costs almost nothing: `developerMode` already exists and already
gates the rating, the lint list and the Data panel. The prompt editor — with
its seven controls, its variant picker and its placeholder validation — moves
behind that flag intact. Nothing is deleted; it stops being the first thing a
new user meets when they want to describe their teaching.

This also cleans up the generation choices row. `…` currently offers
**Template / Instructions / Model**, where "Instructions" means "which fork of
the entire prompt". Under the new model it means **Style**, which is a choice a
normal person can make.

## 6. References leave the user-facing model

Hans, after seeing the link: *"I see references and learn from this is related.
I do not think 'learn from this' is intuitive to the user, and perhaps no
longer a useful feature — or at least should be hidden unless you are an
advanced developer."*

**Decided: hide it, and drop References from the user-facing model.** Style is
prose. The earlier draft of this section argued for renaming the button
instead; that was the wrong call, because it treated a naming problem as the
whole problem. Two things say otherwise:

- **Prose is more direct than inference.** A style profile says "open with a
  question, keep one idea per screen". A Reference asks the model to *infer*
  that from three specs picked by keyword overlap. If the author can simply
  say it, showing three drawings and hoping is the weaker instrument.
- **The naming was a symptom.** "Learn from this" reads as machine learning and
  implies something durable and consequential. What it does is add one item to
  a pool from which three may be drawn if the keywords happen to match. The
  gap between what it promises and what it does is why it never felt intuitive.

**Nothing structural breaks.** `pickExemplars(request, cfg.exemplars,
cfg.bundledExemplars, 3)` takes both the user's pool and the bundled one, so
with the user pool empty, generation still gets bundled examples. The
`{{EXEMPLARS}}` slot keeps working.

**The machinery stays, behind `developerMode`:** the exemplar store, the
picker, and the improvement packet that reads it. That pool is real developer
tooling for measuring what the compiler does badly, and it should keep
existing — it simply stops being something a normal user is asked to curate.

So: `👍 Learn from this` joins the rating, the lint list and the Data panel
behind the flag, and the References tab disappears from the user-facing
Instructions modal along with it.

## 7. The smaller items from the same message

**7.1 Bar order.** `Insert` moves after `Open ▾` and `Save ▾`. The spec bar
becomes:

```
YAML▾ ↻  │  Open ▾  Save ▾  │  Insert ▾  📌
```

**7.2 Publish sits after Review**, in the preview bar — already proposed in the
Publish spec §2 and consistent with it: `⚠ 2 … ✎ Review · ↗ Publish`.

**7.3 The Player/Editor pill goes.** Verified: player mode already carries
`✎ Edit` in its own control bar (`main.ts:2009`, `trailing: isPlayer ?
[switchBtn] : []`), so the pill's only unique job is editor → player. Replacing
it with a sidebar row — **▶ Player** — costs nothing and returns the topbar to
the wordmark alone.

**7.4 The logo.** Hans: *"The logo is ugly. Make something new and simple."*

I cannot see it, and I built it blind — that is the honest problem here, and
iterating blind again is likely to produce another one he dislikes. What I can
say is what is probably wrong: the current mark is a sketched stroke resolving
into a play triangle, drawn by roughjs, so it is deliberately *rough* — which
reads as unresolved rather than characterful at 24px, and fights the cleaner
chrome the palette round produced.

Three directions, described precisely enough to choose between:

1. **A clean play triangle inside a rounded square.** No sketch texture at all.
   Reads at 16px, unmistakable as a player, and lets the hand-drawn quality
   live where it belongs — in the drawings.
2. **A single pen stroke that becomes an arrow.** Keeps the "draw" half, drops
   the roughness: one smooth curve, one weight, no fill.
3. **A lower-case `d` whose bowl is a play triangle.** A letterform mark that
   works as an avatar and needs no separate wordmark.

**Recommendation: 1** — because the app's own output is where the drawn
character belongs, and the chrome around it has just been made deliberately
plain. But this is a decision to make by eye, not by argument: the useful next
step is for me to generate all three as small SVGs so Hans can look at them.

## 8. What this changes in the code

Roughly, and only to size the work:

- `UserPrompt` splits into a **style profile** (user-facing, `{id, name,
  text}`) and the existing **prompt variant** (developer-only, unchanged).
- The compiler prompt gains a `{{STYLE}}` placeholder, filled last.
- The Instructions modal becomes a **Style** panel: a list, New, Save, Delete,
  and a textarea. Seven controls become four.
- The prompt editor moves behind `developerMode` unchanged.
- The `…` row's "Instructions" becomes "Style".
- Templates and Packs are **untouched** — they were never the confused half.

## 9. Open questions

1. §4.1 — style profiles: localStorage only, or saved through Save ▾?
2. §7.4 — which mark, once seen?
3. Does the **Style** panel merge with Templates/Packs into one "what the AI
   uses" modal with two tabs, or stay two sidebar rows? Two rows keeps the two
   axes visible; one modal keeps the sidebar shorter.
