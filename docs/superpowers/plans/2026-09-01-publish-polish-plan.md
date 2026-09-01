# Publish Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the publish-polish rulings: YouTube panel rework (translate-on-publish, "Translate to" chips, grid layout, burn deletion, translated descriptions), Publish → Google Drive with the GitHub panel's options, and a `#gdrive=` viewer route.

**Architecture:** All decision logic stays in pure/testable seams; `main.ts`/`share.ts` UI is pinned by source-text drift tests. Everything runs in the background after the action click (modal closes; status line / export chip carry progress).

**Tech Stack:** TypeScript, Vite, vitest `environment: "node"` (no DOM), js-yaml, h() UI, Google Drive/YouTube/TTS APIs, Anthropic translate.

**Spec:** `docs/superpowers/specs/2026-09-01-publish-polish-design.md` (the ten rulings). Prior context: `specs/2026-09-01-publish-design.md`, ledger `plans/2026-09-01-tidyup-publish-ledger.md`.

## Global Constraints

- `npm test` + `npx tsc --noEmit` green at every commit. Baseline: 172 files / 2757 tests green.
- NEVER `h()` at module scope in `src/ui/*.ts` or `src/viewer.ts` module scope (tests/viewer.test.ts imports viewer.ts under node).
- `createModal` needs explicit attach; menus bake `hidden`; drift tests read source text via `readFile(new URL("../src/…", import.meta.url), "utf8")` with truthy-guarded extractions.
- No backwards compatibility (replace-or-delete; no migrations beyond `migrateShareTo`'s existing shape).
- User-facing copy: no "pin"/"bake" words; keep the one-verb-per-button rule.
- Existing drift tests that pin `share.ts`/`main.ts` wording: `tests/publish-embed.test.ts` (embed choices, publishTextFor shape, doc() derivation), `tests/share-destinations.test.ts` ("three panels" literal, offers), `tests/publish-name.test.ts`, `tests/shell-css.test.ts`. Update them in the same commit as the change they pin.
- Courses stay GitHub-only (`courses: false` on new destinations).
- Commits end with the two standard trailers (Co-Authored-By Claude + Claude-Session URL).
- Append judgment calls as dated bullets to `docs/superpowers/plans/2026-09-01-publish-polish-ledger.md` (create in Task 1).

---

### Task 1: `#gdrive=` viewer route

**Files:**
- Modify: `src/viewer.ts` (parseViewerHash 53-78, fetch ternary 129, loading label 116, error path; new `fetchGdriveText`), `src/entry.ts` (the `/[#&](gdoc|gh)[=-]/` dispatch regex — line ~7)
- Test: `tests/viewer.test.ts` (extend)
- Create: `docs/superpowers/plans/2026-09-01-publish-polish-ledger.md` (header line only)

**Interfaces:**
- `ViewerRequest` gains `driveId?: string`.
- New: `async function fetchGdriveText(fileId: string): Promise<string>` — GET `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${pickerKey()}`. `pickerKey()` from `../google/auth` is node-safe (zero imports, no module-scope DOM — verified). Empty key → throw `"This viewer build has no Google API key, so Drive files cannot be fetched."`. Non-OK → throw `` `Could not fetch the Drive file (HTTP ${res.status}). Make sure sharing is set to "Anyone with the link can view" (Share in Google Drive).` ``
- Parse: `/[#&]gdrive[=-]([A-Za-z0-9_-]{10,})/`, normalized `gdrive-`→`gdrive=` BEFORE the existing `gdoc-`/`gh-` replaces (order the `.replace` chain so `gdrive-` is rewritten first — the existing `/gh-/` replace would otherwise not collide but keep it explicit). Return `{ driveId, ...common }`.

- [ ] **Step 1: Failing tests** (extend `tests/viewer.test.ts`, same describe style):
```ts
test("accepts #gdrive=<id> and #gdrive-<id> with params", () => {
  expect(parseViewerHash("#gdrive=1AbC_dEf-123456789")).toMatchObject({ driveId: "1AbC_dEf-123456789", style: "clean", mode: "narrated" });
  expect(parseViewerHash("#gdrive-1AbC_dEf-123456789&style=sketchy")).toMatchObject({ driveId: "1AbC_dEf-123456789", style: "sketchy" });
});
test("a gdrive id never leaks into gdoc parsing", () => {
  expect(parseViewerHash("#gdrive=1AbC_dEf-123456789")!.docId).toBeUndefined();
});
```
Plus a drift assertion that `src/entry.ts`'s dispatch regex names `gdrive`.
- [ ] **Step 2:** RED. **Step 3: Implement** parse + fetch + the three integration points (loading label "Loading drawing from Google Drive…", fetch ternary `req.gh ? fetchGhText : req.driveId ? fetchGdriveText(req.driveId) : fetchGdocText(req.docId!)`, entry.ts regex). **Step 4:** GREEN + full suite + tsc. **Step 5:** Commit `feat: #gdrive viewer route for published Drive files`.

---

### Task 2: Publish → Google Drive destination

**Files:**
- Modify: `src/store.ts` (`ShareTo` line 45 + `migrateShareTo` 53; `SavedDrawing` gains `drivePublishedId?: string`), `src/google/drive.ts` (new `readFileText`), `src/ui/share.ts` (DESTS 100-104, offers rules, new drive panel; extract a shared embed-choices builder used by BOTH link and drive panels — no verbatim duplication), `src/main.ts` (`Doc` gains `drivePublishedId?: string`; `autosave`/`docFromSaved` carry it; new `publishDriveCast`; `openShare` deps gain `publishDrive`; `publishTextFor` gains a `previousText` parameter), `src/ui/course.ts` (ShareDeps widening — course passes a stub that errors or the field is optional; keep `courses: false` so it is unreachable)
- Test: `tests/share-destinations.test.ts` (drive offer rules), `tests/drive-publish.test.ts` (new), `tests/publish-embed.test.ts` (extend drift)

**Interfaces:**
- `ShareTo = "link" | "youtube" | "video" | "drive"`.
- DESTS row: `{ id: "drive", label: "Google Drive", action: "Publish", courses: false }` positioned after `link`. Offer rule: `google` is an ENV credential → hidden when `!caps.google`; when configured, always enabled (sign-in happens at publish, same as Save → Drive).
- Drive panel: one hint line — `"A finished file, not a link — share it from Drive with whoever should have it; they open it in drawcast, or the link below plays once link-sharing is on."` — plus the shared embed-choices rows and a name field prefilled `fileSafe(doc.title)` (or the previously published name), NOT slugified.
- `ShareDeps.publishDrive: (choices: { bake: boolean; embedImages: boolean; name?: string }) => Promise<void>`.
- `src/google/drive.ts`: `export async function readFileText(fileId: string): Promise<string | null>` — `requireScope(DRIVE_SCOPE)`; GET `files/${id}?alt=media` with bearer; ok → text, anything else → null (a missing previous copy just skips bake reuse).
- `publishTextFor(signal, bake, embedImages, previousText?: () => Promise<string | null>)` — the GitHub read (3526-3533) becomes the default `previousText`; the drive path passes `() => (doc.drivePublishedId ? readFileText(doc.drivePublishedId) : Promise.resolve(null))`.
- `publishDriveCast({ bake, embedImages, name })` in main.ts: guard `googleConfigured()` + non-empty playlist; `shareBtn.disabled`; `setStatus("Publishing to Google Drive…")`; `publishTextFor(...)`; `ensureFolder()` when creating (`doc.drivePublishedId ? null : await ensureFolder()`); `saveSpec(text, `${fileSafe(name ?? doc.title)}.yaml`, "text/yaml", doc.drivePublishedId ?? null, folder)`; on success `doc.drivePublishedId = res.fileId; autosave();` and `setStatusAction(`Published to Drive — ${settings.viewerBase.replace(/\/+$/, "")}/#gdrive=${res.fileId} plays once link-sharing is on.${lastEmbedNote}${lastBakeNote}`, "Open in Drive", () => window.open(`https://drive.google.com/file/d/${res.fileId}/view`, "_blank"), "ok")`.
- `drivePublishedId` persists (SavedDrawing + autosave + docFromSaved) — link permanence, same rule as `publishedAs`. It is DISTINCT from the in-memory `driveFileId` (Save's working-file id); a doc-comment must say so.

- [ ] **Step 1: Failing tests.** Offers: drive hidden when `google:false`, offered+enabled when `google:true`, absent for courses. `readFileText` drift (authed GET, null on non-OK). Drift: publishDriveCast exists, passes `previousText`, writes `text/yaml`, tracks `drivePublishedId`; the drive panel exists with a name field and the shared embed rows; ShareTo includes "drive". Round-trip: `migrateShareTo("drive") === "drive"`.
- [ ] **Step 2:** RED. **Step 3: Implement** per the interfaces. The shared embed-choices builder: extract the link panel's two `.publish-choice` rows into `buildEmbedChoices(): { rows: HTMLElement[]; refresh(doc: ShareDoc, settings: Settings): void; choices(): { bake: boolean; embedImages: boolean } }` inside `build()`, instantiated twice — behavior identical to today for the link panel (key-gated narration, count from `unembeddedImages(doc.playlist)` which is already editor-text-derived via deps.doc()).
- [ ] **Step 4:** GREEN + full suite + tsc (update `"three panels"` comment/test to four). **Step 5:** Commit `feat: publish to Google Drive with the GitHub panel's options (spec §7-8)`.

---

### Task 3: YouTube panel rework

**Files:**
- Modify: `src/ui/share.ts` (the whole YouTube region 353-640: grid, chips, deferred translation, ytSaveCopy, descriptions, copy trim, burn removal), `src/store.ts` (delete `burnCaptionsOnUpload` field + default), `src/styles.css` (`.yt-grid` rows; retire `.yt-langs`/`.yt-lang`; keep `.yt-warning` for the one-line caption note or replace with `.hint`), `src/llm/translate.ts` (new `translateText` helper for the description)
- Test: `tests/share-youtube.test.ts` (new drift+pure), `tests/caption-burn-defaults.test.ts` (update — it pins the deleted setting), `tests/publish-embed.test.ts` (only if wording collides)

**Interfaces & behavior (spec §2 rulings 1-6):**
- **Layout:** a `.yt-grid` two-column grid (label column `auto`, field `1fr` — house idiom styles.css:1553) with rows Title / Description / Publishes in / Translate to / Visibility. `.yt-field` stays full-width; all fields start at the same x.
- **"Publishes in {label}"** — plain text row computed in `prepPanels()` from `languageLabel(sourceLanguage(doc.playlist))`.
- **Chips:** a chips row + `<select class="yt-add-lang">` whose first option is `"＋ Add a language…"` and whose entries are `LANGUAGES` minus the source minus already-added. Selecting appends a removable chip (`× German`) and resets the select — NO translation happens. The source chip is first, visually distinct (`.yt-chip-source`, label `"Norwegian (original)"`), removable like the rest (covers the only-the-translation case); `prepPanels` resets chips to source-only. Keep a pure exported helper for the selection logic so it is node-testable: `export function ytQueue(source: string, chips: string[]): string[]` — dedupe, source first when present (replaces `ytSelected`'s core; the DOM reads/writes stay thin).
- **Cost line** (only when ≥1 non-source chip): `"N extra video(s) will be recorded in real time — roughly N × the drawcast's length — and each translation spends a little Anthropic and TTS budget."`
- **Copy trim:** the `yt-warning` paragraph becomes one line: `"The subtitle file downloads with each upload — attach it with one click afterwards, and YouTube auto-translates captions for viewers."` One more hint line under "Translate to": `"Each translation is a full extra video: drawn labels, narration and subtitles."`
- **Burn deletion:** `ytBurnCb` + label deleted; `renderVideo(exportSequence(playlist), false, of)` in the upload loop; `settings.burnCaptionsOnUpload` deleted from store.ts (field, default, everywhere — tsc finds survivors); `tests/caption-burn-defaults.test.ts` updated (the DOWNLOAD `burnCaptions` stays untouched). The `videoBurnCb` in the Video-file panel is NOT touched.
- **Translate-on-publish:** `runYoutubeUpload` phase 1, after consent+`modal.dialog.close()`+`beginExport`: for each queued non-source code missing from the cache, `setProgress(`Translating into ${label} — ${i} of ${n}…`)` then the existing per-spec `translateSpec` loop WITH `{ signal: controller.signal }` (5th arg — `CallOpts.signal` exists, share.ts just never passed it; one AbortController for the whole run, registered via `deps.setAbort`). A translation failure or abort: `deps.setStatus(...)`, `endExport`, return — nothing recorded. Cache `ytTranslations` keeps its semantics (per modal session). The checkbox change-handler translation (463-490) is deleted; chips only mutate the queue. `refreshYtButtons` no longer needs the "translated?" readiness — Upload is enabled whenever the queue is non-empty and a title exists (match current title behavior).
- **Description per language:** new `export async function translateText(text: string, target: { code: string; label: string }, cfg: TranslateConfig, opts: CallOpts = {}): Promise<string>` in `src/llm/translate.ts` — one `callForText`/`callForJson` call ("Translate this YouTube video description into {label}; return the translation only"); empty input → empty output without a call. Cache alongside the playlist: `ytTranslations` becomes `Map<string, { playlist: Playlist; description: string }>`. The upload loop uses the per-language description for translated uploads and `ytDesc.value` for the source.
- **ytSaveCopy on-demand:** its click handler first translates whatever queued languages are missing (progress via `ytStatus`, modal is open here so no export chip; reuse the same translate routine with a null signal or its own controller), then saves copies exactly as today. Enabled whenever ≥1 non-source chip exists.
- Factor the translate routine ONCE — `async function ensureTranslations(codes: string[], signal: AbortSignal | undefined, progress: (label: string, i: number, n: number) => void): Promise<boolean>` — used by both Upload and Save-copies. No verbatim duplication.

- [ ] **Step 1: Failing tests** — `tests/share-youtube.test.ts`: pure `ytQueue` cases (source first, dedupe, empty); drift: no `type: "checkbox"` inside the languages region / no `yt-langs` in share.ts; `translateSpec(` call carries `signal`; `burnCaptionsOnUpload` absent from store.ts and share.ts; the cost-line literal present; `translateText` exported; upload loop reads the per-language description. Truthy-guard every extraction.
- [ ] **Step 2:** RED. **Step 3: Implement.** **Step 4:** GREEN + full suite + tsc; update `tests/caption-burn-defaults.test.ts` and any publish-embed wording pins. **Step 5:** Commit `feat: translate-on-publish, Translate-to chips, grid layout; YouTube burn dies (spec §2)`.

---

### Task 4: Close the round

- [ ] Full `npm test` + `npx tsc --noEmit`, clean tree.
- [ ] Roadmap: add a short "2026-09-01 publish polish" note under §F.3 or the B table (delivered: translate-on-publish, chips, Drive publish, `#gdrive=`); note the Netlify-proxy fallback as NOT built (spec §3) and that Hans's live e2e of the `#gdrive` fetch is the outstanding verification.
- [ ] Finalize `plans/2026-09-01-publish-polish-ledger.md`; commit `docs: publish-polish round closed`; push; verify `git ls-remote`.

## Self-review notes

- Spec coverage: rulings 1-6 → Task 3; 7-8 → Task 2; 9 → Task 1; 10 is the standing pattern (asserted by keeping the modal-close-first handlers). Not built (§3) recorded in Task 4.
- Type consistency: `ShareTo` gains "drive" in Task 2 before Task 3 touches share.ts; `ytTranslations`' value type changes only in Task 3; `publishTextFor`'s new optional param defaults to the GitHub read so Task 2 compiles without touching the GitHub path's behavior.
- Order: viewer route first (no deps, and Task 2's status line cites the `#gdrive` link), Drive second, YouTube third (biggest), close-out last.
