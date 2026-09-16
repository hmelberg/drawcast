# Course Progress — client steps 1 and 3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The viewer reports `item` activity events, keeps the local record as an outbox that is swept on mount and after a join, joins a run from a lecture link, and shows a hand-in button on the end poster when the run asks for it.

**Architecture:** Pure helpers carry the logic (an item timer, the outbox sweep, the learn client calls) and are unit-tested; the session and the viewer wire them with the existing never-awaited report pattern, guarded by source-text tests since the repo has no jsdom. The server is not required for anything here: unknown kinds are ignored, the sweep sends one event per call until the list body lands, and the hand-in button stays hidden until the progress answer carries `handin`.

**Tech Stack:** TypeScript, vitest, Netlify build (`npm test && npm run build`).

**Spec:** `docs/superpowers/specs/2026-09-16-course-progress-and-submit-design.md` §2, §3, §4, §6 steps 1 and 3.

## Global Constraints

- Nothing in the learner path may throw into playback; nothing is awaited on the playback path (`tests/learn-viewer.test.ts` forbids `await sendEvent(` / `await report(` in viewer.ts and the literal `localStorage`).
- `report({ kind: "(opened|answer|completed)"` must still occur exactly three times in viewer.ts.
- Seconds in `item` events are integers; `visible_secs` counts time with the tab visible, `playing_secs` time in state `playing` (visible or not).
- One `item` row per item view; a hide/pagehide closes the view and a return opens a new one for the same item; `done` is whether the item reached "done" during that view.
- Only a signed-in, enrolled account reports (the existing `reporter`), and a refusal stops the page load's reporting as today.
- The `&join=<run>` parameter is stripped from the address once the join has been attempted (any outcome) — never before, so the sign-in round trip keeps it.

---

### Task 1: learn.ts — new event kinds, `sendEvents`, `runInfo`

**Files:** Modify `src/learn.ts`; Test `tests/learn.test.ts`.

**Produces:**
- `LearnEvent` gains `{ kind: "item"; cast; item: number; title: string; visible_secs: number; playing_secs: number; done: boolean }` and `{ kind: "handed_in"; cast }`; `AnswerPayload` gains `at?: string`.
- `sendEvents(api, events: LearnEvent[], key, fetchImpl?): Promise<SendOutcome[]>` — one call per event, in order, stops after a `refused` (later entries get `refused` too).
- `runInfo(api, key, course, fetchImpl?): Promise<RunInfo | null>` with `RunInfo = { handin: boolean; due?: string; handed_in?: string }` from `GET <api>/_/api/progress?key=&course=`; null on any non-ok, network error, or non-object body; `handin` defaults false.

- [ ] Tests: `sendEvents` sends N calls with the event bodies in order and stops at a 403; `runInfo` parses `{handin:true, due, handed_in}`, returns null on 404 and on a throw, and `handin: false` when the field is absent.
- [ ] Implement; run `npx vitest run tests/learn.test.ts`; commit.

### Task 2: record.ts — the outbox, and the sweep

**Files:** Modify `src/render/record.ts`; Create `src/outbox.ts`; Test `tests/stored-answers.test.ts` (record block) and `tests/outbox.test.ts`.

**Produces:**
- `AnswerRecord.sent?: string`; `unsentRecords(storage, castKey)`; `markSent(storage, castKey, entries, sentAt)` matching entries by `(item, step, at)`.
- `answerEventOf(cast, rec): LearnEvent` (kind answer with `at` and `secs` when present).
- `sweepOutbox({ storage, castKey, cast, send, now }): Promise<{ sent: number; failed: number; refused: boolean }>` — reads unsent, caps at 500, `send(events)` → outcomes, stamps the `ok` ones.

- [ ] Tests: unsent filtering; markSent stamps only the matched entries; the sweep stamps exactly the ok ones, counts failed, and reports refused; an empty outbox sends nothing.
- [ ] Implement; run both files; commit.

### Task 3: the item timer

**Files:** Create `src/playlist/item-timer.ts`; Test `tests/item-timer.test.ts`.

**Produces:** `class ItemTimer { constructor(now: () => number = () => performance.now()); start(item: number, title: string): void; setVisible(v: boolean): void; setPlaying(p: boolean): void; markDone(): void; close(): ItemView | null }` with `ItemView = { item, title, visible_secs, playing_secs, done }`. `close()` returns null when nothing is open; rounding to the nearest second; a `close` after `start` restarts nothing — the caller calls `start` again for a new view.

- [ ] Tests with a fake clock: visible/hidden intervals sum; playing counts while hidden; done flag; close twice returns null the second time; re-start after close.
- [ ] Implement; run; commit.

### Task 4: session wiring — `onItem`, the hand-in poster button

**Files:** Modify `src/playlist/session.ts`; Test `tests/learn-session.test.ts` (source guards).

**Produces:** `SessionOptions.onItem?(view: ItemView): void` and `SessionOptions.handIn?: () => HandInState | null` where `HandInState = { handedAt?: string; due?: string; press: () => Promise<string | null> }`.

- The session owns one `ItemTimer`. `mountItem` and the single-item mount call `timer.start(i, itemTitle(items[i]))` after the mount; before a swap (`mountItem` start), on destroy, on `pagehide` and on `visibilitychange → hidden`, `flush()` closes the view and calls `opts.onItem` when a view was open; on `visibilitychange → visible` the timer restarts the current item's view. `chainCallbacks.onState` sets `timer.setPlaying(s === "playing")` and calls `timer.markDone()` on "done".
- `showHandIn()`: like `showNextLink`, on the LAST item's "done", when `opts.handIn?.()` returns a state: a button on `.cs-stage` labelled *Hand in* (or *Handed in ✓ <time>* when `handedAt`), `due` shown as "due <date>" in its title. Press: disabled while `press()` runs, then relabelled from the returned time or "Could not hand in — try again".

- [ ] Guards: `timer.start(` appears twice; `visibilitychange` and `pagehide` listeners are added in mountPlaylist and removed in destroy; `opts.onItem?.(` is called from one `flush` function; `showHandIn` is called from the done branch next to `showNextLink`.
- [ ] Implement; run `tests/learn-session.test.ts`; tsc; commit.

### Task 5: viewer wiring — `&join=`, the sweep, `item` reports, hand-in

**Files:** Modify `src/viewer.ts`; Test `tests/learn-viewer.test.ts`, `tests/viewer-anvil.test.ts`.

- `ViewerRequest.join?: string` (the run slug, "" = default run) parsed from the `join` parameter.
- After `reporter` is decided and before `mountPlaylist`: when `req.join !== undefined && castKey && enroll === DEFAULT_ENROLL_API`: no token → `location.href = signInUrl(location.href)` and return; token → `joinCourse(...)` with `{ course: courseKeyOf(castKey), title, page: <this address without join>, run? }`; on any outcome strip `join` with `history.replaceState`, set `noteEl` to `joinNote(outcome)`; on `ok`/`pending` when there was no reporter, create it now.
- With a reporter: `void sweepOutbox(...)` once after mount (and after a successful join), `send` = `sendEvents` bound to the reporter; `onItem: (v) => report({ kind: "item", cast, ...v })`; the answer path appends the record then sends and stamps `sent` on `ok`.
- Hand-in: with a reporter, `void runInfo(...).then(info => { if (info?.handin) handInState = { ... press } })`; `handIn: () => handInState` passed to the session; `press` = sweep, then `sendEvent({kind:"handed_in"})` and on ok store `drawcast.handin:<cast>` = ISO via the record's storage helper and return it.

- [ ] Guards: `join` parsed; `report({ kind: "item"` present; `sweepOutbox(` called; `runInfo(` called with the reporter; no `await sendEvent(`; the three-kinds count stays 3.
- [ ] Implement; run the two test files and the full suite; tsc; commit.

### Task 6: verification, docs, merge

- [ ] `npx vitest run`, `npm run build`. Spec status line → "steps 1 and 3 built 2026-09-17". ROADMAP: two sentences under the stored-answers done section. Merge to main, push, confirm the Netlify deploy is `ready`.
