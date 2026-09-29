---
name: drawcast
description: Author a drawcast — or a whole course of them — locally, the way the app would but with eyes — write the spec to the app's own prompt, render its frames, look, fix, repeat — then open it in the player. Publishes a new one to a GitHub repo of the user's (and buys it a drawcast.app/#name pretty link), and revises a PUBLISHED drawcast or course from its GitHub link, handing the change back as a pull request (or a direct commit, when allowed). Use when Hans asks to make, draw or write a drawcast (or "a figure/cast explaining X"), to make a course, or to revise/fix/update one that is on GitHub, here in Claude Code rather than in the app.
---

# Author a drawcast locally

You write the spec yourself, to the SAME prompt, templates and checks the app
uses (scripts/cast.mjs loads the app's own code), but unlike the app's single
API call you can look at the result and fix it until it is right. In the
prompt lab (docs/prompt-lab on branch prompt-lab) figures made this way
scored higher than API ones, mostly because the look-and-fix step always
landed. The finished cast opens in the app's player.

## Setup (once per session)

- Work in the main checkout (or a worktree if Hans says so). `npm ci` if
  node_modules is missing.
- Dev server, in the background: `npm run dev -- --port 5199 --strictPort`
  (skip if `curl -s localhost:5199` already answers). Frames and the player
  need it.

## The loop

1. **Read the prompt the app would send.**
   `node scripts/cast.mjs prompt "<request>"` writes `dev-casts/_prompt-<request-slug>.md` (the path is printed; one file per request, so parallel authors never share one):
   the compiler prompt, the template index, the few-shots, the exemplars
   picked for this request, and the shortlisted templates in full at the
   end (~120k characters — read it in chunks, all of it, the first time in
   a session: the rules and verbs are what the renderer understands). The
   JSON schema is in `dev-casts/_schema.json`: look an element's or a
   command's fields up there (grep it) when you need them. For another
   template's parameters: `node scripts/cast.mjs template <id>`.
2. **Storyline first** (the app's default since 2026-09-28 — Settings'
   "Write the story first"): before any JSON, write the storyline to
   `dev-casts/<slug>-story.md` by the rules in
   `src/llm/prompts/treatment-v3.md` — the question as asked, the naive
   answer, one insight named at the end, an example with correct numbers,
   one change at a time with a ghost, key numbers on the canvas, a figure
   budget (one main figure, at most ONE temporary supporting piece at a
   time, each marked "gone after beat N"), a template's real interactions
   planned into an explore beat, a transfer quiz with a `wrong` hint, 12–17
   short sentences. Then STAGE it (step 3) as the app's staging note says
   (`stagingNote` in `src/llm/treatment.ts`): the lines are sacred, the ink is
   not. If a planned template cannot do what the story needs and you go
   freehand, note it (template + what was missing) in your report — that is
   a template to extend. (Under "Write it in one go", plan in a few lines
   for yourself instead.)
3. **Write the spec** to `dev-casts/<slug>.json` as `{"request": …, "spec": …}`.
4. **Check it:** `node scripts/cast.mjs check dev-casts/<slug>.json`. Fix
   every INVALID and every `[error]`; warnings are for step 5's eyes — a
   `crowding` warning (too many texts on the page at once, or small print)
   means erase what has served or draw fewer, larger things.
5. **Look at it:** `node scripts/cast.mjs frames dev-casts/<slug>.json` →
   tiles in `dev-casts/frames-<slug>/`, one frame per spoken line (drawn
   mid-gesture where the line highlights, focuses, points or flows), plus the
   browser's lint per frame. VIEW EVERY TILE (`--large` gives one frame per
   row, for judging small text). Judge as a viewer, with
   `src/llm/prompts/look-v1.md` as the checklist: legibility, one large main
   figure, sync of words and picture, emphasis that lands, calm.
6. **Fix and repeat 4–5** until nothing important is left (usually 2–3
   rounds). Fix causes, not symptoms: a crowded page wants fewer or shorter
   things, not nudged coordinates.
7. **Fresh eyes (for anything that matters):** hand the tiles and
   `look-v1.md` to a subagent that has not seen the spec, and ask for its
   problem list. Fix what is real.
8. **Show it:** `node scripts/cast.mjs open dev-casts/<slug>.json --launch`
   prints the player URL and opens it in the browser. Mute when you play it
   yourself.

## What good looks like (the house taste, short)

- The first spoken line says what question the drawcast answers, while the
  first ink goes down (it may ride the axes); then why it matters.
- One insight; mechanism, not just result; a concrete example with numbers;
  12–17 short sentences for the ear.
- **Words on the canvas are cues:** a word or three ("Survives", "Dies");
  the voice carries the sentence.
- One main figure, drawn large; at most two supporting pieces.
- Something happens while each line is spoken; emphasis only where the
  meaning is; calm, few colours, each one role.
- A closing quiz that checks the insight, not recall.
- Only facts, numbers and people you are sure of.
- A link to another drawcast is a `link` element (`href`, `form: card|text`,
  `open`, optional `title`/`image`) — only to targets Hans or the course
  gives (`./file.yaml`, `lecture:N`, a GitHub or Drive link); never invent one.

## When it is done

- Tell Hans the URL and one line on what the figure shows.
- Offer, don't do: adding it to `src/examples.json` (then
  `npx vitest run tests/examples.test.ts` must stay green — examples must lint
  with no warning at all), or saving it elsewhere.
- Anything the engine or a template could not do — a missing option, a bug —
  is worth a line to Hans: it is a fix for the app too.

## A course

A course is what the app's course panel makes: a plan (`course.md`), and per
lecture a storyboard (the whole lecture's narration, written at once) whose
parts are each staged as a drawcast. `scripts/cast.mjs` gives every step the
app's OWN prompt and code, in a folder shaped like a published course:
`dev-casts/courses/<slug>/` with `course.md`, `lecture-NN/` (working files)
and one `NN-<title>.yaml` per built lecture.

1. **Plan.** `node scripts/cast.mjs course-prompt "<request>" [--lectures N]`
   → `dev-casts/_course-prompt.md`. Write the JSON it asks for (questions,
   not topics; the shared context; tags such as `parts=4`) to
   `dev-casts/courses/<slug>/plan.json`, then
   `node scripts/cast.mjs course-new dev-casts/courses/<slug>/plan.json dev-casts/courses/<slug>`.
2. **Show Hans `course.md` and wait.** The plan is a draft the teacher edits
   (that is how the app works too); the lectures cost hours. Take his edits
   into `course.md` directly — its format is what the course panel shows.
3. **Each lecture** (in parallel: one subagent per lecture, each given this
   skill and its lecture number; lectures do not depend on each other):
   - `node scripts/cast.mjs lecture-prompt <dir> <n>` → write the storyboard
     JSON it asks for to `<dir>/lecture-NN/storyboard.json`. This is where
     the lecture's narration is written, for all its parts at once.
   - For each part i: `node scripts/cast.mjs part-prompt <dir> <n> <i>` →
     read the prompt (the part's request, with its already-written lines, is
     at the end), write `<dir>/lecture-NN/part-<i>.json` as
     `{"request": …, "spec": …}`, then the single-cast loop above: check,
     frames, look, fix. The lines are written; the job is to STAGE them.
   - Both use the v2 storyboard prompt by default (the app's default since
     2026-09-28: the storyline rules, templates with "Viewer can", and a
     per-part staging note); `--storyboard v1` gives the previous prompt. Use
     the same version for a lecture's storyboard and its parts.
   - `node scripts/cast.mjs lecture-build <dir> <n>` → the lecture's YAML,
     exactly as the course runner assembles it (titles, level, the
     "Next: …" card), and `status: done` in `course.md`. Frames the YAML
     once more for a last look across the parts.
4. **Open it:** `node scripts/cast.mjs course-open <dir> --launch` imports
   the course into the app (built lectures only; opening again refreshes
   it) and opens the course panel. From there Hans watches, edits, and
   publishes as with any course.

Report per lecture as it lands (title, parts, one line on what it shows);
a lecture whose part will not come right is worth a line to Hans rather
than a silent compromise.

## Publishing something new (to a GitHub repo of the user's)

A drawcast or a course made here (a folder with one cast YAML, or a course folder) goes to a
public repo the user chooses; after that it is revised like anything published.

1. **Which account and repo.** `gh api user --jq .login` names the account gh is signed in
   as; say it, and ask which repo (an existing public one, or a new one) and folder. If gh
   is not signed in, ask the user to run `! gh auth login`.
2. `node scripts/cast.mjs publish-target <workdir> <owner/repo> [--dir <folder>] [--create]`
   — `--create` only when the user said to make the repo (public). It switches Pages on,
   picks a slug no other cast or course in the repo has (rewriting `slug:` in course.md),
   and writes `origin.json`.
3. `push <workdir> --dry-run`, show the file list, and on a yes `push <workdir> --direct`
   (it is the user's own repo; a PR to themselves is noise — unless they want one, or the
   repo is someone else's: then plain `push` opens a PR from a fork).
4. Report the player link (`drawcast.app/#gh=…`) and, for a course, the course page (Pages
   can take a minute the first time). Narration is the browser's voice until the course is
   published with narration from the app. Later revisions: step 4 onwards of the revise
   flow below, on the same workdir.

## A pretty link (drawcast.app/#<name>)

Only for something already pushed (it needs `origin.json`; a course or a cast). Every name is
bought, one-time: 20 USD up to 5 characters, 10 USD up to 7, 5 USD longer; 3 at least.
The `#gh=` link stays free — say so if the user only wants a link to share.

1. **Signed in?** `name` says so if not: `node scripts/cast.mjs login` prints a code and
   drawcast.anvil.app/#device; the user signs in there and types the code. Once per machine
   (`logout` undoes it; so does "Sign out everywhere" on the account page).
2. `name <workdir> <name>` — free (with its price) / yours / taken. Tell the user the price.
3. **Only on the user's yes to that price:** `name <workdir> <name> --buy --price <cents>`.
   It opens Stripe Checkout in their browser; they pay there. Never ask for card details,
   and never pick a price for them. A name already theirs is repointed here at no cost.
4. `name-wait <workdir>` (in the background; up to 9 minutes) until the name resolves here.
   "Not paid (yet)" is not a failure: run it again after they pay. A course: push once more
   so the course page carries the name.

## Revising what is published (a GitHub link)

Any link to it works: the course page (owner.github.io/repo/<course>/), the
folder or a file on github.com, a player link (drawcast.app/#gh=…), raw, or
owner/repo/path. A link to one lecture pulls its whole course (the course
page, READMEs and end pages hang together) and says which lecture it was.
A drawcast.app/#<name> short link does not say where the files are — ask for
the GitHub one.

1. **Pull.** `node scripts/cast.mjs pull <link>` → a sparse clone in
   `dev-casts/repos/` and a working copy: a course in
   `dev-casts/courses/<slug>/` (course.md and the published lecture YAMLs,
   the same shape as a course made here), a single drawcast in
   `dev-casts/pulled/<slug>/`. `origin.json` records where it came from.
2. **Unpack only what the change touches.** `unpack <course-dir> <n>` →
   `lecture-NN/part-N.json` + `outline.json`; `unpack <cast.yaml>` →
   `<name>.parts/`. The parts are ordinary specs: `check`, `frames` and
   `open` take them as they are.
3. **Read the rules.** `revise-prompt <parts-dir> "<the change>"` gives the
   app's prompt with the document's own templates in full (first time in a
   session, read it all, as in the loop above).
4. **Edit, then the loop** (check → frames → look → fix) on the parts you
   changed. Change what was asked and nothing else: every spoken line you do
   not need to touch stays word for word — baked narration is keyed by the
   sentence, so an edited line loses its recording. Reorder, drop or add
   parts in `outline.json`'s `entries` (a new part is a new `part-N.json`,
   written with `prompt` as any cast). The last part of a lecture is its
   end page (Previous / Next / Watch again, as `link` elements): push redraws
   it from course.md, keeping any `link` elements you add to it.
   Course-level changes go in `course.md` directly: retitle, reorder, edit
   questions, drop a lecture. Never change a `file:` on a status line — it is
   the published link. A new lecture is made with the course steps above
   (lecture-prompt … lecture-build), which give it its status line.
5. **Repack** `repack <parts-dir>` → the YAML again, with the meta as it was
   and the recordings of every line still said; it reports lines left with
   no recording. Frame the repacked YAML once (answers stored in one part
   are read in the next). Show it: `course-open <dir> --launch` or
   `open <yaml> --launch`.
6. **Push, after asking.** Always `push <workdir> --dry-run` first and show
   Hans the file list. Then, with his yes:
   - default: `push <workdir> -m "<what changed>" --body "<why, per lecture>"`
     → a branch and a pull request. Without push rights on the repo it forks
     first and opens the PR from the fork. Pushing the same workdir again
     updates that PR (`--new-pr` for a separate one).
   - `--direct` commits to the default branch — only when Hans has said so
     for THIS push, and only on a repo he can push to. Published links read
     raw.githubusercontent.com, which can lag a few minutes.
   - `--no-push` commits in the clone and stops, to inspect with git.
   Push regenerates what the app's own publish would (the course page with
   its Join door as it was, READMEs, courses.json/casts.json, Next links and
   cards) and refuses if those files changed on GitHub since the pull: pull
   again into a fresh workdir and carry the edit over.

Report what changed per lecture and the PR link, and say two things when
they apply:
- **The app's own copy is now older than GitHub.** "Load courses from
  GitHub" keeps a local course that is newer than the manifest
  (course/load.ts), so the app will not pick the revision up by itself — and
  publishing the course from the app would put the old lectures back. Before
  publishing from the app again: remove the course there, then load it from
  GitHub.
- Lines that lost their recording play in the browser's voice until the
  course is published with narration from the app (after the step above);
  unchanged lines reuse the published recordings for free.
