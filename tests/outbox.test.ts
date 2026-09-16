// The local record as outbox (spec 2026-09-16-course-progress §3): unsent
// entries, the sent stamp, and the sweep that sends them and stamps the ones
// the server took. Storage and send are injected; nothing touches the network.
import { describe, expect, test } from "vitest";
import { answerEventOf, sweepOutbox } from "../src/outbox";
import { appendRecord, markSent, readRecords, unsentRecords, type AnswerRecord } from "../src/render/record";
import type { LearnEvent, SendOutcome } from "../src/learn";

const CAST = "hmelberg/dcast/learn-russian/03-cases.yaml";

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
const rec = (step: number, at: string, extra: Partial<AnswerRecord> = {}): AnswerRecord => ({
  item: 0,
  step,
  id: `_answers.${step}`,
  question: "?",
  given: ["a"],
  expected: "a",
  correct: true,
  at,
  ...extra,
});

describe("the outbox", () => {
  test("unsent entries are the ones without a sent stamp; markSent stamps by (item, step, at)", () => {
    const s = memStorage();
    appendRecord(s, CAST, rec(1, "t1"));
    appendRecord(s, CAST, rec(2, "t2", { sent: "s" }));
    appendRecord(s, CAST, rec(1, "t3"));
    expect(unsentRecords(s, CAST).map((r) => r.at)).toEqual(["t1", "t3"]);
    markSent(s, CAST, [rec(1, "t3")], "now");
    expect(readRecords(s, CAST).map((r) => r.sent ?? null)).toEqual([null, "s", "now"]);
    expect(unsentRecords(s, CAST).map((r) => r.at)).toEqual(["t1"]);
  });

  test("answerEventOf carries the record's own time and seconds", () => {
    expect(answerEventOf(CAST, rec(4, "t4", { secs: 1.5 }))).toEqual({
      kind: "answer",
      cast: CAST,
      item: 0,
      step: 4,
      id: "_answers.4",
      question: "?",
      given: ["a"],
      expected: "a",
      correct: true,
      secs: 1.5,
      at: "t4",
    });
    expect(answerEventOf(CAST, rec(5, "t5"))).not.toHaveProperty("secs");
  });

  test("the sweep sends the unsent entries and stamps exactly the ones the server took", async () => {
    const s = memStorage();
    appendRecord(s, CAST, rec(1, "t1"));
    appendRecord(s, CAST, rec(2, "t2", { sent: "s" }));
    appendRecord(s, CAST, rec(3, "t3"));
    appendRecord(s, CAST, rec(4, "t4"));
    const seen: LearnEvent[] = [];
    const send = async (events: LearnEvent[]): Promise<SendOutcome[]> => {
      seen.push(...events);
      return ["ok", "failed", "ok"];
    };
    const out = await sweepOutbox({ storage: s, castKey: CAST, cast: CAST, send, now: () => "sweep-time" });
    expect(out).toEqual({ sent: 2, failed: 1, refused: false });
    expect(seen.map((e) => (e.kind === "answer" ? e.at : e.kind))).toEqual(["t1", "t3", "t4"]);
    expect(readRecords(s, CAST).map((r) => r.sent ?? null)).toEqual(["sweep-time", "s", null, "sweep-time"]);
  });

  test("a refusal is reported and stamps nothing; an empty outbox sends nothing", async () => {
    const s = memStorage();
    appendRecord(s, CAST, rec(1, "t1"));
    let sends = 0;
    const refuse = async (events: LearnEvent[]): Promise<SendOutcome[]> => {
      sends++;
      return events.map(() => "refused" as const);
    };
    expect(await sweepOutbox({ storage: s, castKey: CAST, cast: CAST, send: refuse, now: () => "x" })).toEqual({ sent: 0, failed: 0, refused: true });
    expect(unsentRecords(s, CAST)).toHaveLength(1);
    expect(await sweepOutbox({ storage: memStorage(), castKey: CAST, cast: CAST, send: refuse, now: () => "x" })).toEqual({ sent: 0, failed: 0, refused: false });
    expect(sends).toBe(1);
    expect(await sweepOutbox({ storage: null, castKey: CAST, cast: CAST, send: refuse, now: () => "x" })).toEqual({ sent: 0, failed: 0, refused: false });
  });
});
