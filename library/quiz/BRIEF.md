# Quiz drawcasts — author's brief (2026-10-03)

You make short INTERACTIVE quiz drawcasts for the Quiz row of drawcast.app's front page.
Work ONLY in `/Users/hom/Documents/GitHub/drawcast-quiz50` (a git worktree), ONLY on your
assigned slugs in `dev-casts/quiz/`. Never edit `src/`, tests, other slugs' files, never run
git, never publish, never stop the dev server (it runs on port 5201).

## Read first (once)
- `.claude/skills/drawcast/SKILL.md` — "The loop" and "What good looks like".
- `src/llm/prompts/look-v1.md` — the visual checklist.
- The interaction rules: `dev-casts/_prompt-a-short-quiz-which-animal-kills-the-most-humans-.md`
  lines 223–282 (Steer the story / Ask the viewer) — READ THEM ALL, they list every form:
  quiz, ask typed, ask `on` (bar / line draw-the-rest / pie slice / population / scale),
  cards (rank, sort bins, deck, select tap-all, along a scale, match, compare higher-or-lower,
  decide), choose on the figure, fill the formula (`\\blank{}`), predict, revise, allocate.
  Lines 1–222 are the general compiler rules — skim them.
- Six finished pilots to copy from: `dev-casts/quiz/{true-or-myth,cleopatra-closer,
  viking-words,animal-sleep,first-text-message,muller-lyer}.json`.
- Field lookup: `dev-casts/_schema.json` (grep); template params: `node scripts/cast.mjs template <id>`.

## Tools (from the worktree root; always `export DRAWCAST_URL=http://localhost:5201`)
- `node scripts/cast.mjs check dev-casts/quiz/<slug>.json` — fix every INVALID and [error].
- `node scripts/cast.mjs frames dev-casts/quiz/<slug>.json` — tiles in `dev-casts/frames-<slug>/`
  + pacing. VIEW EVERY TILE (Read the PNGs). Fix what you see. 2–3 rounds.

## The house rules (from the author, Hans — they override taste)
- ALWAYS a question on top: open with `{"card": {"title": "<the question, short>"}}` — the
  heading stays all the way through. The spec `title` is the same question (may be a bit longer).
- The first spoken line asks the question while the first ink goes down.
- An interaction EARLY (beat 2–4), then the reveal, then BRIEF context: an anecdote, a curious
  fact, the why. Engaging; some humorous; facts must be true.
- 8–12 spoken lines (count `speak` + quiz/ask `right` lines). Connected narration: each line
  follows from the last ("So…", "But…", "And…"), never a list of facts. Short sentences for the ear.
- After a quiz/ask: at most one narrated line on the same point; a `wrong` hint never repeats the
  answer (for a check-each sort "{g} of {g.total} on the first try."; for place/compare/rank `{g}` already reads "2 of 3", so write "{g} close." or use {g.within}).
- FILL THE SCREEN. One main figure, drawn LARGE — use the page (1000×750, y up). Big icons
  (size 250–350 for a lone picture), `text.font_size` 32–36 at top level for scales, cards and
  bar charts, big labels (40–60) for the key word or number. Keep ink above y≈170: the bottom
  strip is the caption band. Keep below y≈650: the heading lives up there.
- What the voice reveals should also be DRAWN: a short label, a stamp, a number at each reveal
  (e.g. "MYTH"/"TRUE" stamps, "46 hours awake!", a gloss "vindauga = wind-eye").
- Words on the canvas are cues: a word or three.
- End on the payoff: emphasise only the payoff item, never a blanket highlight on everything.

## Hard-won lessons from the pilot
- Cards NEVER wrap: card text ≤ ~3 short words (deck ≤ 24 letters). Statements that need a
  sentence → a chain of `quiz` commands (choices ["True","Myth"]) over a big icon each, with a
  stamp drawn after each answer and `{"pause": 1.5}` after the stamp (see true-or-myth.json).
- A `node` needs `"shape": "rect"` or it is drawn as a circle. Allowed shapes: decision, chance,
  terminal, rect, circle, triangle, person.
- `icon` element: `"of": "banana", "set": "twemoji"` (separate fields), `"icon_look": "picture"`.
  twemoji has no pyramid/great wall; check what renders in the frames and swap if blank/wrong.
- Arrows take `{"x":…, "y":…}` endpoints (not [x, y]); no double heads.
- `style.dash` is a boolean.
- Ids `top`, `bottom`, `left`, `right`, `center` etc. are reserved words — never use them.
- `{score}` works in speech but not in canvas text.
- A scale's tick labels are small and negative years print as "-3000": add "BC"/"AD" texts or
  choose a range that avoids negatives.
- `choose` options must be drawn elements (a node with shape rect makes a good "Same"/"Neither"
  button); erase such buttons after the reveal.
- A spec's `card` beat should have no speak (or a few words); the next beat draws.

## Podcast style (two voices) — for the slugs marked DIALOGUE
Add `"voice": "a"` or `"voice": "b"` on every command with a `speak` (a = host who knows,
b = curious co-host who guesses, jokes, objects). It reads like two friends on a podcast: short
turns, b reacts ("Wait — the French?"), a explains. The quiz/ask itself is posed as usual.
See the dialogue example: `grep -n "Explain opportunity cost with a dialogue" src/examples.json`.

## Facts
Check every checkable claim (WebSearch; PubMed for health) BEFORE writing. Cut what you cannot
confirm. Studies/datasets/reports the narration relies on go in top-level `sources`
(`id, title, authors, year, finding`; `doi`/`url` only if you saw it), and the element showing
that number carries `"cites": [id]`. Prefer recent, authoritative numbers; say "about".

## Files you write per slug (all in dev-casts/quiz/)
1. `<slug>.json` — `{"request": "<a natural request + #interactive #short>", "subtitle": "<one
   sentence, 100–150 chars, what the viewer gets>", "spec": {…}}`
2. `<slug>.meta.json` — `{"file": "<slug>.json", "title": "<the spec title>", "subtitle": "<same>",
   "format": "quiz", "tags": [1–3 from: health, medicine, epidemiology, statistics, economics,
   finance, physics, chemistry, biology, earth, astronomy, mathematics, music, games, computing,
   history of science, data, history, language, culture, psychology, geography, sports, food],
   "level": "standard", "lang": "en", "score": <your honest 1–5>, "verdict": "keep",
   "dialogue": true|false, "notes": "<template gaps / anything the app could not do>"}`
3. `<slug>.lines.txt` — every spoken line in order, quiz/ask as `[ASK] question` and
   `  [right] …` / `  [wrong] …` (generate with the snippet used for the pilots, or by hand).

## Your report (final message)
Per slug: title, interaction, one-line hook, score, tile paths, and anything the engine could
not do. Keep it short.
