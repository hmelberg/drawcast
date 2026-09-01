# Design: publish polish — YouTube panel, translate-on-publish, Publish → Drive, #gdrive viewer route

*2026-09-01, late. Rulings taken in conversation with Hans; this records them.
Implemented by `plans/2026-09-01-publish-polish-plan.md`.*

## 1. What the YouTube languages ARE (stated once, plainly)

Each selected language is a **complete translation of everything** — drawn
labels, narration, subtitles — uploaded as its **own separate video**, recorded
in real time with that language's TTS voice. Subtitle-only translation for
viewers is already free via YouTube's CC auto-translate once the caption track
is attached. The panel's copy now says this in one line instead of implying it.

## 2. Rulings

1. **Translation moves to the Upload click.** Selecting a language costs
   nothing; on Upload, phase 1 translates every selected language first
   (seconds each, cancellable, progress via the export chip), and only when all
   translations are clean does recording start. The fail-fast property of the
   old translate-on-tick survives by ordering, and the API spend now happens on
   an explicit verb. The translation cache is **per modal open** (amended
   2026-09-02 during review): within one open nothing is paid twice —
   Save-copies then Upload reuses, and a multi-language run skips what is
   cached — but reopening the modal clears it, because the modal re-reads the
   editor text on every open and a cached translation of an edited document
   must never be uploadable. Cross-open re-translation is the price of that
   correctness.
2. **"Translate to", with the original as a given.** The panel states
   "Publishes in Norwegian" (auto-detected via `sourceLanguage`) as a fact, and
   offers "Translate to: [+ Add a language ▾]" building removable chips. The
   original is uploaded by default (its chip is removable for the
   only-the-translation case). Nineteen checkboxes die.
3. **Cost/time line, dynamic.** Shown only when ≥1 translation is selected:
   time is the headline (each language re-records the whole video in real
   time), budget is secondary. The static warning paragraph shrinks to one
   caption line.
4. **The YouTube burn checkbox dies** (setting `burnCaptionsOnUpload` and
   plumbing too). CC covers it; the escape hatch for muted-autoplay feeds is
   exporting a Video file with burn on (that checkbox stays — a downloaded
   file has no subtitle layer).
5. **The description is translated per language** — today it uploads the
   source-language description under every translated video.
6. **"Save the translations as new drawcasts" becomes its own on-demand
   verb**: clicking it translates whatever is missing, then saves. Two verbs
   (Upload, Save copies), each paying its own way, sharing the cache.
7. **Publish → Google Drive**: same panel shape as GitHub — Embed images,
   Embed narration, editable name (filename rules via `fileSafe`, not a slug)
   — writing the prepared copy as a **plain `.yaml` file** (never a Google
   Doc: Docs cap at ~1M characters, which self-contained publishes exceed,
   and Docs curl quotes) into the app's `drawcast` folder. Republish updates
   the same file id (`drivePublishedId`, persisted like `publishedAs`).
   Narration-bake reuses lines from the previous published Drive copy,
   mirroring the GitHub reuse.
8. **Sharing stays manual, in Drive** — the app never touches permissions.
   The post-publish status offers "Open in Drive" so flipping sharing is one
   click, and shows the playable link.
9. **New viewer route `#gdrive=<fileId>`** (`-` variant accepted), fetched via
   the Drive API public-file read with the app's existing picker key. Its
   error message coaches "Anyone with the link can view", word-for-word in
   the spirit of `#gdoc`'s. `#gdoc` stays exactly what it is — the
   hand-authoring transport. Courses stay GitHub-only.
10. **Everything stays background**: action buttons close the modal at the
    click; progress lives in the status line / export chip with Cancel.

## 3. Deliberately not built

- Drive permission automation (the user shares from Drive's own UI).
- Publishing into Google Docs (size cap, quote-curling).
- A netlify proxy for the Drive fetch — only if the API-key route fails
  Hans's live e2e (fallback documented, not built).
