# Design: Published audio — bake the narration once, serve it to everyone

*2026-08-31. Decisions made in brainstorming with Hans, after auditing what the
app already does (§0). Source language only; the recording booth is §11.*

## Goals

1. **Synthesize each narration line once, not once per viewer.** An author with
   a Google TTS key bakes the audio at publish time; everyone who opens the
   published drawcast hears it, needing no key, no password and no quota.
2. **Optional, at publish time, for a single drawcast and for a course alike.**
   One checkbox. A drawcast published without it behaves exactly as today.
3. **Stale audio can never play.** A line that has been edited since the bake
   falls back to live speech rather than speaking the old wording.
4. **Speed still works.** 0.5×–2× must not turn the narrator into a chipmunk.
5. **The viewer stays key-free and script-free.** No new third-party code, no
   credentials, nothing to configure.
6. **A short drawcast can be one self-contained file.** The audio rides inside
   the published document as base64 — one request instead of forty, and no new
   publishing machinery. This is what ships first (§15, §16); separate audio
   files follow when a course needs them.

## Non-goals

- **Recorded human speech.** §11 reserves the seam; the format is built so the
  booth changes only who produces the bytes. Not in this work.
- **Baking every subtitle language.** The CC track and the voice are separate
  choices; this bakes the drawcast's own language only. §10 says what changes
  when a second language is added, so nothing here forecloses it.
- **Audio for the title page and chapter cards.** They are synthesized specs
  with one generated line each ("Next chapter: X"). They fall back to live
  speech like anything unbaked. Revisit only if the fallback proves audible.
- **Serving audio from anywhere but a public repo.** §9 covers Google Docs.
- **A private-repo path.** Published audio is fetched from
  `raw.githubusercontent.com`, which does not serve private repositories —
  the same constraint `preflight` already enforces for the YAML.

## 0. What already exists — verified, not assumed

Most of this is a promotion of machinery that is already here. Every claim
below was read out of the source, not remembered.

- **The player already waits for the voice.** `runStep` and `runAction` in
  `render/player.ts` `await this.speech.speak(...)`; the drawing's timing is
  *derived from* the narration's duration. Fixed-length audio is therefore more
  predictable than TTS, not less. **There is no timing engine to write.**
- **A pre-synthesized speech manager already exists.** `BufferSpeech`
  (`export/tts.ts:295`) is a `SpeechManager` whose `speak()` plays a buffer from
  a `Map<string, AudioBuffer>` keyed by `speechKey(line)` and resolves when it
  ends. The video exporter uses it. Published audio is the same class with a
  different source for the bytes.
- **The key already exists.** `speechKey(line)` is
  `` `${gender}|${speaker}|${delivery}|${text}` `` (`render/delivery.ts:29`).
  It already distinguishes the same sentence spoken in two voices, and it is
  already what `synthesizeAll` and `BufferSpeech` agree on.
- **The fallback chain already exists.** `CloudSpeech.speak` calls
  `super.speak` — the browser's `speechSynthesis` — whenever no key is set or a
  cloud call fails. Adding a layer above it is additive.
- **Prefetch already exists.** `CloudSpeech.prefetch(lines, speed)` warms lines
  ahead of playback, and `playlistSpeakLines(playlist)` (`playlist/session.ts`)
  already enumerates every line a playlist can speak, derived from
  `exportSequence` so live playback and export cannot disagree.
- **Publishing is one atomic commit.** `commitFiles` (`publish/github.ts:252`)
  reads the branch ref and tree, posts a new tree, posts a commit, moves the
  ref — five calls regardless of file count, with a 422 retry for a concurrent
  push.
- **The bytes are already in hand at synthesis time.** `synthesizeOne`
  (`export/tts.ts:98`) receives base64 MP3 as `audioContent` and immediately
  spends it on `decodeAudioData`. Baking needs that string kept, not fetched
  again.

### What does NOT already work

- **`commitFiles` cannot carry binary.** The tree is posted with
  `content: f.content` as UTF-8 strings. GitHub's tree API takes either
  `content` (a string) or `sha` (a blob created separately). MP3 must go
  through `POST /git/blobs` with `encoding: "base64"` first. **This is the one
  real change to the publish path — and it is needed only by SIDECAR
  delivery (§1). Inline (§15) commits the audio as part of the document, which
  is a UTF-8 string `commitFiles` already handles, so stage 1 (§16) does not
  touch this at all.**
- **`parseManifest` deletes everything it does not know.** It rebuilds
  `{ courses }` and drops every other key (`publish/github.ts:178`), so an
  `audio` index stored in `courses.json` would be silently erased by the next
  course publish. §5. Worth fixing on its own merits, but a prerequisite only
  for sidecar — inline stores no index.
- **Changing speed re-synthesizes.** `CloudSpeech` caches by
  `` `${rate}|${speechKey}` `` and passes `speakingRate` to the API, so every
  speed is a different render. Baked audio has one render. §7.
- **Publishing is per-course only.** There is no publish path for a single
  drawcast (`ui/course.ts:98` is the only entry point). Audio for an individual
  drawcast therefore depends on that path existing — see §12.

## 1. The format

One lookup, two ways of delivering the bytes to it:

- **Inline** (§15) — the audio rides inside the published document as base64.
  One file, one request, no new publishing machinery. **This ships first**; see
  §16 for why the order was flipped.
- **Sidecar** — the audio sits in separate files beside the document, described
  in this section. It earns its extra machinery on courses, not on a single
  short drawcast.

What both share is §3's lookup, and it is the part that actually matters:
**a clip is found by the sentence it speaks, never by its position.** A
drawcast is not a linear tape — a wrong quiz answer can `goto` back and replay
lines, `ask` with `retry` repeats until the viewer is right, a right answer can
skip ahead, and `skipQuestions` drops whole steps. The seventh clip is not
reliably the seventh thing said, so an ordered list of clips would desync the
moment anyone answered a question wrong. `speechKey` already keys exactly this
way (§0), and keying by sentence is also where the staleness guarantee (goal 3)
comes from for free.

```
casts/did/did.yaml          the drawcast
audio/en/index.json         key → { file, ms }
audio/en/3f2a9c4b….mp3      one file per distinct spoken line
```

`index.json`:

```json
{
  "version": 1,
  "lang": "en",
  "lines": {
    "|a||Supply meets demand.": { "file": "3f2a9c4b….mp3", "ms": 2140 }
  }
}
```

The map key is `speechKey(line)` verbatim — the same string `BufferSpeech`
already looks up. The file name is a hex digest of that key, so it is
content-addressed: identical narration anywhere in the repo is one file.

`ms` is the decoded duration. It is not needed for playback (the audio element
reports its own length) but it makes the publish dialog able to say "4 minutes
of narration, 1.2 MB" before uploading, and it makes a corrupt file detectable.

**One file per line, not one per drawcast.** Considered and rejected: a single
concatenated track per item with offsets. Per-line wins on three counts — no
offset arithmetic to get wrong, a repeated line costs one file across a whole
course, and republishing a regenerated lecture uploads only genuinely new
lines. The cost is more HTTP requests at playback, which `prefetch` already
issues in parallel.

**One shared `audio/` pool at the repo root, not one per course.** Content
addressing makes sharing safe, and twenty lectures that all say "Let us look at
the numbers" pay once. It also means the per-course delete pass (`removedPaths`)
must never touch `audio/` — see §5.

## 2. Declaring it

The playlist header gains one field:

```yaml
playlist:
  title: Difference-in-differences
  audio: { en: ../../audio/en }
```

A path relative to the document, so the viewer resolves it without knowing the
repo layout, and so a drawcast moved with its audio still works. Absent means
no baked audio and today's behaviour exactly — **the viewer fetches nothing and
loads no new code unless a document asks for it.**

`playlist/playlist.ts` `readMeta` learns the field; unknown shapes warn and are
ignored, like `advance` and `transitions` already do.

## 3. Playback

A new `SpeechManager`, `PublishedSpeech`, wrapping the existing one:

```
speak(text, speed, signal, opts)
  key = speechKey({ text, ...opts })
  hit = index.lines[key]
  hit ? play the file : inner.speak(...)      // CloudSpeech, then browser voice
```

Three properties fall out:

- **Stale audio cannot play.** The key contains the text. Edit a line and the
  lookup misses, so it speaks live instead of speaking the old words. This is
  the safety property the whole format is built around, and it is free.
- **Partial bakes are fine.** A drawcast where three lines were added after the
  last bake plays those three live and the rest from file.
- **Mixed failure is fine.** A 404 on one file falls through to the inner
  manager for that line only.

`prefetch` fetches the files for the lines ahead, exactly as `CloudSpeech`
prefetches syntheses. `index.json` is fetched once at mount.

## 4. Baking

At publish time, given a TTS key:

1. `playlistSpeakLines(playlist)` → every distinct line the playlist can speak.
2. For each, `speechKey` → is it already in the repo's `audio/<lang>/index.json`?
   Skip if so. **This is what makes republishing cheap.**
3. Synthesize the rest. `synthesizeOne` is split into `synthesizeBytes` (returns
   the base64 the API already sent) and `synthesizeOne` (decodes it, unchanged
   for every existing caller). Rate is fixed at 1.0 — §7.
4. Upload each new file as a blob; write the merged `index.json`.

Sequential, like `synthesizeAll`, to stay far from rate limits, with per-line
progress and a cancel that leaves the repo untouched (nothing is committed
until every blob exists).

The dialog says what it will do before doing it: *"38 lines, 12 already
published, 26 to synthesize (~14 000 characters). Bake and publish?"* — because
this spends the author's TTS budget, and `ttsBudgetError()` already refuses when
a vended key is over its monthly cap.

## 5. Where the index lives, and the manifest trap

`parseManifest` must preserve keys it does not understand before anything
stores an audio index beside `courses`. Two ways to satisfy that:

1. Round-trip unknown top-level keys instead of dropping them.
2. Add `audio: { [lang]: { [key]: { file, ms } } }` — or keep the index in
   `audio/<lang>/index.json` and leave `courses.json` alone entirely.

**Recommendation: the separate `index.json`.** It keeps the audio index out of
a file whose parser has already proven it drops things, it is fetched by the
viewer directly (which never reads `courses.json`), and it keeps a single
drawcast's publish from having to touch a course-shaped manifest at all. The
`parseManifest` fix is still worth making, but it stops being load-bearing.

`removedPaths` computes deletions from the files a course published last time.
Audio is shared across courses, so **`audio/` paths must never enter a course's
`files` list.** Otherwise deleting one lecture deletes narration another lecture
is still using. A test pins this.

## 6. Uploading binary

`commitFiles` gains a second input beside `files: PublishFile[]`:

```ts
blobs: { path: string; base64: string }[]
```

For each, `POST /repos/{o}/{r}/git/blobs` with `{ content, encoding: "base64" }`,
collect the returned shas, and put `{ path, mode, type: "blob", sha }` entries
in the tree beside the inline-content ones. The commit stays atomic: blobs are
loose objects until the tree references them, so a failure part-way leaves the
branch untouched.

Cost is one POST per *new* file. A first bake of a twenty-lecture course is
therefore slow (hundreds of requests) and wants a progress bar and a resumable
story: because blobs are content-addressed by git, **re-running after a failure
re-uploads only what did not land.**

## 7. Speed, and the pitch problem

`CloudSpeech` renders each speed separately, so 2× today is a genuine 2× render
at normal pitch. Baked audio has one render, and
`AudioBufferSourceNode.playbackRate` resamples — 2× is a chipmunk.

**Solution: play baked audio through an `HTMLAudioElement` with
`preservesPitch = true` and `playbackRate = speed`.** Supported in Chrome,
Firefox and Safari. Bake at rate 1.0 and let the element stretch.

This makes speed *better* than today: changing speed mid-drawcast is instant
instead of triggering a fresh round of synthesis.

Two consequences to respect:

- **Mute and pause must still work.** `CloudSpeech` implements them on a
  `GainNode` and by stopping sources. An `<audio>` element has `.muted`,
  `.pause()` and `.play()` directly, which is simpler; `PublishedSpeech`
  implements the same `SpeechManager` contract over them.
- **The video exporter must not use this path.** It records through a
  `MediaStreamAudioDestinationNode` and needs `AudioBuffer`s
  (`BufferSpeech`). Export keeps synthesizing, or decodes the baked MP3s into
  buffers — the latter is a straight win (no TTS spend on re-export) and is
  worth doing, but it is separable and not required here.

### 7.1 Keeping the speed control (decided)

Dropping the speed control for baked drawcasts was offered and is **not
taken**. `preservesPitch` is one property on one element, supported in all
three engines, and it is the same mechanism podcast players and YouTube use —
this is not a hard part hiding as an easy one.

Removing it would cost more than it saves: speed is a control viewers expect
from anything shaped like a video, and it would make the same drawcast behave
differently in the editor and after publishing, which is the kind of split
nobody can predict from the outside.

If browser time-stretch turns out to sound worse than expected on real
narration, the retreat is graded rather than all-or-nothing:

1. Narrow the offered range (0.75×–1.5×), where stretch artefacts are
   inaudible, and keep the control.
2. Fall back to live synthesis at non-1× speeds when a key is present, baked
   audio at 1×.
3. Only then, hide the control for baked playback.

This is a judgement to revisit against a real baked drawcast, not before. Nothing
in the format depends on which rung is used.

## 8. Sizes, and what to warn about

Neural MP3 runs on the order of 4 KB per second of speech, so a six-minute
drawcast is roughly 1.5 MB and a twenty-lecture course roughly 30 MB. That is
comfortable for a git repo and for `raw.githubusercontent.com`.

**Git history is permanent, and this is where inline costs most.** Git stores a
whole new copy of any file whose contents changed at all. Change one word of
narration in an inline drawcast and the entire ~1.2 MB is stored again, forever
— twenty republishes of one lecture leaves ~24 MB of history that cannot be
reclaimed. Sidecar keeps the document tiny, so only genuinely new clips ever
become new objects. This does not bite a short drawcast published a handful of
times; it bites a course regenerated repeatedly, which is the normal way
courses are used here. It is the strongest argument for sidecar and the reason
§16 keeps it on the roadmap rather than dropping it.

Three things to **measure rather than assume** before this ships:

1. GitHub Pages' bandwidth allowance against a class of students all opening
   the same lecture.
2. `raw.githubusercontent.com` abuse-rate limiting for a burst of unauthenticated
   fetches of many small files from one address — a campus NAT is the realistic
   worst case. Inline delivery (§15) reduces this to one request and is the
   direct answer if it bites.
3. Google Cloud TTS's terms on redistributing synthesized audio as published
   files. Believed permitted; not verified, and it gates the whole feature.

## 9. Google Docs

A gdoc is fetched via `export?format=txt` — plain text, so it cannot hold MP3
files. Two routes, and the choice is the same size question as §15.4:

- **Short: inline (§15).** Text is exactly what a gdoc carries, so a small
  drawcast's audio can live in the document itself. This is the only way a
  gdoc-hosted drawcast gets baked audio with nothing else to host.
- **Long: point elsewhere.** `audio:` takes an absolute URL, so the document
  can name a public repo. Document anywhere, audio in a repo.

A gdoc is also edited by hand in a way a published repo file is not, and a
screenful of base64 in the middle of it is genuinely unpleasant to work around.
That is an argument for a *lower* inline threshold here than for a repo file,
not for refusing inline — and it is a preference to check with real use rather
than a number to fix now.

## 10. What a second language would add

Nothing structural. `audio/<lang>/` is already keyed by language, and the
`audio:` header is already a map. A future version bakes the translated lines
(the `subtitles` track is already the source of those strings) and the CC
picker becomes one language choice applied to both caption and voice, each
degrading independently: a Norwegian track with no Norwegian audio shows
Norwegian captions over the source-language voice.

Deliberately not built now. It multiplies synthesis cost and repo size, and the
single-language case is what removes the per-viewer cost entirely.

## 11. The seam for recorded speech

The booth writes the same files. `index.json` gains an optional
`"source": "tts" | "recorded"` per line so the UI can show which is which, and
the hash-fallback already handles a re-recorded line correctly. Nothing else in
this design changes.

What the booth needs beyond this — per-line record and re-take, level
normalization, a "which lines lack audio" view, mic permissions — is its own
work and its own spec.

## 12. Dependency: publishing a single drawcast

Goal 2 says a single drawcast can be published with audio, and there is no
single-drawcast publish path today (§0). That work is its own change:
`buildCastPlan`/`publishCast` beside the course pair, reusing `commitFiles`,
`preflight` and `slugFor` unchanged.

**Ordering:** the audio layer is designed to sit on either path, so it does not
block. If single-drawcast publishing is not built first, this ships as a course
publish option and gains the single-drawcast checkbox when that path lands.

## 13. Testing

- `speechKey` → file name is a pure function: round-trip and collision tests.
- `PublishedSpeech` against a fake index: hit plays the file, miss delegates,
  fetch failure delegates, an edited line delegates. No network.
- The bake planner is pure: given lines and an existing index, which are new?
  Which are now orphaned? Cancel leaves nothing half-written.
- `commitFiles` with blobs, against the existing fetch stub: blobs are posted
  before the tree, the tree references shas, a blob failure commits nothing.
- A drift test that `audio/` paths never appear in a course's `files` list
  (§5), because the failure — deleting narration another lecture uses — is
  silent and destructive.
- Inline (§15): an `{audio: …}` document is parsed as audio and **never** as a
  playlist item — the `else` in `classifyDocs` would otherwise turn it into a
  figure that fails `validateSpec` and takes the whole drawcast down with it.
- Inline: a base64 round-trip through `dump`/`loadAll` comes back byte-identical
  (this is what `lineWidth: -1` buys, and a regression there would corrupt every
  payload at once).
- Inline: `formatPlaylist` never emits the audio document, so nothing the editor
  saves, versions, or sends to a model can carry audio (§15.2).

## 14. What this makes redundant

The password-for-free-TTS idea (ROADMAP, and the tier-3 item in the 2026-08-31
player round) served viewers of published drawcasts. Baked audio serves them
strictly better: better voice consistency, no quota, no rate limit, no key to
leak, and no per-play cost. **Recommendation: drop the separate speech
password rather than build it.** The existing single password still covers the
authoring side, which is the only place a live TTS key is still needed.

## 15. Inline audio — the whole drawcast in one file

An opt-in alternative to §1's sidecar files: the MP3s ride inside the published
document as base64. **Recommended, for short drawcasts, under one hard rule
(§15.2).**

### 15.1 Why it is worth having

- **One request instead of N+1.** A forty-line drawcast is one fetch rather
  than a YAML, an index, and forty MP3s. This is the direct answer to the
  `raw.githubusercontent.com` rate-limit risk in §8, and it removes the fetch
  waterfall (document → index → audio) as well as the count.
- **It is the only way a Google Doc gets baked audio** without a companion
  repo (§9). A gdoc is fetched as text; text is exactly what this is.
- **Nothing to keep in step.** No index that can point at a file that was
  deleted, no `audio/` pool a course-level delete pass could prune (§5), no
  blob-upload path needed at all — the document is already committed as a
  UTF-8 string by the existing `commitFiles`.
- **Megabyte documents are already normal here.** `toBase64`
  (`publish/github.ts:213`) is chunked specifically because specs carrying
  embedded portrait strokes "run to megabytes" and Firefox reported the naive
  concatenation as "too much recursion". That path is already built and tested.
- **The YAML trap is already avoided.** `YAML_OPTS` is `{ lineWidth: -1 }`
  (`playlist/playlist.ts:143`), so js-yaml will not fold a long base64 scalar
  across lines. Had it wrapped, every payload would have been corrupt.

### 15.2 The hard rule: published artifact only, never the working document

Inline audio must exist **only** in the file written to GitHub, and must be
stripped at load before anything else sees the document. Four verified reasons,
each of which is a real failure and not a worry:

1. **The editor puts the document in a `<textarea>.`** `setDoc` does
   `specArea.value = formatPlaylist(...)` (`main.ts:1713`). A megabyte of
   base64 there makes the editor unusable.
2. **History keeps twenty full copies.** `MAX_VERSIONS = 20` and every
   `Version` holds `text`, "exactly what the editor textarea holds"
   (`history.ts:15`). Twenty copies of a 1.3 MB document is 26 MB of live
   strings, and every revise adds one.
3. **Saving rewrites the entire library as one localStorage value.**
   `saveDrawing` → `writeJson(KEYS.library, all)` (`store.ts:297`) serializes
   *every* saved drawcast on *every* autosave, and `writeJson` throws
   `StorageFullError` on quota. Two inline drawcasts in the library would
   likely break saving for all of them.
4. **The spec is sent to the model as context.** Both `translate.ts:117` and
   `subtitles.ts:146` interpolate `JSON.stringify(spec)` into the prompt. Audio
   inside a spec would be uploaded to Claude on every translation — ruinous in
   cost, and past the context window besides.

Note what all four have in common: they are hazards of the **spec object**
carrying audio. None of them touch a published file. So the rule is not a
restriction, it is the design.

### 15.3 Where it goes

Not a field on a spec — that is precisely what §15.2 forbids. A separate
document in the multi-document stream, a sibling of the `{playlist: …}` header:

```yaml
---
audio:
  lang: en
  lines:
    "|a||Supply meets demand.": { mp3: "SUQzBAAAAAAA…", ms: 2140 }
```

`classifyDocs` (`playlist/playlist.ts:90`) already dispatches on the top-level
key — `playlist`, `chapter`, else a spec item — so this is one more branch
beside the two that exist.

⚠️ **It must be an explicit branch.** The `else` in `classifyDocs` pushes any
unrecognized mapping as a **spec item**, so an unhandled `{audio: …}` document
would become a broken figure in the playlist and then be handed to
`validateSpec`, which would reject the whole drawcast. The failure is loud, but
it is the first thing to write and the first thing to test.

`formatPlaylist` never emits this document — publishing appends it, and loading
strips it into a side channel. That is what makes §15.2's rule structural
rather than a convention someone has to remember.

### 15.4 Choosing the mode

The bake knows every line's byte count before it commits anything, so the
publish dialog can simply say what each choice costs:

> Narration: 38 lines, 3 min 40 s, 880 KB.
> ● **Inline** — one file, 1.2 MB total. No extra requests.
> ○ Sidecar — 38 files in `audio/en/`, 880 KB.

Proposed default: **inline under ~1 MB of MP3 (≈1.3 MB base64), sidecar above.**
The threshold is a starting point to be revised once real drawcasts are
measured, not a claim.

Three honest costs of inline, all worth stating in the dialog:

- **+33%.** Base64 is four bytes per three.
- **Nothing plays until all of it has arrived.** Sidecar files stream: the
  first clip can start after ~30 KB while the rest download. Inline is one
  blob — on a slow connection, roughly one second to first word versus fifteen.
  For a two-minute drawcast this is not worth noticing; for a ten-minute
  lecture it is, which is the same reason the threshold exists.
- **Every republish stores the whole file again, forever** (§8). Sidecar
  re-uploads only changed clips (§4). Cheap for a drawcast published a few
  times; the main cost for a course regenerated repeatedly.

**A correction worth recording**, because it was wrong in the first draft of
this design and it moves the threshold: a course does *not* become one enormous
file when inlined. Courses already publish **one file per lecture**
(`buildPublishPlan` writes `<dir>/<lecture>.yaml` each), so inlining a
twenty-lecture course gives twenty ~1.2 MB files, not a single 24 MB one. Size
alone therefore does not rule inline out for courses — the streaming and git-
history costs above do, and they are about editing frequency rather than size.

### 15.5 Loading

`parsePlaylistText` returns the audio document alongside the playlist. The
viewer decodes each base64 string once into an `AudioBuffer` (or an object URL
for the `<audio>` element of §7) and hands `PublishedSpeech` the same
key → audio map it would have built from files. **From §3's point of view the
two modes are indistinguishable**, which is what keeps the fallback chain,
the staleness property and the tests common to both.

### 15.6 Recommendation

Inline ships first. See §16.

## 16. Build order

**Revised 2026-08-31, on Hans's suggestion, from "sidecar first" to "inline
first".** The reasoning is recorded because the first ordering looked obviously
right and was not.

### The primitive, stated first

The one capability everything here rests on is small enough to say in a
sentence: **the engine can speak from audio it is handed, looked up by the
sentence.** Everything else in this document — where the bytes come from, how
they are committed, when they are baked — is delivery around that one thing.

The first draft buried this as a consequence of §3 rather than starting from
it. Naming it first makes the ordering question obvious, because the primitive
is shared by both delivery modes: **nothing built first is thrown away.**

### Stage 1 — the primitive plus inline

1. `PublishedSpeech`: a `SpeechManager` that plays supplied audio by
   `speechKey`, delegating to the inner manager on a miss (§3). Its input is
   bytes; base64 is only how bytes survive in a text file, so a sidecar fetch
   later hands it the same thing without a base64 round-trip.
2. `{audio: …}` as a document kind in `classifyDocs`, with the explicit-branch
   test of §15.3.
3. `synthesizeOne` split so the base64 the API already returned is kept (§4).
4. A publish option that bakes and inlines, with the dialog of §15.4.

Stage 1 needs **none** of the awkward machinery: no `git/blobs` upload (§6), no
`index.json`, no `parseManifest` fix (§5), no `removedPaths` guard. The
document is a UTF-8 string, which `commitFiles` already commits. It is by a
wide margin the shortest path to narration that actually plays for a viewer
with no key.

### Stage 2 — sidecar, when it earns itself

Sidecar adds §5, §6 and the shared-`audio/` deletion guard. Build it when one
of its two real advantages actually bites, rather than on the prediction that
it will:

- time to first word on a long lecture over a slow connection (§15.4), or
- git history growth on a course republished many times (§8).

Both are measurable against a real baked course. Neither is measurable now.

### What this changes about the rest of the document

Nothing structural. §1–§4 and §7 describe the shared lookup, the bake and the
speed handling, all of which stage 1 needs in full. §5, §6 and the sidecar
half of §1 move to stage 2. The `parseManifest` fix (§5) stays worth doing on
its own merits — it silently drops unknown keys today — but it stops being a
prerequisite for anything here.
