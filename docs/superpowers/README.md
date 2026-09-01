# Start here — orientation for a reviewer

*Written 2026-09-01 for someone who has never seen this project: another model
asked to audit these documents, or a person picking them up cold.*

## What drawcast is

A browser app that turns a plain-language request — *"explain comparative
advantage"* — into an **animated, narrated, hand-drawn explainer figure**. The
model does not draw pixels; it emits a **spec** (YAML) describing elements and
a sequence of commands (`draw`, `speak`, `pause`, `quiz`, `camera`…), and the
app's own engine renders and narrates that spec in the browser.

Five things worth knowing before reading further:

1. **Two modes over one document.** *Player* is a YouTube-like screen that just
   plays the current drawcast. *Editor* is the workbench: prompt box at the top,
   spec text on the left, live preview on the right.
2. **A drawcast can be a playlist.** Multiple parts, chapters, a generated title
   card. A **course** is a series of drawcasts generated from one editable plan.
3. **It publishes to the author's own GitHub.** Publishing commits a `.yaml` to
   *their* repository; the link points at drawcast's hosted viewer with that
   file's location in the URL. The app also exports narrated WebM video and
   uploads to YouTube.
4. **Everything is local.** Settings, the drawcast library, API keys — all in
   `localStorage`. There is no drawcast server holding user data.
5. **Bring your own key.** Generation uses the author's Anthropic key; speech
   uses their Google Cloud TTS key; publishing uses their GitHub token.

## The vocabulary these documents use

| Term | Means |
|---|---|
| **spec** | the YAML document describing one drawcast — elements plus commands |
| **playlist** | a multi-part drawcast; a single one is a playlist of one |
| **cast** | a published drawcast (`casts/<slug>.yaml` in the author's repo) |
| **template** | a reusable scene — a named plot or illustration the model can invoke |
| **pack** | a collection of templates (economics, medicine, stats…) |
| **exemplar / reference** | a past drawing the author marked, shown to the model as a style example |
| **pin / embed** | write images into the spec so it renders without fetching anything |
| **bake** | synthesize narration once and publish it inside the drawcast |
| **lint** | layout warnings from the renderer (label collisions and similar) |

## What to read, in order

1. **`ROADMAP-2026-09.md`** — the inventory. 22 outstanding items in three size
   tiers, plus **§F**, a proposed seven-part split that Hans has *not* yet
   agreed to. Start here; it links everything else.
2. **`specs/2026-09-01-publish-design.md`** — publishing: the menu, where it
   lives, embedding images and narration, file names and folders.
3. **`specs/2026-09-01-style-and-vocabulary-design.md`** — what Instructions,
   References, Templates and Packs actually are, and a proposal to reduce four
   concepts to two.

**None of these three is implemented.** They are proposals.

For contrast, two specs that *were* implemented, each with a ledger recording
every decision taken during the build:

- `specs/2026-08-31-editor-shell-design.md` + `plans/2026-08-31-editor-shell-ledger.md`
- `specs/2026-08-31-round-two-design.md` + `plans/2026-08-31-round-two-ledger.md`

## Facts a reviewer will want in order to check claims

- **Source lives in `src/`.** Key files: `src/main.ts` (the shell, ~3900
  lines), `src/ui/` (modals, menus, player controls), `src/render/` (the
  drawing engine), `src/publish/` (GitHub), `src/playlist/` (multi-part),
  `src/llm/` (prompt assembly and generation).
- **Tests:** `npm test` runs vitest with **`environment: "node"` — there is no
  DOM.** Only pure functions are unit-testable; `h("div", {})` throws
  `document is not defined`. CSS and structural invariants are therefore
  checked by **source-text drift tests**, which is why the suite asserts on
  file contents. 162 files, 2682 tests, currently green.
- **Typecheck:** `npx tsc --noEmit`.
- Line numbers cited in the documents were accurate when written and the code
  has since moved in places. Treat a wrong line number as drift, not as a
  false claim — check the symbol, not the number.

## What this project has learned the hard way

Relevant because the documents lean on it, and because it says where errors
tend to be:

- **A CSS selector that matches nothing looks finished and does nothing.** Four
  were caught during the last two rounds. Grep the class before trusting a rule.
- **Tests here have repeatedly covered the new thing and not the thing it
  replaced.** Three defects reached implementers that way.
- **Reviews checked that things were built, not that they connect.** Two
  dialogs shipped that could never open, because nobody checked they were
  attached to the document.
- **Contrast ratios in these documents have twice been asserted without being
  computed.** Both were wrong. If a document states a ratio, recompute it.

## Constraints you should know before judging any proposal

- **There are no users but the author.** Nobody else has drawcasts saved or
  published. So **backwards compatibility is not a constraint**: deleting a
  feature, changing a default, or dropping a stored format needs no migration
  path and no deprecation. The project's standing rule is *replace or delete,
  never freeze*. Do not spend effort flagging missing migration paths — their
  absence is deliberate.
- **The author's stated aim**, in his words: *"I do not want to make it too
  complicated, but also I want the intent of these changes to be respected when
  possible. I am willing to revise and adapt if you have suggestions that are
  more intuitive or makes it significantly easier to implement."*
- Work ships in small parts, each reviewed, each pushed to `main`.

## Your brief

**Focus on §F of `ROADMAP-2026-09.md`** — the proposed seven-part split, and
especially the six places it revises the author's stated intent. Those are the
judgement calls with the largest consequences, and they are what has not been
independently examined. A factual audit of the specs is explicitly *not* what
is wanted here.

Three questions, in order of value:

**1. Are the six revisions genuinely simpler, or do they quietly drop something
the author asked for?** Each was offered as a simplification. Judge each on
whether it serves the intent or merely reduces work:

| | Revision | The intent it is simplifying |
|---|---|---|
| 1 | Drop per-save folders entirely | *"consider whether it should be possible to change the default subfolder"* |
| 2 | Name field only where a panel already exists | *"whether people should be able to change the name… for all saving and publishing options"* |
| 3 | Hide the lint chip entirely rather than showing errors | *"the red warnings… is mainly just annoying"* |
| 4 | Split the player part; icons first, layout later | *"I want the player… to be a bit like a youtube player"* |
| 5 | Do the title prompt-change first, maybe skip the DOM move | *"perhaps the title should be below the video"* |
| 6 | Take giscus's reactions; build no vote store | *"allow thumbs up and down… might also be saved externally if possible"* |

For each: does it deliver what was asked, deliver something better, or deliver
less while sounding like a simplification?

**2. Is the seven-part order right?** In particular — does shipping Part 1
first leave the app in a coherent state, or does it half-apply changes that
only make sense with a later part? (Part 1 renames Share to Publish and moves
it; Part 3 changes what Publish contains.)

**3. What is over-engineered, and what did the author miss?** These documents
were written by one model across one long session, refined by the author's
pushback. Cross-document contradiction and unexamined assumptions are the
failure modes it cannot see in its own work.
