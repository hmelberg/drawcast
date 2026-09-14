# Controls in the pane, and the movie rule

**Status:** addendum to `2026-09-14-code-controls-design.md`, agreed in chat
2026-09-14 (Hans + Claude), not yet built. Two things: the rule that settles
what the movie shows when a lesson invites interaction, and `pane: controls`
— the code panel drawing its controls instead of its source.

## 1. The problem

A lesson with controls wants two different things from its two modes. In
the app it should show the controls at once, stop, and tell the viewer they
can play. In the movie there is no one to play, so the invitation and the
live controls have no place — but the figure must still be complete. Hans
2026-09-14: "Maybe it is my fault for trying to be too flexible here and we
need some clear rules."

The rules exist already; they were just never written down against
controls. The interactivity principles say the movie is the player with the
response channel closed (§2), that the timeline never waits on a response
(§3), and that an `explore` beat is skipped wholesale by the export —
narration included (`src/export/video.ts:47`). Everything below routes
through that.

## 2. The movie rule (five lines)

1. **One storyboard.** Nothing is written twice for two modes, and no
   element sniffs the mode. What the movie shows is what the player shows
   when nobody answers.
2. **Drawables export; live controls never do.** A code pane, or a drawn
   control panel at its defaults, is part of the picture in both modes.
   The HTML controls are add-ons (principles §5) and exist only in the app.
3. **The invitation lives in the explore beat, nowhere else.** "Now slide
   the rate and watch the peak move" is the `speak` of
   `explore: {code: sim}`. In the app the lesson stops there with the
   controls live; in the movie the line and the pause vanish together. An
   ordinary `speak` never addresses the interactive viewer, because it
   would play in the movie too. The lint in §5 enforces this.
4. **Controls come alive at three doors, all in the app:** the explore beat
   (automatically, as the lesson reaches it), a paused click on the panel,
   and the ⊕ tray. Playing stays clean; pause is the door (§7). Controls
   never run a script mid-narration.
5. **Movie shows only the plot: `show: output`.** No pane; the controls
   live in the tray. That case needs nothing new. `pane: controls` (§3) is
   for the other case — the knobs are meant to be part of the picture, and
   the movie shows them drawn at their defaults.

"Render the controls right away, before any click" is rule 3 with the
explore beat placed right after the panel is drawn. "Only the plot in the
movie" is rule 5.

## 3. `pane: controls`

```yaml
- id: sim
  type: code
  show: left            # WHERE the pane sits — unchanged
  pane: controls        # WHAT the pane holds: code (default) | controls
  controls: [beta, gamma, days]
  code: |
    ...
```

`pane` is a new optional enum on the code element, `"code" | "controls"`,
default `"code"`. It is only meaningful when `show` names a pane side
(`left | right | above | below | code`); with `show: output` or `none` it
is a lint warning and ignored. `pane: controls` without `controls` (or with
an empty list) is a lint error.

### 3.1 What is drawn (both modes)

The pane keeps its rectangle and its width rule (55 % side by side, full
width stacked — `src/layout/code.ts:328`). Instead of source lines it draws
one **row per control**, in `controls` order, from the same
default-rewritten script the code pane already uses (so after a run the
panel is laid out from the rewritten text and the knob lands on the new
value by itself — the same mechanism that updates a code line today):

| Kind | Drawn as |
| --- | --- |
| slider | label · a track line · a small filled circle at `(value − min) / (max − min)` · the value, right-aligned in tabular numerals |
| choice | label · the options as a row of chips, the chosen one filled (the `pieces`/chip idiom) |
| toggle | label · a short pill with a knob at the left (off) or right (on) |
| text, number | label · the value in the mono font, in a light box |
| button | the caption in a pill (a drawn button; pressing it is the live twin's job) |

Row height is `fontSize * ROW_H`, the same rhythm as code lines; the panel's
content height is `rows × row height`, so a panel with three controls is
about three code lines tall. Ink and sketchiness follow the element's
`style` and `draw` like every other panel drawable. Ids: the panel is
`<id>` as today, each row is `<id>_ctl_<name>` (a group of its label, track,
knob and value), and the whole panel is also reachable as `<id>_ctls`.
There are no `<id>_line_N` ids in this mode; `marks` and `lines` are ignored
with a lint warning.

`ctx.panes[id]` is set to the pane rectangle exactly as for a code pane, so
the in-place mount (§3.2) and the editor card find it the same way.

### 3.2 What comes alive (app only)

While paused, a click on the panel — or the explore beat, or the tray's
group for this script — mounts the **tray's controls group over the drawn
panel**, the way `openInPlace` mounts the editor card over a code pane
(`src/ui/tray.ts:503`, `mountCodeEditor` with `paneBox: () => paneBoxOf(id)`).
It is the same group (`src/ui/tray.ts`, the controls-group builder): same
`controlValues`, same `runControls`, same `runEdited`, same `takenOver`,
same `clearPreview`. One state, two views — the tray still shows the group,
as the editor card and the tray's textarea share one draft today. The
overlay follows the pane on reflow (the editor card's `reposition`), stops
propagation to the stage, and is torn down with `clearPreview` and on
Continue like the editor card.

A `pane: controls` panel therefore has exactly the doors rule 4 lists; it
adds no fourth.

### 3.3 The explore beat

`explore: {code: sim}` on a `pane: controls` script opens the controls **in
place** (§3.2) and the tray, and holds the run for Continue ▶, as it does
today for a code pane (where it opens the editor). Its `speak` is the
invitation. The export skips the beat whole, unchanged.

### 3.4 Interaction with the rest of the round

- The one-click rule (spec §2.6) applies: during playback, a click on a
  `pane: controls` panel pauses and mounts the controls in place instead of
  opening the tray.
- `autorun: false` puts the group's Run ▶ into the overlay as well.
- `show: code` (code only, no output pane) with `pane: controls` draws only
  the control panel — a bare knob board. Allowed; probably rare.
- The drawn panel is a picture: it never runs anything. Every run still
  goes through the group's rows.

## 4. What the model sees

`schema.ts`: `pane` in one sentence — "code: what the pane holds — code (the
default: the script's lines) or controls (the script's `controls` drawn as
knobs and switches, live while paused; the movie shows them at their
defaults). Use with show: left/right/above/below." The controls bullet in
`compiler-v1-code.md` gains two sentences: the `pane: controls` form ("when
the viewer should see the knobs, not the code"), and the movie rule: "Any
line that tells the viewer to slide, press or try something belongs in an
`explore` beat's `speak` — the movie skips that beat whole, so an ordinary
speak must never invite interaction." Prompt-size pins re-pinned in the
same round.

## 5. The lint: `explore-invite`

A **warning** (`rule: "explore-invite"`) on an ordinary `speak` — any
command that is not an `explore` — whose text matches the invitation
pattern. The pattern is a small word list, case-insensitive, matched as
whole words at the start of a clause or after "now"/"try": `slide`, `drag`,
`press`, `click`, `toggle`, `move the slider`, `try it`, `try (a|some)`,
`turn the (knob|dial)`, `set the … to`, and the Norwegian `dra`, `trykk`,
`klikk`, `prøv`, `skyv`. Message:
`commands[i].speak invites the viewer to interact ("slide…") — the movie
will say it too; put the invitation in an explore beat's speak`.

It is a warning, not an error: a narrated "try to guess" is legitimate, and
the repair round should not spend a turn on prose. It is a ratchet for the
bundled examples: `tests/examples-style.test.ts` pins the count at what the
file measures today (expected 0 after this round — the six control examples
already put their invitations in explore beats) and a new example may not
raise it.

## 6. Testing and evidence

- `tests/code-pane-controls.test.ts` (layout, pure): a `pane: controls`
  element mints `<id>_ctl_<name>` for every control and no `_line_N`; the
  slider knob's x is at the default's fraction of the track; a choice row
  fills the default chip; the panel height is rows × row height; after
  `withControlDefaults`-style rewrite to another value the knob moves;
  `ctx.panes[id]` equals the pane rectangle.
- `tests/code-controls-lint.test.ts` (extend): `pane` with `show: output` →
  warn; `pane: controls` without controls → error; `lines`/`marks` with
  `pane: controls` → warn.
- `tests/explore-invite-lint.test.ts`: each word in the list trips on a
  plain `speak` and not on an explore `speak`; "try to guess" does not trip;
  Norwegian words trip.
- `tests/tray-controls.test.ts` (pins): the in-place mount reuses the
  controls-group builder (one builder, two hosts) and is registered for
  `clearPreview`.
- `tests/examples.test.ts` gate on the switched examples; the style ratchet
  for `explore-invite` at 0.
- Smoke (Hans): SIR with `pane: controls` — the knobs are drawn in the left
  pane; the explore beat stops with the overlay live; a slider moves the
  drawn knob after the re-run; Continue restores; the movie shows the
  drawn panel at defaults and skips the invitation.

## 7. Out of scope

- Drawn controls outside a code element (a slider as a free element) — the
  earlier decision stands; the panel is the only home.
- A movie form that performs a control sweep (the `animate` pairing) — the
  panel is static in the movie.
- Persistence, as before.

## 8. Bundled examples

Switch **SIR** and the **Markov cohort** to `pane: controls` (their
narration already talks about "knobs"); keep the law of large numbers, the
bootstrap, the CE plane and discounting showing code, so both forms are in
the corpus. Re-count nothing: the switched examples' `draw` beats change
from `_line_N` to `_ctl_<name>` ids and their narration is rewritten to name
the knobs.

## 9. Build order

1. Schema/types (`pane`), lint rules (§3, §5), prompt sentences, pins.
2. Layout: the drawn panel (`src/layout/code.ts`, a `controlsPane()` helper
   in its own file `src/layout/code-controls-pane.ts`), tests.
3. Tray: the in-place mount (`mountControlsCard` beside `mountCodeEditor`,
   sharing the group builder), one-click and explore wiring, pins.
4. Examples switched, help row, ROADMAP, smoke list, tsc, push.
