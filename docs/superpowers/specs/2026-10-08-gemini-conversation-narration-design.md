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

Recording stays **one clip per line**, so the player, the line ↔ drawing
timing, questions, quizzes and asks are unchanged. Only how the clips are
made changes, and only for a cast whose `voices:` are Gemini ones.

### 1. Stretches

The lines to record are cut into **stretches**: runs of spoken lines in
playing order, broken at every viewer turn (ask, quiz, explore, check), at
every page, and at ~12 lines. Each stretch is one two-speaker request
(single-speaker when it has only one voice). A cast has about 8–12.

A **spare closing line** ("Right.") is appended to every stretch and thrown
away after the split, so a cut-off at the end (seen in the test) costs the
spare, not a real line.

Lines a stretch shares with an earlier recording are not re-bought: a
stretch is recorded only if one of its lines needs recording (new text,
new voice or style), and then whole — its unchanged lines are replaced too,
so the stretch sounds like one take.

### 2. Recording: one batch job

All stretches of a publish go to Google as **one batch job**
(`gemini-3.8-flash-tts:batchGenerateContent`, inline requests, keyed by
stretch). Polled every 20 s; usually done in 2–5 min (Google allows 24 h).

### 3. Splitting

For each stretch's audio:

1. Gemini 3.5 Flash (`generateContent`, audio + the known lines) gives each
   line's rough start in seconds.
2. Pauses are found in the audio (≥ 80 ms under 3 % of peak).
3. Each boundary snaps to the nearest pause to its rough start, preferring
   longer pauses, never before the previous cut.

The timing requests also go as one batch job when there are many.

### 4. Checking — every clip

Each cut clip is transcribed **on its own** (Gemini 3.5 Flash) and its first
and last two words compared with its line (numbers, punctuation and case
normalised: "210" = "two hundred and ten").

- Wrong edge → move that cut to the neighbouring pause, check again (up to 3
  moves).
- Words missing from the recording itself → that line is re-recorded **on
  its own** (single-line request, style in `speech_metadata`), within the
  10-a-minute limit.
- Still wrong → the line is reported and left to the Studio voice (or the
  browser), never published as a wrong clip.

### 5. Storing

Each clip is encoded to MP3 (as today) and stored under its line's key
with `voice` = the cast's Gemini spec, exactly like a line-by-line clip.
Durations come from the clip. The stretch's take is not kept.

### 6. Where it runs

- **Recording script** (`bake-narration.mjs`): waits for the batch job,
  splits, checks, writes the file; a stop keeps what is done (as today).
  First, as the proving ground.
- **App publish** (own Gemini key): the cast publishes at once; narration is
  "recording…" in the publish dialog and fills in when the job is done (the
  dialog can be closed; the job is resumed on the next open). Second.
- **Live preview in the editor** never calls Gemini: unrecorded lines play
  in the Studio/browser voice, so playing a cast spends no quota.
- **Narration credit** keeps Studio (the server speaks Cloud TTS only).
- **One changed line**: a single-line request, not a batch job (quick, and
  within the 10-a-minute limit), unless the speaker's voice changed.

## Cost and limits

- Speech: about $0.03 per cast (batch is half of ~$0.06).
- Timing + checking: Gemini 3.5 Flash, about 1–2 cents per cast; its own
  limits (batched when needed).
- No per-minute or per-day TTS request limit in the batch path; single-line
  repairs use the 10/min, 100/day budget.

## Not in this round

- Per-line tone notes (excited, calm, incredulous) — fits both paths; next.
- Overlapping reactions — the model is told not to overlap.
- A whole cast as one take.

## Tests

- Stretch building from a playlist (breaks at asks/quizzes/pages, spare line).
- Batch request/response shapes (fixtures from the real answers above).
- Splitting on the saved Rome recordings (8/8 after the check-and-move step).
- Edge check normalisation (numbers, case, punctuation).
- Fallbacks: missing words → single-line re-record; still wrong → reported.
- Live: Rome recorded end to end through the script, every clip checked.

## Open points for Hans

1. Stretch length ~12 lines: shorter stretches are safer to split, longer
   ones flow more. Start at 12?
2. App publish waits for the job in the background — acceptable, or should
   publish wait (2–5 min) before finishing?
3. Re-record a whole stretch when one of its lines changes (consistent
   sound), or only that line on its own (cheaper, may sound a little
   different)?
