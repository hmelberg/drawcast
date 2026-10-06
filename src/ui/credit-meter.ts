// The line under the status that says what a call on credit is doing
// (credit plan delivery 1, 2026-10-06; Hans: "keep the user updated on the
// progress and what is happening"). Pure: main.ts feeds it job-transport's
// statuses and puts the text on screen.
//
// No running credit figure while a call writes: the model's thinking is
// billed but invisible, so any number from the visible text would be low.
// The true charge appears the moment each call ends.

import type { JobStatus } from "../llm/job-transport";

const n = (x: number): string => Math.round(x).toLocaleString("en-US");
const secs = (ms: number): string => `${Math.max(0, Math.round(ms / 1000))} s`;

function one(s: JobStatus, label: string): string {
  switch (s.phase) {
    case "starting":
    case "queued":
      return `${label} · waiting for the model… ${secs(s.elapsedMs)}`;
    case "thinking":
      return `${label} · thinking… ${secs(s.elapsedMs)}`;
    case "writing":
      return `${label} · writing… ~${n(s.chars / 4)} tokens · ${secs(s.elapsedMs)}`;
    default:
      return label;
  }
}

/**
 * `active` are the calls still running, `charged` what this run's finished
 * calls cost, `balance` the credits left when known.
 */
export function meterText(active: readonly JobStatus[], charged: number, balance: number | null, modelLabel: (id: string) => string): string {
  const spent = charged > 0 ? `charged ${n(charged)} credit${Math.round(charged) === 1 ? "" : "s"}` : "";
  const left = balance !== null ? `${n(balance)} left` : "";
  if (active.length === 0) {
    return spent ? ["AI on credit", `${spent} for this run`, left].filter(Boolean).join(" · ") : "";
  }
  let head: string;
  if (active.length === 1) {
    head = one(active[0], `AI on credit · ${modelLabel(active[0].model)}`);
  } else {
    const count = (p: JobStatus["phase"][]) => active.filter((s) => p.includes(s.phase)).length;
    const parts = [
      count(["writing"]) && `${count(["writing"])} writing`,
      count(["thinking"]) && `${count(["thinking"])} thinking`,
      count(["starting", "queued"]) && `${count(["starting", "queued"])} waiting`,
    ].filter(Boolean);
    const longest = Math.max(...active.map((s) => s.elapsedMs));
    head = `AI on credit · ${active.length} calls: ${parts.join(", ")} · ${secs(longest)}`;
  }
  return spent ? `${head} · ${spent} so far` : head;
}
