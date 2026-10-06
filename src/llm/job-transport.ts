// LLM calls on credit (credit plan delivery 1, 2026-10-06). An author with
// no Anthropic key of their own, signed in, spends credit: the request goes
// to Anvil, which runs it with drawcast's key as a background job and
// charges the TRUE cost (from Anthropic's final usage) times the markup.
// Netlify cut every streamed response at 60 s and an Opus part streams for
// minutes, so the browser polls the job instead of holding a stream open.
//
// runJob is createMessage's (client.ts) third road beside the SDK stream and
// the lab's manual transport: it takes the same request body and gives back
// the same Anthropic.Message, raises the SDK's own error classes (a 400
// still drives the schema and fallback degradation), calls onDelta as text
// arrives, and turns an abort into /llm/cancel plus APIUserAbortError.
//
// Every poll is also published to onJobStatus listeners, so the editor can
// say what is happening — queued, thinking, writing, charged — while a call
// runs (Hans: "keep the user updated on the progress").

import Anthropic from "@anthropic-ai/sdk";
import { apiBase, DEFAULT_ENROLL_API } from "../learn";

/** The key a call site passes to makeClient to spend credit instead of a key. */
export const CREDIT_KEY = "drawcast-credit";

/** A credit is a cent: 10,000 micro-dollars (server_code/credit.py). */
export const MICRO_PER_CREDIT = 10_000;

export function creditsOf(micro: number): number {
  return Math.round((micro / MICRO_PER_CREDIT) * 100) / 100;
}

/** Thrown when the balance cannot cover a call's start (a 402 from /llm/start). */
export class LlmCreditError extends Error {
  neededMicro: number | null;
  balanceMicro: number | null;
  constructor(neededMicro: number | null, balanceMicro: number | null) {
    super(
      neededMicro === null || balanceMicro === null
        ? "Not enough credit for this call — buy credit under Settings → Credits."
        : `Not enough credit — this call needs about ${Math.ceil(creditsOf(neededMicro))} credits to start and ${Math.floor(creditsOf(balanceMicro))} are left. Buy credit under Settings → Credits.`,
    );
    this.name = "LlmCreditError";
    this.neededMicro = neededMicro;
    this.balanceMicro = balanceMicro;
  }
}

export type JobPhase = "starting" | "queued" | "thinking" | "writing" | "done" | "failed";

export interface JobStatus {
  /** The job's id once started; "" while /llm/start is in flight. */
  job: string;
  model: string;
  phase: JobPhase;
  /** Wall-clock since this call was asked for, measured here (the server's own clock goes quiet while the model thinks). */
  elapsedMs: number;
  /** Characters of text so far — an output estimate; the true count arrives only at the end. */
  chars: number;
  /** What the finished call was charged, in credits. */
  chargedCredits?: number;
}

// What this run's finished calls were charged, in credits — reset with the
// call ledger (client.ts resetCallLedger) when a generation starts.
let runCharged = 0;
export function runChargedCredits(): number {
  return Math.round(runCharged * 100) / 100;
}
export function resetRunCharges(): void {
  runCharged = 0;
}

type Listener = (s: JobStatus) => void;
const listeners = new Set<Listener>();

/** Follow every credit job's progress; returns the unsubscribe. */
export function onJobStatus(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(s: JobStatus): void {
  for (const fn of listeners) {
    try {
      fn(s);
    } catch {
      /* a listener's own failure is not the call's */
    }
  }
}

export interface JobDeps {
  api: string;
  token: () => string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps = (token: () => string): JobDeps => ({
  api: DEFAULT_ENROLL_API,
  token,
  fetch: (...a) => fetch(...a),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => performance.now(),
});

let tokenSource: () => string = () => "";
/** The session token source (account.ts's getToken), set once by the app. */
export function setCreditTokenSource(fn: () => string): void {
  tokenSource = fn;
}

export interface JobOpts {
  signal?: AbortSignal;
  onDelta?: (delta: string, snapshot: string) => void;
  /** The first sign the model has the request (its message_start) — releases client.ts's prefix gate. */
  onFirstEvent?: () => void;
}

/** Poll quickly while a short call may already be done, then settle to once a second. */
export function pollDelay(sinceStartMs: number): number {
  return sinceStartMs < 3000 ? 300 : 1000;
}

const RETRYABLE = new Set([0, 408, 429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 4;
const MAX_POLL_FAILURES = 30;

interface PollReply {
  phase?: string;
  text?: string;
  offset?: number;
  usage?: Record<string, unknown> | null;
  model?: string | null;
  stop_reason?: string | null;
  stop_details?: unknown;
  error?: { status?: number; type?: string; message?: string } | null;
  final?: boolean;
  charged_micro?: number | null;
}

function apiError(status: number, type: string, message: string): InstanceType<typeof Anthropic.APIError> {
  return Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, message, new Headers());
}

async function post(deps: JobDeps, path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return deps.fetch(`${apiBase(deps.api)}/_/api${path}`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify(body),
    signal,
  });
}

/** One attempt: start, then poll to the end. Throws `{retry: true}`-tagged errors for what may be tried again. */
async function attempt(request: Record<string, unknown>, betas: string[], opts: JobOpts, deps: JobDeps, t0: number): Promise<Anthropic.Message> {
  const model = String(request.model ?? "");
  const key = deps.token();
  if (!key) throw new Error("Sign in to use credit (Settings → Publishing), or add your own Anthropic API key.");
  emit({ job: "", model, phase: "starting", elapsedMs: deps.now() - t0, chars: 0 });
  const res = await post(deps, "/llm/start", { key, request, betas }, opts.signal);
  if (res.status === 402) {
    const b = (await res.json().catch(() => ({}))) as { needed_micro?: unknown; balance_micro?: unknown };
    throw new LlmCreditError(typeof b.needed_micro === "number" ? b.needed_micro : null, typeof b.balance_micro === "number" ? b.balance_micro : null);
  }
  if (res.status === 401) throw new Error("Sign in again to use credit (Settings → Publishing).");
  if (res.status === 400) {
    const b = (await res.json().catch(() => ({}))) as { field?: unknown };
    throw apiError(400, "invalid_request_error", `drawcast refused this request (${String(b.field ?? "bad")})`);
  }
  if (!res.ok) throw Object.assign(apiError(res.status === 429 ? 429 : 503, "api_error", `credit service unavailable (${res.status})`), { retry: true });
  const { job } = (await res.json()) as { job: string };

  let snapshot = "";
  let offset = 0;
  let firstSeen = false;
  let failures = 0;
  const started = deps.now();
  for (;;) {
    if (opts.signal?.aborted) {
      await post(deps, "/llm/cancel", { key, job }).catch(() => undefined);
      throw new Anthropic.APIUserAbortError();
    }
    let reply: PollReply;
    try {
      const r = await post(deps, "/llm/poll", { key, job, from: offset });
      if (!r.ok) throw new Error(String(r.status));
      reply = (await r.json()) as PollReply;
      failures = 0;
    } catch {
      if (++failures > MAX_POLL_FAILURES) throw new Error("Lost touch with the credit service while the call ran — check your connection.");
      await deps.sleep(1000);
      continue;
    }
    if (reply.text) {
      snapshot += reply.text;
      opts.onDelta?.(reply.text, snapshot);
    }
    if (typeof reply.offset === "number") offset = reply.offset;
    const phase = (reply.phase ?? "queued") as JobPhase;
    if (!firstSeen && phase !== "queued") {
      firstSeen = true;
      opts.onFirstEvent?.();
    }
    const charged = typeof reply.charged_micro === "number" ? creditsOf(reply.charged_micro) : undefined;
    if (reply.final && charged !== undefined) runCharged += charged;
    emit({ job, model, phase: reply.final && reply.error ? "failed" : phase, elapsedMs: deps.now() - t0, chars: snapshot.length, chargedCredits: charged });
    if (reply.final) {
      if (reply.error) {
        const status = reply.error.status ?? 0;
        const err = apiError(status || 503, reply.error.type ?? "api_error", reply.error.message || `the call failed (${reply.error.type ?? status})`);
        throw snapshot === "" && RETRYABLE.has(status) ? Object.assign(err, { retry: true }) : err;
      }
      const usage = (reply.usage ?? {}) as unknown as Anthropic.Usage;
      return {
        id: job,
        type: "message",
        role: "assistant",
        model: reply.model ?? model,
        content: [{ type: "text", text: snapshot, citations: null }],
        stop_reason: (reply.stop_reason ?? "end_turn") as Anthropic.Message["stop_reason"],
        stop_sequence: null,
        ...(reply.stop_details ? { stop_details: reply.stop_details } : {}),
        usage,
      } as unknown as Anthropic.Message;
    }
    await deps.sleep(pollDelay(deps.now() - started));
  }
}

/**
 * One Messages call on credit. `request` is the Messages body createMessage
 * built (model, max_tokens, system, messages, output_config, fallbacks…);
 * `betas` its anthropic-beta list. Retries what Anthropic or the service
 * says to retry — but only while nothing has been written, so a retried
 * call is never charged twice for text the author already saw.
 */
export async function runJob(request: Record<string, unknown>, betas: string[], opts: JobOpts = {}, deps: JobDeps = defaultDeps(tokenSource)): Promise<Anthropic.Message> {
  const t0 = deps.now();
  for (let n = 1; ; n++) {
    try {
      return await attempt(request, betas, opts, deps, t0);
    } catch (err) {
      if (!(err as { retry?: boolean }).retry || n >= MAX_ATTEMPTS || opts.signal?.aborted) throw err;
      await deps.sleep(1000 * 2 ** (n - 1));
    }
  }
}
