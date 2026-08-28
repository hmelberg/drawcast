# Interactivity principles

Status: agreed principles, Hans + Claude, 2026-08-27. This is not an
implementation plan. It is the document every future interactive-feature
round (`ask`, sliders, `on_click`, `label`/`goto`, widgets, links) designs
against, so the "but what about the movie?" question is answered once,
here, instead of being reopened per feature.

## 1. The problem this solves

Many features that teach well require a person at the controls: a question
that makes the reader reflect, a slider that lets them feel how a slope
changes a curve, a link that opens the source, a keyboard they can play.
drawcast, however, has promised from the start that a drawcast is also a
*movie*. Left unmanaged, every interactive idea acquires an "export
problem", the adaptation tax grows with each feature, and eventually the
tax wins and good teaching ideas stop being built. These principles keep
the tax at zero for most features and small and explicit for the rest.

## 2. Two modes

- **Movie mode** — the exported WebM. There is no response channel, ever.
- **Player mode** — pressing play in the app (or wherever the engine is
  embedded). A response channel exists; the viewer may or may not use it.

The load-bearing observation: **movie mode is player mode with the
response channel closed.** If player mode behaves correctly when the
viewer never responds, the export needs no special cases — it simply
records that performance. Solve the app; the movie falls out.

## 3. The one rule

> **The timeline never waits on a response.** Untouched, every spec plays
> end-to-end down its default path. That performance is what movie mode
> records and what a lean-back player-mode viewer sees.

One sanctioned exception: an element marked `required: true` gates
**player mode only** (the timeline pauses until answered). Movie mode
always auto-resolves it into the element's movie form. Precedent:
`wait: click` already works exactly like this — a required gate live, a
short pause in the export.

Consequence: branching exists (see redirections), but it is always
viewer-initiated, never viewer-required. Absence of interaction is always
a valid, complete performance.

## 4. Three interaction kinds

1. **Excursion** — pause → explore → return; the paused frame is restored
   exactly. Examples: parameter sliders, the info/wiki/PDF panel, and the
   already-shipped ⬡ 3D molecule viewer (the pattern existed before it had
   a name). Rides on the pause machinery plus (for sliders) `animate`'s
   ability to re-run layout from arbitrary param values.
2. **Redirection** — a viewer action moves the playhead (an answer, a
   clicked link, a chosen topic); pressing play continues **from the new
   point**, not from the jump's origin — that is the whole point of a
   jump. Rides on per-boundary scene state: a redirection is a scrub the
   content initiates instead of the seek bar. This is the substrate for
   `label`/`goto` and, later, branching asks.
3. **Exercise** — an `ask` poses a task and evaluates a response. The
   response device is either the built-in choice list or a widget (see
   §8): a played note, a moved chess piece, a clicked country. Feedback,
   `required`, and (later) `goto` on wrong answers sit on `ask`
   identically whatever the device.

## 5. Two element classes

- **Add-ons** live only in player mode and are **ignored by movie export
  entirely**: the 3D viewer, sliders, links, click-to-jump, free-play
  widgets. They need no movie form — which is what makes them cheap, and
  most future teaching features should be add-ons.
- **Adaptable elements** live on the timeline itself and therefore carry a
  **declared movie form**: today `wait` (auto-resolve to a beat), next
  `ask` (demonstrate: pose the question, hold a beat, reveal the answer —
  rhetorical-question form, which still triggers the reflection that is
  the element's purpose). This class should stay small.

Movie adaptation strategies, in order of preference:

| Strategy | Meaning | Example |
| --- | --- | --- |
| omit | not part of the timeline; simply absent | links, 3D, free play |
| auto-resolve | default outcome, short beat | `wait: click` |
| demonstrate | the movie performs the interaction | ask (pose–beat–reveal); slider → `animate` sweep; exercise → correct action shown, with sound (export already mixes WebAudio, so a widget's audio can be performed into the recording) |
| pick-a-path | branching content exports its default path | future `goto` branches |

Note the slider/`animate` pairing: a slider is the live form of a
parameter sweep, `animate` is its performed form. Interactive elements
should be conceived as such pairs from the start, not as features with an
export problem discovered later.

## 6. Intrinsic capabilities and bound interactions

Interactivity has two layers, and the split is the keystone of the design:

**Intrinsic capabilities** are owned by the template and exist
automatically — nothing is declared in the spec and the LLM is not
involved. Draw a keyboard and it is playable; draw a map and it can quiz;
draw anything with numeric params that `animate` can drive and those
params are sliders (every such template gets its explore-sliders for
free). This mirrors the template system's founding move: the knowledge an
interaction needs (key positions and pitches, country geometry, legal
moves) already lives in the template — capability follows the element.
Intrinsic exercises are **generators**, not fixed questions: the template
owns its data space, so "ask me a random country", "random note in octave
4" produce endless fresh instances.

Mechanics: the template manifest names what it offers in an
`interactions:` section (sibling of `engines:`), so the tray, the ⊕
indicator, and ask-binding read one declared source instead of sniffing.
A spec-level (or per-element) `interactions: false` switches it off for
the drawcast where the keyboard is merely an illustration.

Why this matters practically: if interactivity had to be written into the
spec, we would pay for it in schema surface, prompt rules, repair cases,
and catalog tokens — and the model would forget half the time. Intrinsic
capability costs the prompt nothing; the model draws a keyboard exactly as
it does today.

**Bound interactions** are the spec layer, used only when the storyboard
intends a specific exercise at a specific moment: an `ask` element
**references** an element's intrinsic capability rather than defining a
widget — ask → keyboard, expect note C4, feedback lines, optionally
`required: true`. Declaration-free by default, declarable when the lesson
demands it.

## 7. The UI model: pause is the door

Lean-back and lean-forward are already distinguished by one signal —
whether it is playing. That same signal drives the whole UI:

1. **Playing = clean.** The chrome-free player stays chrome-free: no
   markers, no handles, no underlines. Movie-mode people never pay for
   interactivity.
2. **Pause reveals.** On pause, interactive elements get a quiet sketchy
   marker (the existing effects/glow layer, reused), and the control bar
   shows a small ⊕-style indicator whenever the current scene has
   interactions. Clicking the indicator opens the full menu of the scene's
   interactions — including those with no natural click target (external
   resources, scene-level sliders). Three discovery routes, one
   destination: spatial (click the marked element), explicit (the
   indicator), accidental (pause and notice).
3. **Click always pauses first.** The first click is today's sacred
   gesture — pause — and never opens anything. Once paused, a click on a
   marked element opens its interaction; a click on nothing resumes
   (today's toggle). Two clicks to enter an interaction; zero accidental
   modals mid-narration; no invisible hit-map to guess at.
4. **Two surfaces, split by attention.** Controls you use *while watching
   the figure* (sliders, toggles, a playable keyboard — wide and short,
   exactly the shape of the strip) live in a **tray that slides open under
   the control bar**: the figure stays fully visible, the tray can stay
   open across scenes showing the current scene's controls, and on mobile
   it is the native bottom-sheet pattern. In theater mode the same
   component may dock as a right rail. Content you read *instead of* the
   figure (wiki, PDF, YouTube, books) opens as a modal or new tab.
   Widgets declare their preferred surface (a chessboard is square and
   prefers a modal/rail; a keyboard prefers the tray).
5. **Resume is explicit.** An excursion ends with a deliberate
   "continue ▶", not automatically on close.

## 8. Widgets

Rich interaction components — a playable keyboard, a movable chessboard, a
country-quiz map — are **widgets** in an engines-style lazy registry:
loaded on first use, cached for the session, never in the movie path. A
widget has an input surface, output (including audio — simple tones need
only WebAudio oscillators, no dependency), and an evaluation hook `ask`
can bind to. The widget API is **deliberately not designed yet**; the
first real widget gets built when a concrete lesson needs it, against
these principles.

## 9. Intrinsic capability catalog (initial, non-binding)

Exercise archetypes, most general first:

- **identify** — "click the ___". Universal: any template with named parts
  can generate it (the template knows its element ids and labels). Cell
  organelles, map countries, circuit parts, curve names.
- **quantify** — read a value off the figure: "what is the probability at
  this node?", "where is the new equilibrium price?" (numeric or
  click-the-point answer).
- **manipulate** — sliders and toggles from animate-able params (free
  across every template that has them); "re-run" on stochastic templates
  (galton board, CI dance — a fresh random instance is a natural
  generative demonstration).
- **perform** — widget exercises: play this note (keyboard), find the best
  move (chess — move validation already shipped in the engine), place this
  event (timeline).
- **more info: the info card** — the "learn more about this" family
  (authored links, search, tooltips, LLM explanations, spawned drawcasts)
  is one UI object, not five features: clicking a marked element while
  paused opens a small **info card** — the element's name, a one-line
  summary when one is available, and up to four actions, each shippable
  independently and shown only when available:

  1. **Read more** — an authored `link:` on the element, kind-aware
     because generic URL-in-a-modal does not work (most sites, Wikipedia
     included, forbid framing via X-Frame-Options/CSP): `wiki:` renders an
     in-card summary from Wikipedia's CORS-open REST summary API with a
     read-more that opens a new tab; `youtube:` uses the embed player in a
     modal; `pdf:` frames the document; a bare `url:` always opens a new
     tab. A portrait linking to its person is the canonical case.
  2. **Search** — the zero-authoring fallback. This works for more than
     text: templates name their parts, so a drawn curve knows it is
     "demand curve" even though the visible thing is a line — every named
     element has a search query for free (intrinsic identity, same
     principle as §6). Opens a new tab.
  3. **Explain** — the premium fallback: an LLM call whose prompt includes
     the current spec and narration, so "explain marginal cost *here*"
     beats any search. Uses the key that is already present for
     generation; answer renders in the card. Build after ask, not before.
  4. **Draw it** — the flagship, later: generate a *new drawcast about the
     clicked concept*. Nearly everything it needs is shipped (generation,
     playlist chaining, `zoom_from` semantic zoom as the transition into
     the clicked element's concept); it costs a full generation
     (10–20 s, tokens), so it is an explicit button on the card, never
     automatic. Design its excursion-vs-extend-the-playlist semantics when
     it gets built.

  The card itself doubles as the tooltip: name + summary is the hover/tap
  preview (paused only — playing stays clean), the actions are the
  commitment step, which also solves link disambiguation (the viewer sees
  where a link goes before choosing it). Headings/titles → Wikipedia
  topic pages stays **deferred** (term → article disambiguation is
  unreliable), and word-level links inside narration/captions stay parked
  (per-word hit areas in SVG text, little gain over element-level links)
  — though the info card is where both would land if revived.

## 10. What this rides on (already shipped)

Pause/resume and the timeline's pause discipline; exact per-boundary scene
state (scrubbing = the redirection substrate); `animate`'s
re-layout-from-params (= sliders); the effects/glow layer (= pause
markers); the control bar's per-scene hook pattern (the ⬡ 3D button is the
add-on precedent); the engines lazy registry (= the widget registry
pattern); the export's WebAudio mix (= demonstrate forms can sound).
Movie export itself needs no changes for add-ons — only adaptable
elements ever touch it.

## 11. Open questions (deliberately not answered here)

- **Answer logging**: where do a self-paced student's answers go? The app
  is serverless; candidates are a local summary ("4/6") at the end, or
  nothing, or a future share-back channel. Decide when `ask` ships.
- **Branching exports**: is "one video per path" ever worth it, or is the
  default path always enough? Wait for a real branching lesson.
- **Embedded engine (xplainer)**: which interactive layers does the
  vendored engine expose? Per-host decision; the engine build already has
  the exclusion seams.
- **Lesson strictness defaults**: `required` rides on elements; whether a
  playback mode/URL param should flip defaults (all asks required) can
  wait for classroom evidence.

## 12. Suggested build order (non-binding)

1. **Pause-reveal + indicator + tray with auto param sliders** — pure
   intrinsic layer, no schema or prompt changes, immediately useful on
   dozens of templates.
2. **`ask` v1** — choice-list device, demonstrate movie form,
   `required: true`, feedback lines. No branching.
3. **Links** — portrait → wiki, element-level resource links (modal/new
   tab).
4. **`label`/`goto`** — the redirection substrate (also unlocks chapter
   ticks on the seek bar from the roadmap).
5. **First widget** — keyboard or chess exercise, built for a concrete
   lesson, which is when the widget API gets designed.

## 13. Amendments (agreed Hans + Claude, 2026-08-28)

These refine §7's UI model after the chess-indicator round; where they
conflict with §7 as written, the amendment wins.

**The gesture pair.** *Left-click does; right-click asks what's
possible.* Left-click keeps today's meanings unchanged: pause/resume on
the stage, the natural action on an interactive object (a piano key
sounds, a chess piece moves), and — once the info card exists — the card
on an inert marked element, because "tell me about yourself" *is* an
inert object's natural action. Right-click (and, in a later round,
long-press on touch) opens the interaction menu for whatever is under
the pointer: an object → its card/menu at the pointer; the background →
the scene surface (the tray). Right-click during playback pauses at the
step boundary first, then opens — one gesture from movie into
interaction. The browser's native context menu is suppressed inside the
stage only. Left-click never opens controls or menus on active objects;
that collision rule is settled.

**Two scopes, no selection.** Element scope is addressed by *pointing*
(the right-click target); scene scope by the ⊕ or a background
right-click. There is no "selected object" state in the player, ever —
selection would duplicate what pointing already does and make the ⊕'s
meaning depend on invisible state.

**The ⊕ stays, static and frozen.** The indicator remains in the control
bar as (a) the guaranteed touch path, (b) the anchor of the persistent
controls surface (the tray — menus are transient, sliders are not), and
(c) first-session discoverability, per the accelerator rule: a context
menu is never the only route to a command. It carries no per-scene
state, no color changes. For now it keeps exactly its shipped role —
controls/explore door — and does not grow.

**Scheduled convergence.** The ⊕/tray and the context menu are two views
of ONE interactions registry (the manifest's `interactions:` section,
§6); they can never drift because neither owns content. When the first
*named activity* ships (quiz, play-vs-computer), its launcher appears in
both: as a context-menu entry and as a pill row atop the tray. Until
then no pills are built — the dashboard solves a problem that does not
exist yet.

**Markers are the enumeration.** The scene surface never lists the
scene's objects textually; the pause-reveal markers show them in place,
and pointing goes element-scope. Marker rule: markers go on *objects*,
not element ids — an element with an info payload (name/summary/link) or
a bound interaction gets one; a chessboard is one marked object, its 64
squares are hit geometry.

**Free play is an excursion.** Intrinsic free play (moving the chess
pieces, playing the keyboard) previews over the paused frame and is
discarded on Continue ▶ — the storyboard's honest position is restored
exactly, per §4.1. Chess free-move rides the param machinery: the
position is `fen`/`moves`/`plies_shown`, so a user move is a param
preview, with legality from the already-shipped chess engine.

**Authored links (agreed 2026-08-28, second session).** The §9.5 "Read
more" action becomes a spec-level `link` field on any element — content,
not capability, so it lives in the drawcast spec, never the template
manifests. Canonical form is an array of full https URLs (max 4; a bare
string normalizes to a one-element array — the schema stays anyOf-free
for structured outputs). The kind is SNIFFED from the URL, never
declared: YouTube hosts → embed player in a modal over the stage;
`*.wikipedia.org/wiki/…` → the in-card summary portraits already use;
`.pdf` paths (and arxiv.org/pdf) → framed document in a modal with a
permanent "Open in new tab ↗" escape (X-Frame-Options blocks are
undetectable from JS, so the escape always shows); anything else → new
tab. Multiple links are cheap because the card is already a multi-action
surface: one action per link, same-kind duplicates disambiguated by
hostname. The card stays the intermediary — clicking a linked object
never navigates directly (preview before commitment); a `link` is an
info payload, so it makes its element card-bearing, and a label's link
propagates to its attach_to target like its name does. THE AUTHORING
RULE THAT MATTERS: links are pass-through only — the model includes a
`link` ONLY when the request itself supplies the URL, copied verbatim,
never constructed — hallucinated DOIs and dead video ids look exactly
like real ones. Links are add-ons (§5): ignored by movie export
entirely. Labeled link objects ({url, label}) stay unbuilt until
hostname disambiguation proves too crude.

**Amended near-term build order:** (1) `interactions:` manifest section
+ ⊕ lights for chess; (2) free-move chess while paused; (3) right-click
v1 (suppress native menu on stage; pause + open the tray); (4) identify
quiz generator; (5) info card v1 (name + search, then wiki summaries);
(6) play vs computer with a small built-in engine (chess.js legal moves
+ shallow material search — beginner strength is right for a teaching
app; Stockfish WASM only if strength is ever actually wanted); long-press
touch analog as its own later round.
