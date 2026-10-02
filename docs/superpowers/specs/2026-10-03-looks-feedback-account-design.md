# Looks, feedback and the account bar — round 5

Date: 2026-10-03 · Status: proposed (round 5 of guess-and-reveal; builds on
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
{"ask": {"…": "…", "feedback": {"style": "dry", "role": "pharmacist", "reward": "auto"}}}
```

- `style`: `plain` (default — today's behaviour), `warm`, `dry`.
- `role` (optional): who the viewer would be if they were good at this
  ("pharmacist", "economist") — lets the lines say "Good thing you're not a
  pharmacist." Without it, the lines are generic.
- `reward`: `auto` (default when the style is not plain), `none`, `confetti`,
  `picture`, `joke`.

### 4.2 The line

After the author's right/wrong line, the player adds ONE short line from a
bundled set, chosen by how well the viewer did:

| Band | When | dry (examples) | warm (examples) |
|---|---|---|---|
| perfect | all right | "Suspiciously good. Have you done this before?" | "Spot on — every one." |
| good | ≥ ⅔ right, or a close guess | "Not bad. Not bad at all." | "Nearly all of them. Nicely done." |
| poor | some right | "Good thing you're not a {role}." / "Let's call that a warm-up." | "A tricky one — most people miss these." |
| none | nothing right | "Bold. Wrong, but bold." | "Everyone starts somewhere. Now you know." |

- A guess (`on`) uses its score: within tolerance = perfect; within twice the
  tolerance = good; else poor. A single right/wrong ask uses perfect/none.
- The set holds several lines per band and style, picked without repeating
  within a cast (seeded by the cast, so a replay is the same).
- `{role}` lines are only used when `role` is given.
- Lines are bundled in `src/feedback/lines.ts`, in English and Norwegian
  (bokmål); the cast's `lang` picks the set; other languages fall back to
  plain.
- The line is spoken and captioned like the author's line, straight after it.

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
  topics (never for serious personal topics such as a diagnosis); the budget
  ask now balances against an account.
- `#interactive` brief: one line on icons on cards; one line on `feedback`.
- The prompt-size pin moves once.

## 7. Lint

- `feedback.role` without a non-plain style → warning (it does nothing).
- `reward: "joke"`/`"picture"` with `style: "plain"` → warning.
- A card `icon` that is a whole sentence (more than three words) → warning:
  an icon keyword is one or two words.
- `look` on anything but a cards element → schema error.

## 8. Build order

1. **A1 — nodes:** `radius`, `shadow` (layout + backend, sketchy/clean, export).
2. **A2 — cards:** `look` presets; `icon` on nodes and card items (layout,
   cards geometry heights, moving with the card); the two examples.
3. **C — account bar:** the gate, marks, lint, movie; "Your health budget".
4. **B — feedback:** lines module (en + nb), bands per ask kind, player
   integration, rewards (sparkle, confetti overlay, picture, joke), `{streak}`,
   reduced motion; flavour added to the drug-match example (`dry`, role
   "pharmacist") and one other.
5. Guidance, prompt pin, a muted browser check of every touched example, a
   generated test cast, push.

## 9. Decisions needed

1. **Default look:** should `paper` (rounded, shadow) become the default for
   ALL existing card examples, or only for new casts (existing ones stay
   `outline` unless revised)? Proposed: default for all — the user asked for
   nicer cards, and the change is purely visual.
2. **Feedback default:** `plain` everywhere unless a cast or ask asks for more
   (proposed), or `warm` by default for `#interactive` casts?
3. **Norwegian lines:** write a bokmål set now (proposed, since the app has
   Norwegian casts), or English only for now?
