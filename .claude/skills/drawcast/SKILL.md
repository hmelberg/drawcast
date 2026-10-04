---
name: drawcast
description: Use when the user asks to make, draw or write a drawcast (or "a figure/cast explaining X"), to make a course of drawcasts, to revise, fix or update a drawcast or course published on GitHub, or to publish one, buy it a drawcast.app/#name link, make it private, change its catalogue listing or buy narration credit — here in Claude Code in the drawcast repo, rather than in the app.
---

# Author a drawcast locally

You write the spec yourself, to the SAME prompt, templates and checks the app
uses (scripts/cast.mjs loads the app's own code), but unlike the app's single
API call you can look at the result and fix it until it is right. In the
prompt lab (docs/prompt-lab) figures made this way scored higher than API
ones, mostly because the look-and-fix step always landed. The finished cast
opens in the app's player.

## Which file for which job

| The user wants | Read |
|---|---|
| One drawcast | this file |
| A drawcast that explains a picture part by part | this file + `references/pictures.md` |
| A course (several lectures) | this file + `references/course.md` (+ `references/rule-card.md` for its parts) |
| A book — written text beside (or under) the figures, `#column` / `#row` | this file + `references/book.md` |
| A change to something published (a GitHub, course-page or player link) | this file + `references/revise.md` |
| To publish, a pretty link, private, listing, narration credit | `references/publish.md` |

## Setup (once per session)

- Work in the main checkout (or a worktree if the user says so). `npm ci` if
  node_modules is missing.
- Dev server, in the background: `npm run dev -- --port 5199 --strictPort`
  (skip if `curl -s localhost:5199` already answers). Frames and the player
  need it. Another port: set `DRAWCAST_URL=http://localhost:<port>` for
  `cast.mjs`.
- Frames need a headless Chromium: if `frames` says there is none, run
  `npx playwright-core install chromium-headless-shell`.

## The loop

Name the drawcast with a short slug (lowercase, dashes: `compound-interest`);
every working file below is `dev-casts/<slug>…`.

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
   `dev-casts/<slug>-story.md`. It opens with the brief — five lines:

   ```
   Audience: <who watches — a patient, a first-year student, nurses, a health economist…>
   Level: basic | standard | advanced
   Language: <the narration's language>
   Length: <number of spoken lines>
   Subtitle: <one sentence, ~100–150 characters: what the viewer gets>
   Headline: <the front-page picture's words, shouted — "It's not the shark"> (becomes its `thumb` line)
   ```

   The user may set any of them — in words ("for nurses", "keep it short")
   or with the app's own tags, the same ones the controls beside Generate
   set (`#students`, `#professionals`, `#children`, `#for=<who>`;
   `#basic`/`#advanced`; `#veryshort` 5–7, `#short` 8–12, `#long` 22–30,
   `#verylong` 30–40 lines; `#norwegian` …, as `src/llm/tags.ts` defines
   them) — and the request wins. Where it says nothing, the
   defaults are the app's:
   - **Audience:** curious adults of better-than-average ability with
     decent general knowledge, but no special knowledge of this topic.
   - **Level:** `standard` — between the `#basic` brief (no jargon, every
     term defined) and the `#advanced` one (technical terms, prior
     knowledge assumed): define a field's own terms once, in passing.
   - **Language:** the language the request is written in.
   - **Length:** 14–20 spoken lines; a length tag gives its own range.
   - **Headline:** write two or three in a playful, faintly ironic
     clickbait voice that the cast actually pays off ("It's falling right
     now", "99 % accurate. Probably fine.") and let the user pick; never a
     promise the cast does not keep. It becomes the front-page picture's
     line (`thumb`, plain words in any order, quoted words where a word
     takes them): words `band "…"` (the tilted yellow strip, default) ·
     `burst "…"` (comic lettering) · `question "…"` · `none`; figure `eyes`
     (peeking over the band) or, for children only, `aha` `surprised`
     `puzzled` `thinking`; marks, any number: `note "…"` `stamp "…"`
     `star` (or `star "?"`) `bang` `seal` `arrow`. Choose by audience and
     content: children — `band` + a cartoon (`thinking` for a quiz,
     `surprised` for a surprising fact, `aha` for an explanation); youths —
     `band` + `star`, `bang` or `eyes`; adults — `band` + `note` (a
     surprising fact) or `stamp` (a myth or verdict: "MYTH?", "PLOT
     TWIST"); advanced — `band` alone or `question`.
   - **Subtitle:** write one yourself: a single sentence in the narration's
     language saying what the viewer gets ("How herd immunity protects
     people who can't be vaccinated"), not "a drawcast about…". It is the
     line under the title on the cast's link card when it is shared.
   Name the defaults you used in your report so the user can change them.
   The spec's `level` field is set only for `basic` or `advanced`.

   Then the storyline, by the rules in `src/llm/prompts/treatment-v3.md` —
   the question as asked, the naive answer, one insight named at the end,
   an example with correct numbers, one change at a time with a ghost, key
   numbers on the canvas, a figure budget (one main figure, at most ONE
   temporary supporting piece at a time, each marked "gone after beat N"), a
   template's real interactions planned into an explore beat, a transfer
   quiz with a `wrong` hint, short sentences for the ear. Pitch every
   sentence at the brief's audience.

   Then STAGE it (step 4) as the app's staging note says (`stagingNote` in
   `src/llm/treatment.ts`): the lines are sacred, the ink is not. If a
   planned template cannot do what the story needs and you go freehand,
   note it (template + what was missing) in your report — that is a
   template to extend. (When the user asks you to skip the storyline, plan in
   a few lines for yourself instead.)
3. **Check the facts and name the sources.** List every claim in the
   storyline a viewer could look up: each number, study, date, named person
   or rule. Check each one now (WebSearch; PubMed for medicine and health)
   and fix the storyline where it was wrong. A claim you cannot confirm is
   cut or turned into the worked example's own made-up numbers, said as
   such ("say a drug costs…"). Each study, report, guideline or dataset the
   narration relies on goes into the spec's top-level `sources`
   (`id`, `title`, `authors`, `year`, `finding`; `doi`/`url` only when you
   saw it yourself), and the canvas element that shows its number or claim
   carries `"cites": ["<id>"]`. A drawcast with only textbook facts and
   made-up example numbers has no `sources` — that is fine.
4. **Write the spec** to `dev-casts/<slug>.json` as `{"request": …, "subtitle": …, "thumb": "band \"It's not the shark\" stamp \"MYTH?\"", "spec": …}`
   — the brief's subtitle and picture line beside the spec, not inside it
   (`cast.mjs pack` puts them in the published file's header; the line may
   also carry `title "…"`, a listing title of its own). A course needs none per lecture:
   its card's line is the first paragraph under the title in `course.md`.
5. **Check it:** `node scripts/cast.mjs check dev-casts/<slug>.json`. Fix
   every INVALID and every `[error]`; warnings are for step 6's eyes — a
   `crowding` warning (too many texts on the page at once, or small print)
   means erase what has served or draw fewer, larger things.
   `no icon for "X"` means a BLANK icon: give fallbacks (`"icon": ["guinea pig", "hamster"]`; an icon element's `"or": […]`) or draw it.
6. **Look at it:** `node scripts/cast.mjs frames dev-casts/<slug>.json` →
   tiles in `dev-casts/frames-<slug>/`, one frame per spoken line (drawn
   mid-gesture where the line highlights, focuses, points or flows), plus the
   browser's lint per frame. VIEW EVERY TILE (`--large` gives one frame per
   row, for judging small text). Judge as a viewer, with
   `src/llm/prompts/look-v1.md` as the checklist: legibility, one large main
   figure, sync of words and picture, emphasis that lands, calm. Then read
   the `pacing` lines (running time, spoken-line count against the length
   brief, and one line per `@N` beat where the canvas sits idle — over 5 s,
   over 2 s before the first ink — the ink runs on after the voice, or a
   beat is overlong) and fix the cause: erase or add an action on an idle
   line, split an overlong beat, cue a late reveal. The limits are soft: a
   stillness you chose (a result left to sink in) may stay — say so in your
   report. The opening is the exception: never talk over a blank page; the
   first line rides the first strokes.
7. **Fix and repeat 5–6** until nothing important is left (usually 2–3
   rounds). Fix causes, not symptoms: a crowded page wants fewer or shorter
   things, not nudged coordinates.
8. **Fresh eyes, every time.** Once your own rounds are done, start one
   subagent with the Agent tool, `model: "opus"` (the prompt lab found a
   smaller model misses most real problems and invents others). Give it the
   tile paths, the spoken lines in order, the brief, and
   `src/llm/prompts/look-v1.md` — never the spec or your storyline — and
   ask for its problem list, most serious first. Fix what is real, frame
   once more, and say in your report what you took and what you left.
   When you are yourself a subagent (no Agent tool), end with the tile
   paths and the spoken lines in your report instead: the session that
   started you runs this step.
9. **Show it:** `node scripts/cast.mjs open dev-casts/<slug>.json --launch`
   prints the player URL and opens it in the browser. Mute when you play it
   yourself (narration AND WebAudio tones).

## What good looks like (the house taste, short)

- The first spoken line says what question the drawcast answers, while the
  first ink goes down (it may ride the axes); then why it matters.
- One insight; mechanism, not just result; a concrete example with numbers;
  14–20 short sentences for the ear (the brief's length).
- **Words on the canvas are cues:** a word or three ("Survives", "Dies");
  the voice carries the sentence.
- One main figure, drawn large; at most one supporting piece at a time.
- Something happens while each line is spoken; emphasis only where the
  meaning is; calm, few colours, each one role.
- A closing quiz that checks the insight, not recall.
- A model to copy for quizzes and openings — *the-deadliest-animal*
  (hmelberg/drawcast-library): an interesting, non-obvious question; a few
  details that fold a second question into the first (how many does the
  mosquito kill?); a surprising answer; then a kicker fact that reframes it
  (the runner-up is us).
- Rankings read like a number line: least on the left, most on the right
  (a column: most on top) — the engine lays a magnitude rank out that way
  whatever the order of `ends`. Bar numbers are the chart's own
  `value_labels: true`, never text placed over the bars (they drift off the
  bars and Test me cannot hide them). On a chart, `highlight` a bar rather
  than `focus` — focus is for a dense figure of six or more parts.
- Every checkable claim checked (step 3); the studies behind it in `sources`.
- A link to another drawcast is a `link` element (`href`, `form: card|text`,
  `open`, optional `title`/`image`) — only to targets the user or the course
  gives (`./file.cast` or `./file.yaml`, `lecture:N`, a GitHub or Drive link); never invent one.

## When it is done

- Tell the user the URL and one line on what the figure shows, plus the
  brief's defaults you chose and what the fresh eyes found.
- Offer, don't do: adding it to `src/examples.json` (then
  `npx vitest run tests/examples.test.ts` must stay green — examples must lint
  with no warning at all), publishing it (`references/publish.md`), or
  saving it elsewhere.
- Anything the engine or a template could not do — a missing option, a bug —
  is worth a line to the user: it is a fix for the app too.
