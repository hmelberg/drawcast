# "Do it all" — the remaining roadmap (2026-09-02)

Hans: "do it all." Everything still open on `ROADMAP-2026-09.md`, in
dependency order. Rulings taken where the docs left an open question are
marked ⚖ and collected in the ledger.

## 1. Part 4 — authoring loop (B7 + B8)

- **B7**: one button, state-determined (D3). The state is derived, not
  flagged: mode is "generate" iff the editor text is the blank document
  (or empty), else "revise" — so ＋ New says Generate, any loaded or
  hand-edited document says Revise, and the flip needs no bookkeeping.
  Placeholder carries the mode ("Describe a drawcast…" / "What should
  change?"). Viewing an old version keeps "Revise from here". Busy keeps
  Cancel. `reviseBtn` dies. Pure `authoringMode()` + test.
- **B8**: ⚖ already implemented — `initialDoc()` restores the newest
  library entry and falls back to a bundled example on first run, which
  is D4's recommendation verbatim. B7's Revise label makes the restored
  state honest (D4's tie-in). Record, don't build.

## 2. Part 5 — Style / Instructions (B5 + B6, spec S §3–§6, §8)

- Style profile `{id, name, text}` in localStorage (⚖ S §4.1 option 1 —
  "a paragraph; syncing it is a bigger machine than the thing it syncs").
- Compiler prompt gains `{{STYLE}}`, filled LAST so it wins; empty when
  no style is active. `buildSystemPrompt` takes the style text.
- Sidebar "Instructions" row becomes **Style**: list, New, Save, Delete,
  textarea — four controls (S §4's table). ⚖ S §9.3: stays its own
  sidebar row (two axes stay visible; no merged modal).
- The old prompt editor moves behind `developerMode` unchanged (B6).
- The `…` generation-choices row's "Instructions" becomes "Style".

## 3. B12 — cloud voice selection

Per-language preference through `voiceFor` (a voice belongs to a
language): durable default in Settings, quick pick in the player bar's
CC → Voice row (a pick speaks a sample line). The bake-reuse key gains
the voice, so a re-bake never mixes old-voice cached lines.

## 4. Part 6 — comments and share (C1 + C2 + C3, roadmap D5)

- **C1**: "Allow comments" checkbox in the Publish panel (beside the
  embed choices, where D5 put it) with the plain-words setup note
  (author's repo needs Discussions on + the giscus app — not
  automatable). The flag travels in the published yaml header; the
  viewer mounts giscus pointed at the AUTHOR's repo, keyed on the cast
  path. Hans hosts the page, owns none of the content.
- **C2**: ⚖ build nothing — giscus surfaces the Discussion's own
  reactions (D5's recommendation).
- **C3**: Share button on the viewer — Web Share API, copy-link
  fallback. Independent of C1.

## 5. C7 remainder — the bar reads YouTube (progress bar STAYS inline)

Left/right grouping (transport left; captions/speed/theater/fullscreen
right, the editor bars' `.bar-group` idea), hover preview on the seek
bar (which command you'd land on), ⚖ step indicator KEPT over a clock
(D6.4 — a drawcast is drawn steps, not tape; deciding it deliberately).

## 6. C4 — logo candidates

Generate the three S §7.4 directions as real SVGs + one preview page for
Hans to look at (decision needs an eye). No adoption until he picks.

## 7. Housekeeping

- ⚖ **B4: build nothing** — adopt review F.1(1): per-save folders are
  dropped, the single Settings folder stays, so the stable-index rework
  has nothing to precede. Hans can reverse.
- The parked course race (E): switching courses while a generation is
  in flight — disable the switch while `inFlight` is non-empty.
- Roadmap ticks, ledger, memory; full suite green per part; push at the
  end of each part.
