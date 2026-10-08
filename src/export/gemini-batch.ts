// Gemini batch mode (2026-10-08, docs/superpowers/specs/2026-10-08-gemini-
// conversation-narration-design.md): many keyed generateContent requests in
// one job — no per-minute or per-day request limit, half price — polled until
// done. A job's answers come back keyed, each its audio (WAV) or its error.

import { speechKey, type SpeakLine } from "../render/delivery";
import { geminiVoice, lineStyle, pcmMs, pcmToMp3Base64, wavPcm, type GeminiVoice } from "./gemini-tts";
import { sayable } from "../render/pronounce";
import { preferredVoice, runLang } from "./tts";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface BatchRequest {
  key: string;
  model: string;
  body: unknown;
}

export type BatchResult = { wav: Uint8Array } | { error: string };

/** One line, one voice: the style in speech_metadata (in the text it gets read aloud). */
export function lineRequest(v: GeminiVoice, text: string, delivery?: string): unknown {
  const style = lineStyle(v.style, delivery);
  return {
    contents: [{ role: "user", parts: [{ text, ...(style ? { speech_metadata: { style } } : {}) }] }],
    generation_config: { response_modalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: v.voice } } } },
  };
}

/**
 * A poll that tells the caller what to do next:
 * - "unusable": the job ended FAILED / CANCELLED / EXPIRED (or with no
 *   results), or the poll got a 4xx (404 gone, a revoked key). Waiting longer
 *   never helps: forget the job and submit a fresh one.
 * - "timeout": still running when the wait ran out. The job is fine; a later
 *   poll of the same name may well find it done.
 * Anything else (a network failure, 5xx after retries) stays a plain Error —
 * transient, so a saved job is kept.
 */
export class BatchJobError extends Error {
  constructor(
    message: string,
    readonly kind: "unusable" | "timeout",
    readonly job: string,
  ) {
    super(message);
    this.name = "BatchJobError";
  }
}

export const isUnusableJob = (e: unknown): e is BatchJobError => e instanceof BatchJobError && e.kind === "unusable";
export const isTimedOutJob = (e: unknown): e is BatchJobError => e instanceof BatchJobError && e.kind === "timeout";

async function failureMessage(res: Response, what: string): Promise<string> {
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    /* keep the status */
  }
  return `Gemini batch ${what}: ${message}`;
}

async function failure(res: Response, what: string): Promise<Error> {
  return new Error(await failureMessage(res, what));
}

const stillRunning = (name: string, waited: number): BatchJobError =>
  new BatchJobError(`Gemini batch ${name} is still running after ${Math.round(waited / 60_000)} min`, "timeout", name);

export async function submitBatch(apiKey: string, model: string, reqs: BatchRequest[], fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${BASE}/models/${model}:batchGenerateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      batch: { display_name: `drawcast-${reqs.length}`, input_config: { requests: { requests: reqs.map((r) => ({ request: r.body, metadata: { key: r.key } })) } } },
    }),
  });
  if (!res.ok) throw await failure(res, "submit");
  const name = ((await res.json()) as { name?: string }).name;
  if (!name) throw new Error("Gemini batch submit: no batch name in the answer");
  return name;
}

const DONE = new Set(["BATCH_STATE_SUCCEEDED", "BATCH_STATE_FAILED", "BATCH_STATE_CANCELLED", "BATCH_STATE_EXPIRED"]);
const POLL_MS = 20_000;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Inlined = { metadata?: { key?: string }; error?: { message?: string }; response?: { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string }; inline_data?: { data?: string } }> } }> } };

export async function pollBatch(
  apiKey: string,
  name: string,
  opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; onState?: (s: string) => void; timeoutMs?: number } = {},
): Promise<Map<string, BatchResult>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const limit = opts.timeoutMs ?? 30 * 60_000;
  let waited = 0;
  let consecutiveFailures = 0;
  for (;;) {
    let res: Response;
    for (;;) {
      try {
        res = await fetchImpl(`${BASE}/${name}`, { headers: { "x-goog-api-key": apiKey } });
        break;
      } catch (e) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) throw e;
        await sleep(POLL_MS);
        waited += POLL_MS;
        if (waited >= limit) throw stillRunning(name, waited);
      }
    }
    if (!res!.ok) {
      // 5xx, 408 and 429 are passing trouble: retry. Any other 4xx (404 gone, 403 a revoked key) never gets better.
      if (res!.status >= 500 || res!.status === 408 || res!.status === 429) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) throw await failure(res!, "poll");
        await sleep(POLL_MS);
        waited += POLL_MS;
        if (waited >= limit) throw stillRunning(name, waited);
        continue;
      }
      throw new BatchJobError(await failureMessage(res!, `poll of ${name}`), "unusable", name);
    }
    consecutiveFailures = 0;
    const body = (await res!.json()) as { done?: boolean; error?: { message?: string }; metadata?: { state?: string }; response?: { inlinedResponses?: { inlinedResponses?: Inlined[] } | Inlined[] } };
    if (body.error) throw new BatchJobError(`Gemini batch ${name} failed: ${body.error.message ?? "unknown error"}`, "unusable", name);
    const state = body.metadata?.state ?? "";
    opts.onState?.(state);
    if (body.done || DONE.has(state)) {
      if (state && state !== "BATCH_STATE_SUCCEEDED") throw new BatchJobError(`Gemini batch ${name} ended ${state}`, "unusable", name);
      const r = body.response?.inlinedResponses;
      const items: Inlined[] = Array.isArray(r) ? r : (r?.inlinedResponses ?? []);
      if (!items.length && body.done && !state) throw new BatchJobError(`Gemini batch ${name} finished with no results`, "unusable", name);
      const out = new Map<string, BatchResult>();
      for (const item of items) {
        const key = item.metadata?.key;
        if (!key) continue;
        if (item.error) {
          out.set(key, { error: item.error.message ?? "failed" });
          continue;
        }
        const part = item.response?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data || p.inline_data?.data);
        const data = part?.inlineData?.data ?? part?.inline_data?.data;
        out.set(key, data ? { wav: b64ToBytes(data) } : { error: "no audio in the answer" });
      }
      return out;
    }
    if (waited >= limit) throw stillRunning(name, waited);
    await sleep(POLL_MS);
    waited += POLL_MS;
  }
}

/** Requests grouped by model, each group cut so no job's JSON passes `maxBytes` (Google's inline limit is 20 MB). */
export function jobsOf(reqs: BatchRequest[], maxBytes = 18_000_000): BatchRequest[][] {
  const jobs: BatchRequest[][] = [];
  const byModel = new Map<string, BatchRequest[]>();
  for (const r of reqs) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  for (const list of byModel.values()) {
    let job: BatchRequest[] = [];
    let size = 0;
    for (const r of list) {
      const n = JSON.stringify(r.body).length + r.key.length + 64;
      if (job.length && size + n > maxBytes) {
        jobs.push(job);
        job = [];
        size = 0;
      }
      job.push(r);
      size += n;
    }
    if (job.length) jobs.push(job);
  }
  return jobs;
}

/** Whether a line is spoken by a Gemini voice and can be recorded whole (no `lang` run, no `[de:…]` mark). */
export function isGeminiLine(voices: Record<string, string>, lang: string | undefined, line: SpeakLine): boolean {
  if (line.lang !== undefined) return false;
  if (/\[[A-Za-z-]+:/.test(line.text)) return false;
  return geminiVoice(preferredVoice(voices, runLang(line, lang), line.speaker)) !== null;
}

/** Each Gemini line as one request of one batch job (several jobs past the size limit); answers as MP3 clips, keyed by speechKey. */
export async function batchLines(
  apiKey: string,
  voices: Record<string, string>,
  lang: string | undefined,
  lines: SpeakLine[],
  opts: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    onState?: (s: string) => void;
    timeoutMs?: number;
    onSubmitted?: (names: string[]) => void;
    resume?: string[];
    /** A resumed job turned out unusable (expired, failed, cancelled, 404…); a fresh job is submitted for what it did not answer. */
    onResumeGone?: (err: BatchJobError) => void;
  } = {},
): Promise<Map<string, { mp3: string; ms: number }>> {
  const reqs: BatchRequest[] = [];
  for (const line of lines) {
    const v = geminiVoice(preferredVoice(voices, runLang(line, lang), line.speaker));
    if (!v) continue;
    reqs.push({ key: speechKey(line), model: v.model, body: lineRequest(v, sayable(line.text), line.delivery) });
  }
  const submit = (list: BatchRequest[]) => Promise.all(jobsOf(list).map((job) => submitBatch(apiKey, job[0].model, job, opts.fetchImpl)));
  const out = new Map<string, { mp3: string; ms: number }>();
  const answered = new Set<string>();
  const collect = async (names: string[], resumed: boolean): Promise<boolean> => {
    let gone = false;
    for (const name of names) {
      let results: Map<string, BatchResult>;
      try {
        results = await pollBatch(apiKey, name, opts);
      } catch (e) {
        // A saved job that can never answer must not stick: say so and record afresh.
        if (resumed && isUnusableJob(e)) {
          opts.onResumeGone?.(e);
          gone = true;
          continue;
        }
        throw e;
      }
      for (const [key, r] of results) {
        answered.add(key);
        if (!("wav" in r)) continue;
        const pcm = wavPcm(r.wav);
        out.set(key, { mp3: await pcmToMp3Base64(pcm), ms: pcmMs(pcm) });
      }
    }
    return gone;
  };
  const resumed = !!opts.resume?.length;
  const names = resumed ? opts.resume! : await submit(reqs);
  opts.onSubmitted?.(names);
  if (await collect(names, resumed)) {
    const rest = reqs.filter((r) => !answered.has(r.key));
    if (rest.length) {
      const fresh = await submit(rest);
      opts.onSubmitted?.(fresh);
      await collect(fresh, false);
    }
  }
  return out;
}
