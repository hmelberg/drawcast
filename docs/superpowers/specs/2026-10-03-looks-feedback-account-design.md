# Looks, feedback and the account bar — round 5

Date: 2026-10-03 · Status: approved 2026-10-03 (round 5 of guess-and-reveal; builds on
`2026-10-02-more-ways-to-answer-design.md` and
`2026-10-03-curves-trees-formulas-design.md`). It comes before the decision-bias
course, which will be its first big user.

## 1. Purpose

Three things the user asked for after trying the examples:

| # | What | Why |
|---|---|---|
| A | **Card looks and icons**: rounded corners, a soft shadow, a few looks to choose from, and an icon on a card | The cards are plain sketched rectangles; examples like "What is more dangerous" are all words. The icon mechanism exists but is almost never used (6 icons in 382 examples). |
| B | **Feedback flavour and rewards**: an optional dry or warm line after an answer, scaled to how well you did; confetti or a reaction picture for a great result | The right/wrong lines are correct but flat. A little humour or a small celebration makes a longer task feel finished. |
| C | **The account bar** for budget questions | Today moving one bar moves all the others ("Your health budget"), so a bar you have set jumps when you set the next. |

## 2. Principles (unchanged)

- **Structure-derived:** one field on the content (`look`, `icon`, `feedback`),
  not hand-placed commands.
- **On the figure,** never in the tray.
- **Short canvas text;** the voice says the sentence.
- **Movies never wait** — and, new here, **movies stay plain**: no flavour
  lines and no rewards in movies or exports (the movie always answers right,
  so a "perfect!" would be hollow).
- **Optional and off by default** where it changes the tone (B); on by default
  where it only improves the look (A, C).

## 3. A — Card looks and icons

### 3.1 Boxes get corners and shadows (all nodes)

A `node` with `shape: "rect"` gains two fields, usable anywhere, not only on
cards:

- `radius` — corner radius in canvas units (default 0 = today's square box).
- `shadow` — `true` draws a soft shadow: the same rounded shape offset (3, 4)
  down-right, filled with the ink colour at 12 % opacity, no stroke, behind
  the box. It is an ordinary drawable (no SVG filter), so it looks the same in
  the sketchy, clean and mixed styles, in movies and in exported images.

Rounded rects are drawn by the backend from `shapeHint` (a rough.js path for
sketchy, an exact path for clean). The hit outline and `elementBBoxes` use the
rounded shape's box (unchanged size).

### 3.2 Card looks

A `cards` element gains `look`:

| `look` | Box | Fill | Shadow | Font |
|---|---|---|---|---|
| `paper` (default) | radius 10 | paper white (`#fffdf8`) | yes | as today |
| `flat` | radius 10 | a soft tint of the ink (8 %) | no | as today |
| `outline` | radius 0 | none | no | as today — the current look |

`look` is copied to every card the element expands to, and to the sort bins
(rounded ends for `paper`/`flat`), the fill tiles and the decide options. An
explicit `style` on the cards element still wins for colours.

### 3.3 Icons on cards (and nodes)

A node gains `icon`: a keyword (`"shark"`) or `{of, set}` — the same as an icon
element's `of`/`set`, resolved by the existing `resolveIcons` (Iconify search,
licence check, cache, embedded on publish). The icon is drawn inside the box,
above the text, at about 45 % of the box height; the box grows to fit
(a card with an icon is 96 high instead of 56).

A card item gains `icon` too:
`{"text": "Sharks", "icon": "shark", "value": 6}`. Requirements:
- The card's id (`<id>_<i>`) is still what moves, highlights, draws and is
  hit-tested; the icon always goes with its card (drag, glide, reveal, erase).
- An icon that cannot be resolved (offline, no match) leaves the card as text
  only, with the existing `no icon for "…"` warning — never an empty gap.
- Icons on cards are drawn hand-drawn like other icons (their rings), in the
  card's ink.

### 3.4 The two examples

- **"What is more dangerous"** (compare): every card gets an icon (shark,
  lightning, snake, mosquito, a police siren for murder, car), `look:
  paper`; the opening draws a small scene first — a beach with a fin — and
  the voice moves from the scene to the question.
- **"What each drug does"** (match): drugs get icons (pill, syringe, capsule,
  heart), effects get icons (blood drop, sugar cube or glucose meter,
  bacterium, artery); `look: paper`.

Both keep their numbers and sources; the narration rules apply (opening says
what it's about, connected sentences, short canvas text).

## 4. B — Feedback flavour and rewards

### 4.1 Authoring

```json
{"feedback": "dry"}                                   // cast-level default (top of the spec)
{"ask": {"…": "…", "feedback": "warm"}}               // per ask, wins
{"ask": {"…": "…", "feedback": {"style": "dry", "reward": "auto",
         "perfect": "Suspiciously good. Pharmacist?",
         "good": "Three of four — the pharmacy can stay open.",
         "poor": "Good thing you're not a pharmacist.",
         "none": "Bold. Wrong, but bold."}}}
```

- `style`: `plain` (default — today's behaviour), `warm`, `dry`.
- `perfect`, `good`, `poor`, `none` (optional): the lines themselves, one per
  band, WRITTEN BY THE AUTHOR — in practice by the LLM that writes the cast, in
  the cast's own language and about its own topic ("Good thing you're not a
  pharmacist."). A band may hold a list; one is picked per ask.
- `reward`: `auto` (default when the style is not plain), `none`, `confetti`,
  `picture`, `joke`.

### 4.2 The line

After the author's right/wrong line, the player adds ONE short line for the
band the viewer reached — the cast's own line for that band when it has one,
else a line from a small bundled English fallback set (only when the cast is
in English; other languages get no fallback line). Examples of the bands:

| Band | When | dry (examples) | warm (examples) |
|---|---|---|---|
| perfect | all right | "Suspiciously good. Have you done this before?" | "Spot on — every one." |
| good | ≥ ⅔ right, or a close guess | "Not bad. Not bad at all." | "Nearly all of them. Nicely done." |
| poor | some right | "Good thing you're not a {role}." / "Let's call that a warm-up." | "A tricky one — most people miss these." |
| none | nothing right | "Bold. Wrong, but bold." | "Everyone starts somewhere. Now you know." |

- A guess (`on`) uses its score: within tolerance (as judged) = perfect;
  within 25 % of the true value = good (when the truth is 0: within twice the
  tolerance); else poor. A single right/wrong ask uses perfect/none.
- A cast-level `feedback` may carry lines too; an ask's own lines win.
  Lines are picked without repeating within a cast (seeded by the cast, so a
  replay is the same).
- The fallback set (`src/feedback/lines.ts`) is English only and generic (no
  topic, no role).
- The line is spoken and captioned like the author's line, straight after it.
- Lines may use the ask's stored vars ("{m} of 4 — the pharmacy can stay
  open.").

### 4.3 Rewards

| Reward | What the viewer sees | When (`auto`) |
|---|---|---|
| sparkle | a short green glow pulse on the answered part | any right single answer |
| confetti | a 1.5 s burst of paper confetti from the answered part, on an overlay (not in the figure) | a perfect score on a LONG task (≥ 4 items, or several parts), or the third right answer in a row |
| picture | a big reaction picture (twemoji, CC BY, through the icon mechanism: 🎉 🏆 for perfect, 🤦 🙈 for none) that pops up beside the figure for 2 s | only when asked for (`reward: "picture"`) |
| joke | a one-line, clean dad joke from a bundled list, spoken after a perfect long task | only when asked for (`reward: "joke"`) |

- Rewards never play in movies or exports, and never when the viewer skipped.
- Confetti respects `prefers-reduced-motion` (a still badge instead).
- A soft chime may accompany confetti through the existing tones, under the
  player's mute.
- `{streak}` (right answers in a row) is a new stored variable.

### 4.4 Not in this round

Jokes, pictures or gifs fetched from external APIs. They are unpredictable
(a random gif can be off-key in a health lecture), fail offline and in exports,
and some need keys. The bundled sets give the same feel safely; an opt-in
external source can come later.

## 5. C — The account bar

For a budget question (`budget` on a guess over bars), the bars no longer move
each other:

- **Each bar moves on its own.**
- **An account bar** stands to the right of the plot, on the same scale,
  labelled "Left" (or `account_label`). Its value is `budget − sum of bars`.
  It can go below zero: then it hangs down from the baseline in red, with its
  number.
- **Answer is enabled only when the account is zero** (within half a step);
  until then the hint reads "Balance the budget: {left} left" (or "{over}
  over"). Keys and typed numbers work as before, on the bars only.
- The "Total … of …" pill is replaced by the account bar.
- The account bar is a guess mark (drawn by the guess layer, in the guess
  colour; red when negative), so the chart's layout and data are untouched.
- `judge: false` keeps its meaning (an opinion, the reveal shows the chart's
  own values as the reference).
- The old rebalancing is removed (it was only used by this kind of ask).
- The movie: the bars glide to the `default` split (or an even split), the
  account reaches zero, then the reveal.

"Your health budget" is updated to say "balance it" rather than "the others
adjust".

## 6. Guidance

- Compiler prompt and rule card: cards and boxes can carry an `icon` — use it
  for concrete things (animals, drugs, objects); `look` exists but the default
  is fine; `feedback` is optional and best for longer quizzes and lighter
  topics (never for serious personal topics such as a diagnosis) — when used,
  write the four band lines yourself, short, in the cast's language, about its
  topic, kind rather than mean; the budget ask now balances against an
  account.
- `#interactive` brief: one line on icons on cards; one line on `feedback`.
- The prompt-size pin moves once.

## 7. Lint

- Band lines with `style: "plain"` → warning (they do nothing).
- A non-English cast with a non-plain style and no lines → warning (no
  fallback lines in that language).
- `reward: "joke"`/`"picture"` with `style: "plain"` → warning.
- A card `icon` that is a whole sentence (more than three words) → warning:
  an icon keyword is one or two words.
- `look` on anything but a cards element → schema error.

## 8. Build order

1. **A1 — nodes:** `radius`, `shadow` (layout + backend, sketchy/clean, export).
2. **A2 — cards:** `look` presets; `icon` on nodes and card items (layout,
   cards geometry heights, moving with the card); the two examples.
3. **C — account bar:** the gate, marks, lint, movie; "Your health budget".
4. **B — feedback:** band lines (authored, English fallback), bands per ask kind, player
   integration, rewards (sparkle, confetti overlay, picture, joke), `{streak}`,
   reduced motion; flavour added to the drug-match example (`dry`, role
   "pharmacist") and one other.
5. Guidance, prompt pin, a muted browser check of every touched example, a
   generated test cast, push.

## 9. Decisions (2026-10-03)

1. **Default look:** `paper` becomes the default for all card examples, old
   and new.
2. **Feedback default:** `plain` unless a cast or ask asks for more.
3. **Language:** the feedback lines are written by the cast's author (the LLM)
   in the cast's language; the bundled set is only an English fallback.

## 10. As built (2026-10-03)

Built on branch `round5-looks-feedback` in 10 plan tasks, two fix waves (a muted browser check of every touched example at desktop and phone width, a generated `#interactive` cast) and a final whole-branch review. Changes against the sections above:

**Looks and icons (§3)**
- Rect nodes take `radius` and `shadow`; the shadow (`<id>__shadow`) is outside highlights and fades in after the outline (≤ 200 ms), so a box draws about as fast as before.
- A node or card icon is resolved BEFORE the cards expand (`expandedRenderSpec`), so cards with icons really are taller in the player. An edited icon is resolved again (`icon_key`). Match partners take `match_icon`.
- Icon cards shrink to fit the canvas when there are many (an 8-card sort, a 6-pair match).
- Filled icon sets trace best; stroke-only sets (lucide) trace badly. Bundled examples ship their icon drawings.

**Account bar (§5)**
- The bar stands just past the plot (clear of the axis arrow), is slim, is cut with a break mark when it would leave the canvas, and its label is in the cast's language (Left / Igjen). Live bars start low, so the viewer must balance.
- A budget the bars cannot reach is a lint error; the gate never leaves the viewer stuck.
- The dock text uses `account_label` ("Hours left: 22").

**Feedback (§4)**
- An ask's lines without a style keep the cast's style. When a band's lines run out they come round again.
- A single guess: perfect = judged right; good = not right but within 25 % of the true value; else poor.
- The English fallback is used only for English casts, judged by `lang` or, when absent, by the language the cast is written in. The dock and buttons follow the same language.
- Rewards fire when the answer is scored: sparkle for a right single answer; confetti on a perfect long task and on every third right answer in a row (`{streak}` resets on rewind and does not count re-answers); bundled reaction pictures (no network); jokes in English casts only; plain plays no extras. Rewards are removed on a scrub and never play in movies or on a skip.

**Phone and UI**
- During a question on a phone the figure keeps most of the stage (one-line hint, Answer and Skip side by side, Sources hidden); captions page at two lines; the figure eases back after the reveal.

**Examples:** revised "What is more dangerous", "What each drug does", "Your health budget"; new "How fast can they run?", "Where do your 24 hours go?", "Is it a fruit?", "Hvor mye vann bruker vi?" and the generated "The deadliest animal".

**Left for later:** canvas text on phones is still small for dense charts; hidden answer values are in the accessibility tree before answering; widget gates (click, staff, piano, chess) are not localised; on a skip an ask still speaks its `wrong` line.
