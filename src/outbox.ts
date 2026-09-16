// The local record as outbox (spec 2026-09-16-course-progress §3). Streaming
// fails silently on a network error and that answer was gone for the
// teacher; with a sent stamp per entry, the viewer resends what the server
// never took — at the next open and right after a join, which is also the
// back-fill for answers given before the account was enrolled. The send is
// injected (learn.ts sendEvents bound to the reporter), so this is pure.

import type { LearnEvent, SendOutcome } from "./learn";
import { markSent, unsentRecords, type AnswerRecord } from "./render/record";

/** The most a sweep sends; a runaway retry loop must not become a flood. */
const MAX_SWEEP = 500;

/** The answer event for one record entry — with the record's own time. */
export function answerEventOf(cast: string, rec: AnswerRecord): LearnEvent {
  return {
    kind: "answer",
    cast,
    item: rec.item,
    step: rec.step,
    id: rec.id,
    question: rec.question,
    given: rec.given,
    expected: rec.expected,
    correct: rec.correct,
    ...(rec.secs !== undefined ? { secs: rec.secs } : {}),
    at: rec.at,
  };
}

export interface SweepOptions {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  /** The record's key (the cast key in the viewer). */
  castKey: string;
  /** The cast the events report under — the same key. */
  cast: string;
  send: (events: LearnEvent[]) => Promise<SendOutcome[]>;
  /** The sent stamp; injected for tests. */
  now?: () => string;
}

export interface SweepResult {
  sent: number;
  failed: number;
  /** The server said no for this cast (401/403): nothing was stamped, and the caller stops reporting for this page load. */
  refused: boolean;
}

export async function sweepOutbox(opts: SweepOptions): Promise<SweepResult> {
  const pending = unsentRecords(opts.storage, opts.castKey).slice(0, MAX_SWEEP);
  if (pending.length === 0) return { sent: 0, failed: 0, refused: false };
  const outcomes = await opts.send(pending.map((r) => answerEventOf(opts.cast, r)));
  const taken = pending.filter((_, i) => outcomes[i] === "ok");
  if (taken.length > 0) markSent(opts.storage, opts.castKey, taken, (opts.now ?? (() => new Date().toISOString()))());
  return {
    sent: taken.length,
    failed: outcomes.filter((o) => o === "failed").length,
    refused: outcomes.includes("refused"),
  };
}
