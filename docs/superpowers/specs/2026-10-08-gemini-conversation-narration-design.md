# Gemini narration recorded as conversations (2026-10-08)

## Why

Hans compared, by ear, the first lines of the Rome cast in Gemini 3.8 Flash
TTS (Charon the historian, Puck the sceptic, same styles):

- A: the lines performed as one two-speaker conversation;
- B: each line performed on its own.

A was better ("B is also good, but A is better"). Gemini also beat Google
Studio clearly. But Gemini's first paid tier allows 10 requests a minute and
100 a day per model, and a cast has 70–85 lines; line-by-line recording fits
about one cast a day.

## What was tested (all on 8 Rome lines)

| Test | Result |
|---|---|
| Two-speaker conversation, one direct request | works; natural pace (47.7 s) |
| Same through **batch mode** (`batchGenerateContent`) | works when each line is a part with `speech_metadata.speaker` (+ `style`); 3.6 min turnaround; half price; no per-minute/day request limits |
| Split by pauses alone | fails: 23 pauses for 7 boundaries |
| Rough line starts from Gemini 3.5 Flash (±1 s), snapped to the nearest pause | 6/8 right first time; 7th right after moving the cut one pause earlier |
| Check each cut clip by transcribing it alone | catches every error (transcribing all clips in one request confuses them) |
| Failure seen | the model cut off the last line mid-word |
| Style written into the text ("Say this as …") | partly read aloud; the style belongs in `speech_metadata.style` |

## The design

Recording stays **one clip per line**, so the player, every line ↔ drawing
timing rule (speech starting with a drawing, a sentence ending when a
drawing ends, lines running under gestures, waiting for a drawing before
moving on), questions, quizzes and asks are unchanged: they work from the
clip and its length, not from how it was made. Only how the clips are made
changes, and only for a cast whose `voices:` are Gemini ones.

### The choice: `take`

The cast's `voices:` block chooses how Gemini voices are recorded:

```
voices: {"a": "gemini:Charon | dry, warm historian", "b": "gemini:Puck | cheerful sceptic", "take": "conversation"}
```

- `conversation` (the default for Gemini voices): stretches performed as
  conversations, split into lines (part B below).
- `lines`: each line on its own (part A below) — the fallback if a cast
  splits badly, and for a narrator with very short lines.
- Without `voices:`: Google Studio, as now. Narration credit always speaks
  Studio (the server speaks Cloud TTS only).

The app shows it as "Recorded as: conversation / line by line" under
Narration voices.

### Build order

- **Step A — line by line through batch.** Every line that needs recording
  goes as one request of one batch job; each answer is that line's clip.
  Nothing to split. Removes the quota problem at once; sound B ("also
  good"). Kept afterwards as `take: lines`.
- **Step B — conversations through batch**, on top of A: the same job,
  waiting, storing and `voices:`, plus stretches, splitting, checking and the
  natural-pause gap.

### A1. The batch job (both steps)

All requests of a recording go to Google as **one batch job**
(`gemini-3.8-flash-tts:batchGenerateContent`, inline requests, each keyed).
A request is `generateContent`-shaped: each spoken line one part with its
`speech_metadata` (`speaker`, `style`; never the style in the text, which
gets read aloud), `speech_config` with the voice (or the two speakers).
Polled every 20 s; usually done in 2–5 min (Google allows 24 h; the job
expires after 48). Over 20 MB of requests: several jobs.

### A2. Storing (both steps)

Each clip is encoded to MP3 (as today) and stored under its line's key
with `voice` = the cast's Gemini spec, as a line-by-line clip is. A clip
that is already recorded in the same voice and style is not re-bought.

### B1. Stretches

The lines to record are cut into **stretches**: runs of spoken lines in
playing order, broken at every viewer turn (ask, quiz, explore, check), at
every page, and at 12 lines. Each stretch is one two-speaker request
(single-speaker with one voice). A cast has about 8–12.

A **spare closing line** ("Right.") is appended to every stretch and thrown
away after the split, so a cut-off at the end (seen in the test) costs the
spare, not a real line.

A stretch is recorded if any of its lines needs recording (new text, new
voice or style), and then **whole** — its unchanged lines are replaced too,
so the stretch sounds like one take.

### B2. Splitting

For each stretch's audio:

1. Gemini 3.5 Flash (`generateContent`, audio + the known lines) gives each
   line's rough start in seconds.
2. Pauses are found in the audio (≥ 80 ms under 3 % of peak).
3. Each boundary snaps to the nearest pause to its rough start, preferring
   longer pauses, never before the previous cut.
4. Each clip is cut **tight**: its words plus about 0.1 s each side. The
   pause between two lines is not kept in either clip — silence at a clip's
   end would make "the sentence ends" late, silence at its start would make
   a line spoken with a drawing start after the drawing.
5. Each line keeps the pause that came **before** it in the take, as a
   number (`pause` on the clip, seconds).

The timing requests go as one batch job when there are many.

### B3. Checking — every clip

Each cut clip is transcribed **on its own** (Gemini 3.5 Flash) and its first
and last two words compared with its line (numbers, punctuation and case
normalised: "210" = "two hundred and ten").

- Wrong edge → move that cut to the neighbouring pause, check again (up to 3
  moves).
- Words missing from the recording itself → that line is re-recorded **on
  its own** (single-line request, style in `speech_metadata`).
- Still wrong → the line is reported and left to the Studio voice (or the
  browser), never stored as a wrong clip.

### B4. The natural pause in playback

Where the cast's own commands decide the timing (a drawing started with the
voice, waiting for a drawing, a `pause`, a viewer turn), they win, as now.
Where nothing does — one spoken line simply following another — the player
uses the clip's recorded `pause` as the gap instead of its default gap, so
the conversation's rhythm (a quick reply, a thoughtful pause) survives.

## Where it runs

- **Recording script** (`bake-narration.mjs`): submits, waits, (splits,
  checks), writes the file; a stop keeps what is done (as today). First, as
  the proving ground.
- **App publish** (own Gemini key): the cast publishes at once; narration is
  "recording…" in the publish dialog and fills in when the job is done (a
  re-publish of the copy with its clips; the dialog can be closed and the
  job is resumed on the next open). Second.
- **The editor never calls Gemini while playing**: unrecorded lines play in
  the Studio/browser voice, so playing a cast spends no quota. Recorded
  Gemini clips go into the browser's clip store (bake-cache, keyed as today),
  so after a recording the editor's preview plays them, free. A cast still
  being edited plays mixed (Gemini for recorded lines, Studio for new ones);
  Narration voices says "N lines not yet recorded in Gemini".
- **One changed line** (take `lines`, or a repair): a single-line request
  within the 10-a-minute limit, not a batch job.

## Cost and limits

- Speech: about $0.03 per cast (batch is half of ~$0.06).
- Timing + checking (step B): Gemini 3.5 Flash, about 1–2 cents per cast; its
  own limits (batched when needed).
- No per-minute or per-day TTS request limit in the batch path; single-line
  repairs use the 10/min, 100/day budget.

## Decided (Hans, 2026-10-08)

- Conversation (A in the listening test) is the goal; line by line through
  batch comes first and stays as the fallback.
- Tight cuts; the natural pause stored and used as the default gap.
- Old and new side by side, chosen per cast; Studio stays the default.
- The editor keeps the old voices for unrecorded lines; recorded Gemini
  clips are reused there.
- Defaults until tried: stretches of up to 12 lines; app publish fills the
  narration in afterwards; a stretch is re-recorded whole.

## Not in this round

- Per-line tone notes (excited, calm, incredulous) — fits both takes; next.
- A "record narration now" button in the editor, without publishing.
- Overlapping reactions — the model is told not to overlap.
- A whole cast as one take.

## Tests

- Batch request/response shapes (fixtures from the real answers above),
  polling, several jobs over 20 MB, a failed request in a job.
- Stretch building from a playlist (breaks at asks/quizzes/pages, 12 lines,
  spare line).
- Splitting on the saved Rome recordings (8/8 after the check-and-move step);
  tight cuts; the recorded pause per line.
- Edge-check normalisation (numbers, case, punctuation).
- Fallbacks: missing words → single-line re-record; still wrong → reported.
- Playback: the recorded pause is the gap only where no command decides it.
- Live: Rome recorded end to end through the script, both takes, every clip
  checked, listened to by Hans.
