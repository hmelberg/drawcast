# The title lives below the player — design (2026-09-16)

Hans, 2026-09-16: "drawcast has a title field on top, but also often a title
below that, and sometimes a title in the middle that zooms in a little with an
underline and then disappears. Given that we want it to be a bit like YouTube,
maybe it is best not to have the fixed title field above the whole
presentation." Approved as recommended, same day.

## What was there

Three mechanisms overlapped:

1. `spec.title` — rendered as an HTML band above the stage inside the frame
   (app player, fullscreen, the video export's fixed 30 px band), unless the
   drawing drew the exact same text (`render/title.ts`, C9). The published
   watch page already hid the band and put the title in an h1 under the frame.
2. Drawn titles — 14 examples draw a matching text element; 77 template
   examples set `params.title`, and in 29 of those it differs from
   `spec.title`, so the frame showed two titles.
3. Cards — the playlist title page (title over an underline, camera push-in,
   clear) and chapter cards. Playlists only.

## Decisions

1. **`spec.title` is metadata.** It names the document, the h1 under the
   player, the browser tab, the file name, the playlist row. It is never
   painted inside the frame. `render/title.ts`, the `.cs-title` band and the
   exact-match rule are deleted.
2. **The app player gets the watch page's row.** One builder
   (`ui/player-meta.ts`) makes the row under the frame for the app and the
   viewer, so the two cannot drift again. Fullscreen shows no title.
3. **Headings on the canvas are the cast's choice, in two styles.** A
   permanent heading is an ordinary text element drawn on the first beat. The
   disappearing style is a new `card` command — `{"card": {"title": "…",
   "subtitle": "…"}, "speak": "…"}` — expanded before layout into the same
   elements and beats the playlist title page uses (title over an underline,
   slow push-in, un-sketch, camera reset). Being a beat, it plays identically
   live and in export.
4. **Export opens with a card instead of a band.** The video frame gives the
   whole height to the figure and captions. A single-cast export prepends the
   title card by default (Share → Video checkbox "Open with a title card",
   also honoured by the YouTube upload), skipped when the cast already opens
   with its own `card`. Playlists keep their title page as before.
5. **Prompt sync in the same round.** The opening rule says the title is shown
   under the player as page furniture and the canvas carries a heading only if
   the cast draws one; `card` joins the verb catalogue and the schema; the
   prompt-size pins are re-measured.
6. **Examples need no structural change.**

## Not done, on purpose

- No title in the fullscreen control bar (YouTube accepts the same trade).
- No content pass over the older freehand examples to add drawn headings.
