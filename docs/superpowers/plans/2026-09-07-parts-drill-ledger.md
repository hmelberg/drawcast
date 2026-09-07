# Ledger — the generic identify drill + the manifest explore flag (2026-09-07)

Step 1 of the template-on-demand plan (assessment + spike ledger:
`2026-09-07-template-on-demand-spike-ledger.md`). Hans: "gjør 1".

## What shipped

**"🎯 Find the part" for any figure.** Interactivity spec §9 called
identify universal ("any template with named parts can generate it") but
the drill was bound to piano/chess/periodic. Now:

- `src/ui/parts-model.ts` (pure): a *part* is a drawn element with a hit
  geometry and a name. Names come from the sources the info card already
  trusts — an authored `label` and what it `attach_to`s, a `node`'s own
  words, a portrait's person, a template's `label_<part>` /
  `<part>_label` texts, and the scene's own names. Labels, texts, sources,
  code and annotations are never parts; symbols ("D′") never name one.
  `MIN_PARTS = 3`.
- `activitiesFor(interactions, partsCount)`: the generic drill appears
  only when the figure declares NO bespoke interaction, so the pill row
  never offers two ways to ask "click the ___".
- `ui/quiz.ts`: a fourth data space in the same loop. Hit test =
  `hitElement` over the askable parts' boxes with their closed outlines
  (the click ask's rule, same 18-unit slop). Only parts visible at the
  paused boundary are askable. **The names are hidden while the drill
  runs** (labels, their leaders, a template's own `<part>_leader`) via a
  new `Player.dimElements(ids, alpha)` — the focus verb's primitive — and
  restored at the score and on close. Without that, "find the bridge" is a
  reading test.
- `partsFor(hd)` reads the mounted layout (browser text measure) once for
  the tray's decision and once when the drill starts. A body figure gets
  its names from the anatomy atlas in the figure's language, so the drill
  works with the labels OFF — the "let me explore the body myself"
  example asks "Click: Spleen" over an unlabelled body.
- The ⊕ now also appears on a figure whose only capability is this drill.

**`explore: body | space` on the manifest.** `SceneManifest.explore`,
validated in doc.ts (closed set `KNOWN_EXPLORES`, each requiring its
engine), declared in anatomy.yaml and space.yaml; tray.ts reads it
instead of comparing template ids. An authored "anatomy_dog" that uses
the anatomy engine can now carry the Body section.

## Verified

- 5300 vitest (18 new: parts-model, activitiesFor, explore validation),
  tsc clean.
- Browser smoke (Playwright, headless, the real app): violin example → ⊕
  → "🎯 Find the part" → "Click: Bow · 1/5", 10 name texts dimmed, a wrong
  click marks red and rings the target, next question, close restores
  every name. Anatomy example → Body section still mounts (from the flag)
  AND the drill asks "Click: Spleen" with no labels drawn. Solar system →
  Space section still mounts.

## Not done / follow-ups

- The drill asks in the label's language; the hint's fixed words ("Click:",
  the score) are English like the other drills.
- Templates that name labels some other way (`marker_label_<i>` on maps,
  columns keyed by finding id) contribute no parts; maps' countries would
  need scene names from the geo engine the way anatomy gets them from the
  atlas — same hook (`sceneNamesFor` in quiz.ts), one more engine.
- Freehand `node` texts are hidden only when the drawable tree marks the
  text leaf as owned by the node; a node whose text shares the node's own
  id stays visible during the drill (the question is still honest).
- No context-menu entry of its own: right-click opens the tray, where the
  pill is (spec §13's "two doors, one registry").

## Traps

- The control bar (and the ⊕) lives OUTSIDE `.cs-stage`; a smoke must not
  scope those selectors to the stage. The poster's big Play is a stage
  click, not a button with text.
- Playwright `locator.click()` on a hidden sidebar button waits 30 s per
  attempt; drive hidden example buttons with a DOM `click()` in evaluate.
