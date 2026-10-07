# Our World in Data quizzes — author's brief (2026-10-07)

You make short INTERACTIVE quiz drawcasts for the Quiz row of drawcast.app's front page, each
built on a fact from Our World in Data (ourworldindata.org). Hans asked for: interesting,
engaging and somewhat SURPRISING questions; after the answer, more context and/or a twist
(like *the deadliest animal*: the mosquito, then the kicker that the runner-up is us); and
VARIATION — the 50 must not all follow the same pattern.

Work ONLY in `/Users/hom/Documents/GitHub/drawcast-owid` (a git worktree), ONLY on your
assigned slugs in `dev-casts/quiz-owid/`. Never edit `src/`, tests, other slugs' files, never
run git, never publish, never stop the dev server (port 5233).

## Read first (once)
- `.claude/skills/drawcast/SKILL.md` — "The loop", the thumbnail section in step 4, and
  "What good looks like".
- `src/llm/prompts/look-v1.md` — the visual checklist.
- `dev-casts/_prompt-a-short-quiz-what-share-of-all-mammals-on-earth-.md` — lines 226–300
  (Steer the story / Ask the viewer) list EVERY interaction form: quiz, ask typed, ask `on`
  (bar / line draw-the-rest / pie slice / population / scale), cards (rank, sort bins, deck,
  select tap-all, along a scale, match, compare higher-or-lower, decide), choose on the figure,
  predict, revise, allocate. Read them all. Lines 1–225: general rules — skim.
- Finished quizzes to copy from (the last batch of 50, all published): `dev-casts/quiz-ref/*.json`
  (meta beside each). Especially: `the-deadliest-animal.json` (the model), `true-or-myth`,
  `solar-panel-prices`, `world-population-curve`, `greenland-vs-africa`, `ants-on-earth`,
  `how-loud-is-loud`, and one dialogue: `grep -l '"voice": "b"' dev-casts/quiz-ref/*.json`.
- Field lookup: `dev-casts/_schema.json` (grep); template params: `node scripts/cast.mjs template <id>`.

## Tools (from the worktree root; always `export DRAWCAST_URL=http://localhost:5233`)
- `node scripts/cast.mjs check dev-casts/quiz-owid/<slug>.json` — fix every INVALID and [error].
- `node scripts/cast.mjs frames dev-casts/quiz-owid/<slug>.json` — tiles in
  `dev-casts/frames-<slug>/` + pacing. VIEW EVERY TILE (Read the PNGs). Fix what you see. 2–3 rounds.
- `node scripts/cast.mjs thumbnail dev-casts/quiz-owid/<slug>.json` — look at each at quarter size.

## Facts — Our World in Data first
- Every quiz rests on an OWID chart or article. Find it (WebSearch `site:ourworldindata.org …`,
  then WebFetch the article or `https://ourworldindata.org/grapher/<chart>` page) and take the
  number from there, with its year. If OWID's number differs from the one in this brief, OWID
  wins — the brief's numbers are from memory and some will be off. If the surprising claim does
  not hold up, change the question (tell me in the report) rather than bend the fact.
- `sources`: the OWID page (`id`, `title`, `authors` ("Our World in Data" or the named authors),
  `year`, `finding`, `url` — the page you actually opened) and, where OWID names it, the
  underlying dataset (UN, WHO, FAO, IEA…). The canvas element showing the number carries
  `"cites": [id]`. Say "about" for rounded numbers.
- Heavy topics (child deaths, disease, suicide) are told plainly and respectfully: no jokes
  about the deaths, and the twist is usually progress or perspective, not shock.

## The house rules (from Hans — they override taste)
- ALWAYS a question on top: open with `{"card": {"title": "<the question, short>"}}` — the
  heading stays all the way through. The spec `title` is the same question (may be a bit longer).
- Ask once: the heading asks; the voice asks it once; the ask's `question` gives only the task.
- The first spoken line asks the question while the first ink goes down.
- An interaction EARLY (beat 2–4), then the reveal, then the context/twist. Engaging; some
  humorous; facts true.
- 8–12 spoken lines (count `speak` + quiz/ask `right` lines). Connected narration: each line
  follows from the last ("So…", "But…", "And…"). Short sentences for the ear.
- After a quiz/ask: at most one narrated line on the same point; a `wrong` hint never repeats
  the answer.
- FILL THE SCREEN. One main figure, drawn LARGE. Let the engine size cards (no card `size`).
  Big icons (250–350 for a lone picture), big labels (40–60) for the key word or number. Keep
  ink above y≈170 (caption band) and below y≈650 (heading).
- What the voice reveals is also DRAWN: a short label, a stamp, a number at each reveal.
- Words on the canvas are cues: a word or three. Cards never wrap: ≤ ~3 short words.
- Rankings read like a number line (least left / most on top); bar numbers via
  `value_labels: true`; `highlight` a bar rather than `focus`.
- End on the payoff: emphasise only the payoff item.

## VARIATION (important)
Across your ten, use at least FIVE different interaction forms and at least FOUR different
story shapes, and no form more than three times. Story shapes to mix:
1. Guess → reveal → kicker that reframes (the deadliest animal).
2. Then and now: draw the rest of a line / guess the old number, then the change and why.
3. Myth or true: a short chain of claims, a stamp after each.
4. Mystery country/thing: clues, the viewer picks, the reveal explains why it's that one.
5. Duel: which is bigger — two things that sound unrelated, then the gap drawn to scale.
6. Two-voice podcast (DIALOGUE slugs): b guesses wrong out loud, a corrects, b jokes.
7. The double question: one guess folds into a second ("…and how many does that leave?").
8. "Most people guess wrong": the viewer's guess, then what surveys find people guess, then truth.
9. One big number made graspable (per person, per day, per second).
Pick per slug what suits it; the form suggested below is a suggestion, not an order.

## Podcast style (DIALOGUE slugs)
`"voice": "a"` or `"voice": "b"` on every command with a `speak` (a = host who knows, b =
curious co-host who guesses, jokes, objects). Short turns; b reacts ("Wait — chickens?").

## Headline, subtitle, thumbnails
- `subtitle`: one sentence, 100–150 characters, what the viewer gets.
- `thumb` line: playful, faintly ironic, never a promise the cast doesn't keep (adults: `band`
  + `note` for a surprising fact, `stamp` for a myth or verdict).
- `thumbnails`: THREE, truly different (different hook AND picture) — a quiz's poster hides the
  answer, so the poster frame is a poor thumbnail. Never give the answer away in a thumbnail;
  a "?" where the answer goes is the classic.

## Files per slug (all in dev-casts/quiz-owid/)
1. `<slug>.json` — `{"request": "<natural request> #interactive #short", "subtitle": …,
   "thumb": …, "thumbnails": [ … ], "spec": {…}}`
2. `<slug>.meta.json` — `{"file": "<slug>.json", "title": "<spec title>", "subtitle": "<same>",
   "format": "quiz", "tags": [1–3 from: health, medicine, epidemiology, statistics, economics,
   finance, physics, chemistry, biology, earth, astronomy, mathematics, music, games, computing,
   history of science, data, history, language, culture, psychology, geography, sports, food],
   "level": "standard", "lang": "en", "score": <honest 1–5>, "verdict": "keep",
   "dialogue": true|false, "shape": "<story shape number>", "form": "<interaction form>",
   "owid": "<the OWID url>", "notes": "<template gaps / what the app could not do>"}`
3. `<slug>.lines.txt` — every spoken line in order; quiz/ask as `[ASK] question`,
   `  [right] …` / `  [wrong] …`.

## Your report (final message)
Per slug: title, form + shape, one-line hook, score, the OWID number used (and any correction to
this brief), tile paths, and anything the engine could not do. Keep it short.
