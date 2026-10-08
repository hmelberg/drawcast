// Gemini batch mode (2026-10-08, docs/superpowers/specs/2026-10-08-gemini-
// conversation-narration-design.md): many keyed generateContent requests in
// one job — no per-minute or per-day request limit, half price — polled until
// done. A job's answers come back keyed, each its audio (WAV) or its error.

import { lineStyle, type GeminiVoice } from "./gemini-tts";

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

async function failure(res: Response, what: string): Promise<Error> {
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    /* keep the status */
  }
  return new Error(`Gemini batch ${what}: ${message}`);
}

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
        if (waited >= limit) throw new Error(`Gemini batch ${name} is still running after ${Math.round(waited / 60_000)} min — run again to keep waiting for it`);
      }
    }
    if (!res!.ok) {
      if (res!.status >= 500) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) throw await failure(res!, "poll");
        await sleep(POLL_MS);
        waited += POLL_MS;
        if (waited >= limit) throw new Error(`Gemini batch ${name} is still running after ${Math.round(waited / 60_000)} min — run again to keep waiting for it`);
        continue;
      }
      throw await failure(res!, "poll");
    }
    consecutiveFailures = 0;
    const body = (await res!.json()) as { done?: boolean; error?: { message?: string }; metadata?: { state?: string }; response?: { inlinedResponses?: { inlinedResponses?: Inlined[] } | Inlined[] } };
    if (body.error) throw new Error(`Gemini batch ${name} failed: ${body.error.message ?? "unknown error"}`);
    const state = body.metadata?.state ?? "";
    opts.onState?.(state);
    if (body.done || DONE.has(state)) {
      if (state && state !== "BATCH_STATE_SUCCEEDED") throw new Error(`Gemini batch ${name} ended ${state}`);
      const r = body.response?.inlinedResponses;
      const items: Inlined[] = Array.isArray(r) ? r : (r?.inlinedResponses ?? []);
      if (!items.length && body.done && !state) throw new Error(`Gemini batch ${name} finished with no results`);
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
    if (waited >= limit) throw new Error(`Gemini batch ${name} is still running after ${Math.round(waited / 60_000)} min — run again to keep waiting for it`);
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
