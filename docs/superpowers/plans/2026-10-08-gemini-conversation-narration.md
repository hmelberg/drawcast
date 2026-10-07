# Gemini Narration Through Batch, as Conversations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a cast's Gemini voices through Gemini batch mode — first line by line (Step A), then as two-speaker conversations split into one clip per line (Step B) — so a cast is no longer limited by 10 requests/min and 100/day, and dialogue sounds like a conversation.

**Architecture:** A small Gemini batch client (`src/export/gemini-batch.ts`) submits keyed `generateContent` requests and polls for results. The bake gains a "many at once" path used for Gemini lines; everything else keeps the one-line path. Step B adds stretch building, a PCM toolkit (pauses, cuts), timing and checking against Gemini 3.5 Flash, and a per-clip `pause` the player uses as its breath. Clips stay one per line, keyed and stored as today.

**Tech Stack:** TypeScript, Vitest (node env, `tests/**/*.test.ts`), Gemini API REST (`generativelanguage.googleapis.com/v1beta`), `@breezystack/lamejs` (already a dependency), Node script `scripts/bake-narration.mjs` (loads app code through `vite.ssrLoadModule`).

**Spec:** `docs/superpowers/specs/2026-10-08-gemini-conversation-narration-design.md`

## Global Constraints

- One clip per line, keyed by `speechKey(line)`, stored in `AudioTrack.lines` as `{ mp3, ms, voice?, pause? }`; MP3 base64 (resvg/players expect MP3).
- Style goes in `speech_metadata.style`, never in the spoken text (it gets read aloud).
- Two-speaker requests: every part carries `speech_metadata.speaker`; speakers declared in `speech_config.multi_speaker_voice_config.speaker_voice_configs`.
- TTS model `gemini-3.8-flash-tts` (`gemini-lite:` voices → `gemini-3.8-flash-lite-tts`); timing/checking model `gemini-3.5-flash`.
- Gemini key: `geminiKeyFor(cfg)` (export/gemini-tts.ts) — `GEMINI_API_KEY` in `.env` for the script; Settings → Keys in the app.
- The editor's live preview never calls Gemini.
- Narration credit stays Studio (server speaks Cloud TTS only).
- Inline batch requests under 20 MB per job; poll every 20 s; a job expires after 48 h.
- `take`: `"conversation"` (default for Gemini voices) or `"lines"`, in the cast's `voices:` block.
- Stretches: per page, at most 12 lines, a spare closing line `"Right."` appended and dropped after the split.
- Cuts tight: words ± 0.1 s; the pause before each line kept as `pause` (seconds).
- Checking: each clip transcribed alone; first and last two words compared after normalisation.

## Review Focus

1. **A batch request that fails inside a successful job** (one key returns `error`) — the other lines are stored, the failed line falls back to a single-line request, and the bake does not throw for the whole cast.
2. **A line containing a foreign-word run (`[de:Lebensraum]`)** — it is several clips (one per run, keys with `@lang|`); it must be recorded line by line, never put in a stretch, and every run key must end up with a clip.
3. **The same sentence spoken twice in a cast** — one key, one clip; stretches must not contain it twice, and a stretch must not re-buy a clip another stretch already produced in the same job.
4. **A clip whose `pause` field is read back from a file** — `readAudio` keeps it; a re-bake carries it over; the player's breath uses it only when nothing else decides the gap (next step is not `pause`/viewer turn).
5. **The job never finishes / is slow** — the script prints progress, a `--timeout-min` stops waiting with a clear message and keeps the job name, and re-running with the same file resumes polling the same job instead of submitting (and paying) again.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/export/gemini-batch.ts` (new) | Batch client: build line/conversation requests, submit, poll, read results, split into jobs ≤ 20 MB. |
| `src/export/gemini-tts.ts` (modify) | `CastVoices.take`; export `wavPcm`, `pcmToMp3Base64` (already), add `pcmMs`. |
| `src/export/bake.ts` (modify) | `BakeOptions.synthesizeMany?` — record many lines at once; `pause` carried. |
| `src/playlist/playlist.ts` (modify) | `AudioTrack` clip `pause?`; `readAudio` keeps it. |
| `src/export/stretches.ts` (new, Step B) | Lines in playing order → stretches (per page, ≤ 12, spare line). |
| `src/export/pcm.ts` (new, Step B) | PCM toolkit: pauses, snapping, tight cuts. |
| `src/export/gemini-align.ts` (new, Step B) | Rough starts (3.5 Flash), transcribe-one, edge check, split a take into clips. |
| `src/render/inline-clips.ts`, `src/render/published-speech.ts`, `src/render/player.ts`, `src/render/breath.ts` (modify, Step B) | The recorded `pause` as the breath before a line. |
| `scripts/bake-narration.mjs` (modify) | Batch path, resume, `--timeout-min`, `--take`. |
| `src/main.ts`, `src/ui/voices-choice.ts` (modify) | App publish through batch; "Recorded as" choice; clips into the editor's clip store; "N lines not yet recorded". |
| `.claude/skills/drawcast/SKILL.md`, `references/publish.md` (modify) | Document `take`, batch, waiting. |

---

# Step A — line by line through batch

### Task 1: Gemini batch client

**Files:**
- Create: `src/export/gemini-batch.ts`
- Test: `tests/gemini-batch.test.ts`

**Interfaces:**
- Consumes: `geminiVoice(spec): GeminiVoice | null`, `lineStyle(style, delivery)`, `wavPcm(bytes)`, `pcmToMp3Base64(pcm)` from `src/export/gemini-tts.ts`.
- Produces:
  - `interface BatchRequest { key: string; model: string; body: unknown }`
  - `lineRequest(v: GeminiVoice, text: string, delivery?: string): unknown` — a `generateContent` body.
  - `submitBatch(apiKey: string, model: string, reqs: BatchRequest[], fetchImpl?: typeof fetch): Promise<string>` — returns the batch name.
  - `pollBatch(apiKey: string, name: string, opts?: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; onState?: (s: string) => void; timeoutMs?: number }): Promise<Map<string, BatchResult>>`
  - `type BatchResult = { wav: Uint8Array } | { error: string }`
  - `jobsOf(reqs: BatchRequest[], maxBytes?: number): BatchRequest[][]` — splits by model and size.

- [ ] **Step 1: Write the failing test**

```ts
// tests/gemini-batch.test.ts
import { describe, expect, test } from "vitest";
import { jobsOf, lineRequest, pollBatch, submitBatch } from "../src/export/gemini-batch";

const wav = (n = 2400): Uint8Array => {
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const w = (o: number, s: string): void => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 24000, true); dv.setUint32(28, 48000, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * 2, true);
  return new Uint8Array(buf);
};

describe("gemini batch", () => {
  test("a line request puts the style in speech_metadata, never in the text", () => {
    const b = lineRequest({ model: "gemini-3.8-flash-tts", voice: "Puck", style: "cheerful" }, "Hello", "brisk") as any;
    expect(b.contents[0].parts[0]).toEqual({ text: "Hello", speech_metadata: { style: "cheerful; briskly" } });
    expect(b.generation_config.speech_config.voice_config.prebuilt_voice_config.voice_name).toBe("Puck");
    expect(b.generation_config.response_modalities).toEqual(["AUDIO"]);
  });

  test("submit sends keyed inline requests and returns the batch name", async () => {
    let sent: any;
    const fetchImpl = (async (url: string, init: any) => {
      sent = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ name: "batches/abc" }), { status: 200 });
    }) as unknown as typeof fetch;
    const name = await submitBatch("KEY", "gemini-3.8-flash-tts", [{ key: "k1", model: "gemini-3.8-flash-tts", body: { x: 1 } }], fetchImpl);
    expect(name).toBe("batches/abc");
    expect(sent.url).toContain("models/gemini-3.8-flash-tts:batchGenerateContent");
    expect(sent.body.batch.input_config.requests.requests).toEqual([{ request: { x: 1 }, metadata: { key: "k1" } }]);
  });

  test("poll waits until done and returns each key's audio or error", async () => {
    const audio = Buffer.from(wav()).toString("base64");
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ name: "batches/abc", metadata: { state: "BATCH_STATE_RUNNING" } }), { status: 200 });
      return new Response(JSON.stringify({
        name: "batches/abc", done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" },
        response: { inlinedResponses: { inlinedResponses: [
          { metadata: { key: "k1" }, response: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: audio } }] } }] } },
          { metadata: { key: "k2" }, error: { code: 3, message: "Request contains an invalid argument." } },
        ] } },
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const states: string[] = [];
    const out = await pollBatch("KEY", "batches/abc", { fetchImpl, sleep: async () => {}, onState: (s) => states.push(s) });
    expect(states).toEqual(["BATCH_STATE_RUNNING", "BATCH_STATE_SUCCEEDED"]);
    expect((out.get("k1") as { wav: Uint8Array }).wav.length).toBe(44 + 4800);
    expect(out.get("k2")).toEqual({ error: "Request contains an invalid argument." });
  });

  test("poll gives up after its timeout with the batch name in the message", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ metadata: { state: "BATCH_STATE_RUNNING" } }), { status: 200 })) as unknown as typeof fetch;
    let t = 0;
    await expect(pollBatch("KEY", "batches/abc", { fetchImpl, sleep: async (ms) => void (t += ms), timeoutMs: 60_000 })).rejects.toThrow(/batches\/abc.*still running/);
    expect(t).toBeGreaterThanOrEqual(60_000);
  });

  test("jobs split by model and stay under the size limit", () => {
    const big = "x".repeat(600);
    const reqs = [1, 2, 3].map((i) => ({ key: `k${i}`, model: "m1", body: { big } }));
    reqs.push({ key: "k4", model: "m2", body: { big } });
    const jobs = jobsOf(reqs, 1500);
    expect(jobs.map((j) => j.map((r) => r.key))).toEqual([["k1", "k2"], ["k3"], ["k4"]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gemini-batch.test.ts`
Expected: FAIL — `Cannot find module '../src/export/gemini-batch'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/export/gemini-batch.ts
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
  for (;;) {
    const res = await fetchImpl(`${BASE}/${name}`, { headers: { "x-goog-api-key": apiKey } });
    if (!res.ok) throw await failure(res, "poll");
    const body = (await res.json()) as { done?: boolean; metadata?: { state?: string }; response?: { inlinedResponses?: { inlinedResponses?: Inlined[] } | Inlined[] } };
    const state = body.metadata?.state ?? "";
    opts.onState?.(state);
    if (body.done || DONE.has(state)) {
      if (state && state !== "BATCH_STATE_SUCCEEDED") throw new Error(`Gemini batch ${name} ended ${state}`);
      const r = body.response?.inlinedResponses;
      const items: Inlined[] = Array.isArray(r) ? r : (r?.inlinedResponses ?? []);
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
    await sleep(20_000);
    waited += 20_000;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gemini-batch.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/export/gemini-batch.ts tests/gemini-batch.test.ts
git commit -m "Gemini batch client: keyed requests, submit, poll, jobs under the size limit"
```

### Task 2: Record many lines at once in the bake

**Files:**
- Modify: `src/export/bake.ts` (BakeOptions, bakeNarration)
- Modify: `src/export/gemini-tts.ts` (add `pcmMs`)
- Test: `tests/bake.test.ts` (append)

**Interfaces:**
- Consumes: `linesToBake`, `speechKey`.
- Produces:
  - `BakeOptions.synthesizeMany?(lines: SpeakLine[]): Promise<Map<string, { mp3: string; ms: number; pause?: number }>>` — keyed by `speechKey`. Lines it does not return fall back to `synthesize`.
  - `BakeOptions.many?(line: SpeakLine): boolean` — which lines go to `synthesizeMany`.
  - `pcmMs(pcm: { samples: Int16Array; rate: number }): number` in gemini-tts.ts.

- [ ] **Step 1: Write the failing test** (append to `tests/bake.test.ts`)

```ts
describe("bakeNarration — many lines at once (Gemini batch, 2026-10-08)", () => {
  const a: SpeakLine = { text: "One.", speaker: "a" };
  const b: SpeakLine = { text: "Two.", speaker: "b" };
  const c: SpeakLine = { text: "Three.", speaker: "a" };
  test("lines `many` picks go to synthesizeMany in one call; a line it does not return falls back to synthesize", async () => {
    const one: string[] = [];
    const many: string[][] = [];
    const track = await bakeNarration(
      [a, b, c],
      {
        lang: "en",
        many: (l) => l.text !== "Three.",
        synthesizeMany: async (lines) => {
          many.push(lines.map((l) => l.text));
          return new Map([[speechKey(a), { mp3: "MANY-A", ms: 900, pause: 0.4 }]]);
        },
        synthesize: async (l) => (one.push(l.text), `ONE-${l.text}`),
        voiceOf: () => "gemini:Puck",
      },
      () => {},
      new AbortController().signal,
    );
    expect(many).toEqual([["One.", "Two."]]);
    expect(one).toEqual(["Two.", "Three."]);
    expect(track.lines[speechKey(a)]).toEqual({ mp3: "MANY-A", ms: 900, pause: 0.4, voice: "gemini:Puck" });
    expect(track.lines[speechKey(b)]).toEqual({ mp3: "ONE-Two.", ms: 0, voice: "gemini:Puck" });
  });
  test("an answer for an already-recorded line (a whole stretch re-recorded) replaces its clip", async () => {
    const existing = { [speechKey(c)]: { mp3: "OLD-C", ms: 1, voice: "gemini:Puck" } };
    const track = await bakeNarration(
      [a, c],
      {
        lang: "en",
        existing,
        many: () => true,
        synthesizeMany: async () => new Map([[speechKey(a), { mp3: "NEW-A", ms: 5 }], [speechKey(c), { mp3: "NEW-C", ms: 6, pause: 0.3 }]]),
        synthesize: async () => "UNUSED",
        voiceOf: () => "gemini:Puck",
      },
      () => {},
      new AbortController().signal,
    );
    expect(track.lines[speechKey(c)]).toEqual({ mp3: "NEW-C", ms: 6, pause: 0.3, voice: "gemini:Puck" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bake.test.ts`
Expected: FAIL — `many` lines were each sent to `synthesize`.

- [ ] **Step 3: Write minimal implementation** — in `src/export/bake.ts`:

```ts
export interface BakeOptions {
  lang: string;
  synthesize(line: SpeakLine): Promise<string>;
  existing?: AudioTrack["lines"];
  voiceOf?(line: SpeakLine): string | undefined;
  durationMs?(base64: string): Promise<number>;
  /** Which lines are recorded together (a Gemini batch job, 2026-10-08). */
  many?(line: SpeakLine): boolean;
  /** Records those lines at once; a line it does not return is recorded by `synthesize`. */
  synthesizeMany?(lines: SpeakLine[]): Promise<Map<string, { mp3: string; ms: number; pause?: number }>>;
}
```

and in `bakeNarration`, replace the `for (const [i, line] of todo.entries())` loop with:

```ts
  const together = opts.synthesizeMany && opts.many ? todo.filter((l) => opts.many!(l)) : [];
  const got = together.length ? await opts.synthesizeMany!(together) : new Map<string, { mp3: string; ms: number; pause?: number }>();
  // A conversation take re-records a whole stretch (spec B1): its answers for
  // lines that were already recorded replace those clips too.
  const byKey = new Map(lines.map((l) => [speechKey(l), l]));
  for (const [key, clip] of got) {
    if (!wanted.has(key) || todo.some((l) => speechKey(l) === key)) continue;
    const voice = opts.voiceOf?.(byKey.get(key)!);
    track.lines[key] = { mp3: clip.mp3, ms: clip.ms, ...(clip.pause !== undefined ? { pause: clip.pause } : {}), ...(voice ? { voice } : {}) };
  }
  let done = 0;
  for (const line of todo) {
    if (signal.aborted) throw new Error("bake cancelled");
    onProgress(done, todo.length);
    const key = speechKey(line);
    const voice = opts.voiceOf?.(line);
    const many = got.get(key);
    if (many) {
      track.lines[key] = { mp3: many.mp3, ms: many.ms, ...(many.pause !== undefined ? { pause: many.pause } : {}), ...(voice ? { voice } : {}) };
      done++;
      continue;
    }
    const mp3 = await opts.synthesize(line);
    let ms = 0;
    try {
      ms = (await opts.durationMs?.(mp3)) ?? 0;
    } catch {
      // A duration is a nicety; the clip itself is the point.
    }
    track.lines[key] = voice ? { mp3, ms, voice } : { mp3, ms };
    done++;
  }
  onProgress(todo.length, todo.length);
  return track;
```

and in `src/playlist/playlist.ts` widen the clip type: `lines: Record<string, { mp3: string; ms: number; voice?: string; pause?: number }>;`

In `src/export/gemini-tts.ts` add:

```ts
/** A PCM buffer's length in milliseconds. */
export function pcmMs(pcm: { samples: Int16Array; rate: number }): number {
  return Math.round((pcm.samples.length / pcm.rate) * 1000);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/bake.test.ts && npx tsc --noEmit -p .`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/export/bake.ts src/export/gemini-tts.ts src/playlist/playlist.ts tests/bake.test.ts
git commit -m "Bake: record many lines at once (a Gemini batch), the rest one by one"
```

### Task 3: Keep a clip's `pause` when a file is read back

**Files:**
- Modify: `src/playlist/playlist.ts:372-385` (`readAudio`)
- Test: `tests/baked-audio.test.ts` (append)

**Interfaces:**
- Produces: a parsed clip keeps `pause` when it is a finite number ≥ 0.

- [ ] **Step 1: Write the failing test**

```ts
test("a clip's recorded pause survives the file (2026-10-08)", () => {
  const text = "# T\n\n## T\n    speak \"Hi.\"\n---\naudio:\n  lang: en\n  lines:\n    '|a||Hi.':\n      mp3: AAAA\n      ms: 500\n      voice: gemini:Puck\n      pause: 0.6\n";
  const p = parsePlaylistText(text);
  expect(p.audio?.lines["|a||Hi."]).toEqual({ mp3: "AAAA", ms: 500, voice: "gemini:Puck", pause: 0.6 });
  expect(parsePlaylistText(formatPublished(p, p.audio!, "script")).audio?.lines["|a||Hi."].pause).toBe(0.6);
});
```

(Import `parsePlaylistText, formatPublished` from `../src/playlist/playlist` if the file does not already.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/baked-audio.test.ts`
Expected: FAIL — `pause` missing.

- [ ] **Step 3: Implement** — in `readAudio`, after the `voice` line:

```ts
    if (typeof value.pause === "number" && Number.isFinite(value.pause) && value.pause >= 0) lines[key].pause = value.pause;
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/baked-audio.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/playlist/playlist.ts tests/baked-audio.test.ts
git commit -m "A clip's recorded pause is kept when the file is read back"
```

### Task 4: `take` in the cast's voices

**Files:**
- Modify: `src/export/gemini-tts.ts` (`CastVoices`, `readCastVoices`)
- Test: `tests/gemini-tts.test.ts` (append)

**Interfaces:**
- Produces: `CastVoices.take?: "conversation" | "lines"`; `takeOf(v: CastVoices | undefined): "conversation" | "lines"` — `"conversation"` unless `take: "lines"`.

- [ ] **Step 1: Write the failing test**

```ts
test("take: conversation by default, lines when asked; anything else is ignored", async () => {
  const { readCastVoices, takeOf } = await import("../src/export/gemini-tts");
  expect(readCastVoices({ a: "gemini:Puck", take: "lines" })).toEqual({ a: "gemini:Puck", take: "lines" });
  expect(readCastVoices({ a: "gemini:Puck", take: "sideways" })).toEqual({ a: "gemini:Puck" });
  expect(takeOf({ a: "gemini:Puck" })).toBe("conversation");
  expect(takeOf({ a: "gemini:Puck", take: "lines" })).toBe("lines");
  expect(takeOf(undefined)).toBe("conversation");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gemini-tts.test.ts`
Expected: FAIL — `take` dropped / `takeOf` undefined.

- [ ] **Step 3: Implement** — in gemini-tts.ts:

```ts
export interface CastVoices {
  a?: string;
  b?: string;
  /** How Gemini voices are recorded: as conversations (default) or line by line. */
  take?: "conversation" | "lines";
}

export function takeOf(v: CastVoices | undefined): "conversation" | "lines" {
  return v?.take === "lines" ? "lines" : "conversation";
}
```

and in `readCastVoices`, before `return out.a || out.b ? out : undefined;`:

```ts
  if (obj.take === "conversation" || obj.take === "lines") out.take = obj.take;
```

(`castVoiceMap` already reads only `a`/`b`, so `take` never reaches the voice map.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/gemini-tts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/export/gemini-tts.ts tests/gemini-tts.test.ts
git commit -m "voices: take — conversation (default) or lines"
```

### Task 5: The line-by-line batch synthesizer

**Files:**
- Modify: `src/export/gemini-batch.ts`
- Test: `tests/gemini-batch.test.ts` (append)

**Interfaces:**
- Consumes: `submitBatch`, `pollBatch`, `jobsOf`, `lineRequest` (Task 1); `geminiVoice`, `wavPcm`, `pcmToMp3Base64`, `pcmMs` (gemini-tts.ts); `preferredVoice`, `runLang` (tts.ts); `speechKey` (render/delivery.ts).
- Produces:
  - `isGeminiLine(voices: Record<string, string>, lang: string | undefined, line: SpeakLine): boolean` — the line's chosen voice is a Gemini one and the line has no foreign-run (`line.lang === undefined`).
  - `batchLines(apiKey: string, voices: Record<string, string>, lang: string | undefined, lines: SpeakLine[], opts?: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; onState?: (s: string) => void; timeoutMs?: number; onSubmitted?: (names: string[]) => void; resume?: string[] }): Promise<Map<string, { mp3: string; ms: number }>>`

- [ ] **Step 1: Write the failing test**

```ts
import { batchLines, isGeminiLine } from "../src/export/gemini-batch";
import { speechKey } from "../src/render/delivery";

test("batchLines: one job for the Gemini lines, each answer that line's MP3, failures left out", async () => {
  const voices = { "@a": "gemini:Charon | dry", "@b": "gemini:Puck" };
  const lines = [{ text: "One.", speaker: "a" as const }, { text: "Two.", speaker: "b" as const }];
  const audio = Buffer.from(wav()).toString("base64");
  const sent: any[] = [];
  let polls = 0;
  const fetchImpl = (async (url: string, init?: any) => {
    if (init?.method === "POST") {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ name: "batches/j1" }), { status: 200 });
    }
    polls++;
    const reqs = sent[0].batch.input_config.requests.requests;
    return new Response(JSON.stringify({
      done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" },
      response: { inlinedResponses: { inlinedResponses: [
        { metadata: reqs[0].metadata, response: { candidates: [{ content: { parts: [{ inlineData: { data: audio } }] } }] } },
        { metadata: reqs[1].metadata, error: { message: "nope" } },
      ] } },
    }), { status: 200 });
  }) as unknown as typeof fetch;
  const names: string[][] = [];
  const out = await batchLines("KEY", voices, "en", lines, { fetchImpl, sleep: async () => {}, onSubmitted: (n) => names.push(n) });
  expect(isGeminiLine(voices, "en", lines[0])).toBe(true);
  expect(isGeminiLine(voices, "en", { text: "Hi", speaker: "a", lang: "de" })).toBe(false);
  expect(sent[0].batch.input_config.requests.requests[0].request.contents[0].parts[0].speech_metadata).toEqual({ style: "dry" });
  expect(names).toEqual([["batches/j1"]]);
  expect([...out.keys()]).toEqual([speechKey(lines[0])]);
  expect(out.get(speechKey(lines[0]))!.ms).toBe(100);
  expect(Buffer.from(out.get(speechKey(lines[0]))!.mp3, "base64").length).toBeGreaterThan(50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gemini-batch.test.ts`
Expected: FAIL — `batchLines` not exported.

- [ ] **Step 3: Implement** — append to gemini-batch.ts:

```ts
import { speechKey, type SpeakLine } from "../render/delivery";
import { geminiVoice, pcmMs, pcmToMp3Base64, wavPcm } from "./gemini-tts";
import { preferredVoice, runLang } from "./tts";

/** Whether a line is spoken by a Gemini voice and can be recorded whole (no `[de:…]` run). */
export function isGeminiLine(voices: Record<string, string>, lang: string | undefined, line: SpeakLine): boolean {
  if (line.lang !== undefined) return false;
  return geminiVoice(preferredVoice(voices, runLang(line, lang), line.speaker)) !== null;
}

/** Each Gemini line as one request of one batch job (several jobs past the size limit); answers as MP3 clips, keyed by speechKey. */
export async function batchLines(
  apiKey: string,
  voices: Record<string, string>,
  lang: string | undefined,
  lines: SpeakLine[],
  opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; onState?: (s: string) => void; timeoutMs?: number; onSubmitted?: (names: string[]) => void; resume?: string[] } = {},
): Promise<Map<string, { mp3: string; ms: number }>> {
  const reqs: BatchRequest[] = [];
  for (const line of lines) {
    const v = geminiVoice(preferredVoice(voices, runLang(line, lang), line.speaker));
    if (!v) continue;
    reqs.push({ key: speechKey(line), model: v.model, body: lineRequest(v, line.text, line.delivery) });
  }
  const names = opts.resume?.length ? opts.resume : await Promise.all(jobsOf(reqs).map((job) => submitBatch(apiKey, job[0].model, job, opts.fetchImpl)));
  opts.onSubmitted?.(names);
  const out = new Map<string, { mp3: string; ms: number }>();
  for (const name of names) {
    const results = await pollBatch(apiKey, name, opts);
    for (const [key, r] of results) {
      if (!("wav" in r)) continue;
      const pcm = wavPcm(r.wav);
      out.set(key, { mp3: await pcmToMp3Base64(pcm), ms: pcmMs(pcm) });
    }
  }
  return out;
}
```

Move the new imports to the top of the file next to the existing one.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/gemini-batch.test.ts && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/export/gemini-batch.ts tests/gemini-batch.test.ts
git commit -m "Gemini batch: record a cast's Gemini lines as one job, line by line"
```

### Task 6: The recording script through batch, with resume and timeout

**Files:**
- Modify: `scripts/bake-narration.mjs`
- Test: manual run (the script is not under vitest); unit logic lives in Tasks 1–5.

**Interfaces:**
- Consumes: `batchLines`, `isGeminiLine` (Task 5); `takeOf` (Task 4).
- Produces: CLI `--take conversation|lines` (written into `voices.take` with `--apply`), `--timeout-min N` (default 30), a sidecar `<file>.batch.json` `{ names: string[], lines: string[] }` written when jobs are submitted and removed when the file is written; re-running finds it and resumes.

- [ ] **Step 1: Wire the batch path** — after `const voices = withCastVoices({}, playlist.meta.voices);` add:

```js
  const { batchLines, isGeminiLine } = await vite.ssrLoadModule("/src/export/gemini-batch.ts");
  const sidecar = `${target}.batch.json`;
  const resume = existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, "utf8")).names : undefined;
  const many = (line) => isGeminiLine(voices, declaredLang, line);
  const synthesizeMany = async (todo) => {
    const map = await batchLines(geminiKey || apiKey, voices, declaredLang, todo, {
      resume,
      timeoutMs: timeoutMin * 60_000,
      onSubmitted: (names) => writeFileSync(sidecar, JSON.stringify({ names, lines: todo.map((l) => l.text) })),
      onState: (s) => process.stdout.write(`\r${file}: batch ${s.replace("BATCH_STATE_", "").toLowerCase()}   `),
    });
    for (const [key, clip] of map) recorded[key] = { ...clip, voice: voiceOf(todo.find((l) => speechKey(l) === key)) };
    return map;
  };
```

pass `many, synthesizeMany` into the `bakeNarration` options object, and after a successful `writeFileSync(target, out)` add `if (existsSync(sidecar)) unlinkSync(sidecar);`. At the top: `import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";`, and parse `const timeoutMin = Number(flag("--timeout-min") ?? 30);` and `const takeFlag = flag("--take");` (add both to `flagValues`). When `takeFlag` is `"lines"` or `"conversation"`, merge `{ take: takeFlag }` into `playlist.meta.voices` the same way `--a/--b` are merged.

- [ ] **Step 2: Run the estimate on Rome**

Run: `node scripts/bake-narration.mjs dev-casts/compare/fall-of-rome-gemini.cast`
Expected: prints the line count and the Gemini price (no network).

- [ ] **Step 3: Record Rome line by line through batch**

```bash
cp dev-casts/publish/fall-of-rome/fall-of-rome.cast dev-casts/compare/rome-batch-lines.cast
node scripts/bake-narration.mjs --apply dev-casts/compare/rome-batch-lines.cast --a "gemini:Charon | a dry, warm historian with a twinkle, telling a good story, at a natural, lively podcast pace" --b "gemini:Puck | a cheerful, cheeky sceptic, amused and curious, at a natural, lively podcast pace" --take lines > /tmp/rome-batch.log 2>&1
```

Expected: `batch running … succeeded`, then `→ … 71 clips`; `grep -c "voice: gemini" dev-casts/compare/rome-batch-lines.cast` prints 71; no `.batch.json` left.

- [ ] **Step 4: Resume check** — submit, then interrupt with Ctrl-C after "batch running"; re-run the same command.
Expected: the re-run prints `batch …` without submitting again (the sidecar's names are polled), and finishes.

- [ ] **Step 5: Commit**

```bash
git add scripts/bake-narration.mjs
git commit -m "Recording script: Gemini lines through batch, resumable, with a timeout"
```

### Task 7: App publish through batch, and recorded clips in the editor

**Files:**
- Modify: `src/main.ts` (`publishTextFor`, the bake call at ~5340-5432)
- Modify: `src/ui/voices-choice.ts` (the "Recorded as" choice, the not-yet-recorded note)
- Test: `tests/credit-publish.test.ts` source-pattern expectations if they break; `tests/voices-choice.test.ts` (new)

**Interfaces:**
- Consumes: `batchLines`, `isGeminiLine`, `takeOf`, `getGeminiKey`, `bakeClipStore`, `clipCacheKey`.
- Produces: publish waits for the batch job with status "Recording narration in Gemini — <state>…" (the in-dialog wait; background fill-in is Task 14); every Gemini clip recorded is also `bakeClipStore.put(clipCacheKey(...), mp3)` so the editor's preview plays it.

- [ ] **Step 1: Write the failing test** (`tests/voices-choice.test.ts`)

```ts
import { describe, expect, test } from "vitest";
import { notYetRecorded } from "../src/ui/voices-choice";

describe("Narration voices note", () => {
  test("counts the Gemini lines with no clip in the right voice", () => {
    const voices = { "@a": "gemini:Charon" };
    const lines = [{ text: "One.", speaker: "a" as const }, { text: "Two.", speaker: "a" as const }];
    const existing = { "|a||One.": { mp3: "x", ms: 1, voice: "gemini:Charon" } };
    expect(notYetRecorded(lines, existing, voices, "en")).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/voices-choice.test.ts`
Expected: FAIL — `notYetRecorded` not exported.

- [ ] **Step 3: Implement**

In `src/ui/voices-choice.ts` export:

```ts
import { stampedVoice, runLang } from "../export/tts";
import { linesToBake } from "../export/bake";
import { isGeminiLine } from "../export/gemini-batch";
import type { SpeakLine } from "../render/delivery";
import type { AudioTrack } from "../playlist/playlist";

/** How many of a cast's Gemini lines have no clip in their current voice. */
export function notYetRecorded(lines: SpeakLine[], existing: AudioTrack["lines"], voices: Record<string, string>, lang: string | undefined): number {
  const gem = lines.filter((l) => isGeminiLine(voices, lang, l));
  return linesToBake(gem, existing, (l) => stampedVoice(voices, runLang(l, lang), l)).length;
}
```

Add a "Recorded as" `<select>` (`conversation` / `lines`) to the voices block, shown when either voice starts with `gemini`, writing `take` through the same `report()` path (so `readCastVoices` keeps it). Under the rows add a hint element filled by `refresh()` with `${n} lines not yet recorded in Gemini` when `n > 0` — `refresh` gains an optional `pending?: number` in its options, which share.ts computes with `notYetRecorded(playlistBakeLines(doc.playlist), doc.playlist.audio?.lines ?? {}, withCastVoices({}, doc.playlist.meta.voices), declaredLang)`.

In `src/main.ts` `publishTextFor`, after `const voices = …`:

```ts
  const geminiKey = getGeminiKey() || apiKey;
  const many = (line: SpeakLine): boolean => geminiKey !== "" && isGeminiLine(voices, declaredLang, line);
  const synthesizeMany = async (todo: SpeakLine[]) => {
    const map = await batchLines(geminiKey, voices, declaredLang, todo, {
      onState: (s) => setStatus(`Recording narration in Gemini — ${s.replace("BATCH_STATE_", "").toLowerCase()}…`),
    });
    // The editor's preview finds these in the clip store (keyed as live playback keys them).
    for (const line of todo) {
      const clip = map.get(speechKey(line));
      if (clip) await bakeClipStore.put(clipCacheKey(settings.rate, voices, line, declaredLang), clip.mp3);
    }
    return map;
  };
```

and add `many, synthesizeMany,` to the `bakeNarration` options. Import `batchLines, isGeminiLine` from `./export/gemini-batch` and `speechKey` from `./render/delivery` if not imported.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/voices-choice.test.ts tests/credit-publish.test.ts tests/credit-share.test.ts && npx tsc --noEmit -p .`
Expected: PASS (update the two source-pattern tests only if they pin the exact options object).

- [ ] **Step 5: Manual check in the editor**

Run `npm run dev -- --port 5231 --strictPort`, open `http://localhost:5231/?open=/dev-casts/compare/rome-batch-lines.cast#create`, open Publish → Narration voices: the "Recorded as" choice shows; the note shows `0 lines not yet recorded`. Change b's style: the note shows the b line count.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/ui/voices-choice.ts src/ui/share.ts tests/voices-choice.test.ts
git commit -m "App publish records Gemini lines through batch; recorded clips play in the editor"
```

### Task 8: Step A docs and a listening check

**Files:**
- Modify: `.claude/skills/drawcast/SKILL.md`, `.claude/skills/drawcast/references/publish.md`

- [ ] **Step 1:** In SKILL.md's Voices paragraph add: "`take` chooses how Gemini voices are recorded: `conversation` (default) or `lines`. Recording goes through Gemini's batch mode: a few minutes of waiting, no request limits."
- [ ] **Step 2:** In publish.md's step 3 add: "Gemini voices are recorded through batch mode: the script waits (`--timeout-min`, default 30); if it stops waiting, run it again — it resumes the same job (`<file>.batch.json`)."
- [ ] **Step 3:** Full test run: `npx vitest run` — Expected: all pass.
- [ ] **Step 4:** Ask Hans to listen to `dev-casts/compare/rome-batch-lines.cast` in the player (open it as in Task 7 Step 5) beside the line-by-line direct version.
- [ ] **Step 5: Commit**

```bash
git add .claude/skills/drawcast/SKILL.md .claude/skills/drawcast/references/publish.md
git commit -m "Skill: Gemini voices recorded through batch; take"
```

---

# Step B — conversations through batch

### Task 9: Lines in playing order → stretches

**Files:**
- Create: `src/export/stretches.ts`
- Test: `tests/stretches.test.ts`

**Interfaces:**
- Consumes: `exportSequence(playlist)` (playlist.ts), `collectSpeakLines(spec, carry)` (export/video.ts), `questionOffsets` (session.ts — export it if it is not), `speechKey`.
- Produces:
  - `interface Stretch { key: string; lines: SpeakLine[] }` — `key` = `"stretch-" + index`.
  - `SPARE_LINE = "Right."`, `STRETCH_MAX = 12`
  - `buildStretches(playlist: Playlist, include: (line: SpeakLine) => boolean): Stretch[]` — per spec in `exportSequence` order, the lines `include` accepts, each key once in the whole cast, cut into runs of ≤ `STRETCH_MAX`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { parsePlaylistText } from "../src/playlist/playlist";
import { buildStretches, STRETCH_MAX } from "../src/export/stretches";

const cast = (pages: string[][]): string =>
  "# T\n\n" + pages.map((lines, i) => `## P${i}\n    text t "x" x 500 y 400\n` + lines.map((l) => `    draw t\n      speak "${l}" voice ${l.startsWith("B:") ? "b" : "a"}\n`).join("")).join("\n");

describe("stretches", () => {
  test("per page, in playing order, each line once, at most 12", () => {
    const p1 = Array.from({ length: 14 }, (_, i) => (i % 2 ? `B: line ${i}.` : `line ${i}.`));
    const pl = parsePlaylistText(cast([p1, ["line 0.", "new line."]]));
    const s = buildStretches(pl, () => true);
    expect(s.map((x) => x.lines.length)).toEqual([STRETCH_MAX, 2, 1]);
    expect(s[0].lines[0].text).toBe("line 0.");
    expect(s[2].lines.map((l) => l.text)).toEqual(["new line."]); // "line 0." already in stretch 0
    expect(s.map((x) => x.key)).toEqual(["stretch-0", "stretch-1", "stretch-2"]);
  });
  test("lines the filter rejects are left out", () => {
    const pl = parsePlaylistText(cast([["keep.", "B: drop."]]));
    expect(buildStretches(pl, (l) => l.speaker !== "b")[0].lines.map((l) => l.text)).toEqual(["keep."]);
  });
});
```

(Note: the title card speaks the title; the expectations above count only the page lines — if the title line appears first, filter it in the test with `include = (l) => !l.text.startsWith("T")` and adjust; record what you find in the commit message.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stretches.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/export/stretches.ts
// The runs of spoken lines a Gemini conversation take records (2026-10-08):
// per page, in playing order, each line once in the whole cast, at most
// STRETCH_MAX lines. Viewer turns do not break a run: every line becomes its
// own clip after the split, and the player still waits for the viewer.

import { exportSequence, type Playlist } from "../playlist/playlist";
import { collectSpeakLines } from "./video";
import { questionOffsets } from "../playlist/session";
import { speechKey, type SpeakLine } from "../render/delivery";

export const STRETCH_MAX = 12;
export const SPARE_LINE = "Right.";

export interface Stretch {
  key: string;
  lines: SpeakLine[];
}

export function buildStretches(playlist: Playlist, include: (line: SpeakLine) => boolean): Stretch[] {
  const seq = exportSequence(playlist);
  const offsets = questionOffsets(seq);
  const vars = new Map<string, string>();
  const seen = new Set<string>();
  const out: Stretch[] = [];
  seq.forEach((spec, i) => {
    let run: SpeakLine[] = [];
    const flush = (): void => {
      if (run.length) out.push({ key: `stretch-${out.length}`, lines: run });
      run = [];
    };
    for (const line of collectSpeakLines(spec, { vars, questionOffset: offsets[i] })) {
      const key = speechKey(line);
      if (seen.has(key) || !include(line)) continue;
      seen.add(key);
      run.push(line);
      if (run.length === STRETCH_MAX) flush();
    }
    flush();
  });
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/stretches.test.ts && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/export/stretches.ts src/playlist/session.ts tests/stretches.test.ts
git commit -m "Stretches: a cast's Gemini lines in playing order, per page, at most 12"
```

### Task 10: The conversation request

**Files:**
- Modify: `src/export/gemini-batch.ts`
- Test: `tests/gemini-batch.test.ts` (append)

**Interfaces:**
- Consumes: `Stretch`, `SPARE_LINE` (Task 9); `geminiVoice`, `lineStyle`.
- Produces: `conversationRequest(stretch: Stretch, voiceOfSpeaker: (s: "a" | "b") => GeminiVoice): unknown` — two-speaker when both speakers occur, else single-speaker; the spare line appended in the last speaker's voice; speaker names `"a"`/`"b"`.

- [ ] **Step 1: Write the failing test**

```ts
import { conversationRequest } from "../src/export/gemini-batch";

test("a conversation: every part names its speaker and style; both voices declared; the spare line last", () => {
  const v = { a: { model: "m", voice: "Charon", style: "dry" }, b: { model: "m", voice: "Puck", style: "cheeky" } };
  const body = conversationRequest({ key: "s0", lines: [{ text: "Why?", speaker: "a" }, { text: "Pipes.", speaker: "b" }] }, (s) => v[s]) as any;
  expect(body.contents[0].parts).toEqual([
    { text: "Why?", speech_metadata: { speaker: "a", style: "dry" } },
    { text: "Pipes.", speech_metadata: { speaker: "b", style: "cheeky" } },
    { text: "Right.", speech_metadata: { speaker: "b", style: "cheeky" } },
  ]);
  expect(body.generation_config.speech_config.multi_speaker_voice_config.speaker_voice_configs.map((c: any) => [c.speaker, c.voice_config.prebuilt_voice_config.voice_name])).toEqual([["a", "Charon"], ["b", "Puck"]]);
  const solo = conversationRequest({ key: "s1", lines: [{ text: "Alone.", speaker: "a" }] }, (s) => v[s]) as any;
  expect(solo.generation_config.speech_config.voice_config.prebuilt_voice_config.voice_name).toBe("Charon");
  expect(solo.contents[0].parts.map((p: any) => p.text)).toEqual(["Alone.", "Right."]);
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/gemini-batch.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement**

```ts
import { SPARE_LINE, type Stretch } from "./stretches";

export function conversationRequest(stretch: Stretch, voiceOfSpeaker: (s: "a" | "b") => GeminiVoice): unknown {
  const speakers = [...new Set(stretch.lines.map((l) => l.speaker ?? "a"))];
  const last = stretch.lines[stretch.lines.length - 1]?.speaker ?? "a";
  const part = (text: string, s: "a" | "b", delivery?: string) => {
    const style = lineStyle(voiceOfSpeaker(s).style, delivery);
    return { text, speech_metadata: { ...(speakers.length > 1 ? { speaker: s } : {}), ...(style ? { style } : {}) } };
  };
  const parts = [...stretch.lines.map((l) => part(l.text, l.speaker ?? "a", l.delivery)), part(SPARE_LINE, last)];
  const speech_config =
    speakers.length > 1
      ? { multi_speaker_voice_config: { speaker_voice_configs: (["a", "b"] as const).filter((s) => speakers.includes(s)).map((s) => ({ speaker: s, voice_config: { prebuilt_voice_config: { voice_name: voiceOfSpeaker(s).voice } } })) } }
      : { voice_config: { prebuilt_voice_config: { voice_name: voiceOfSpeaker(speakers[0] as "a" | "b").voice } } };
  return { contents: [{ role: "user", parts }], generation_config: { response_modalities: ["AUDIO"], speech_config } };
}
```

(With one speaker, `speech_metadata` carries only `style`; the test's solo expectation checks texts and voice only.)

- [ ] **Step 4: Run tests** — `npx vitest run tests/gemini-batch.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/export/gemini-batch.ts tests/gemini-batch.test.ts && git commit -m "Gemini batch: the two-speaker conversation request, with a spare closing line"`

### Task 11: PCM toolkit — pauses, snapped cuts, tight clips

**Files:**
- Create: `src/export/pcm.ts`
- Test: `tests/pcm.test.ts`

**Interfaces:**
- Produces:
  - `pauses(samples: Int16Array, rate: number, opts?: { minMs?: number; frac?: number }): Array<{ start: number; end: number }>` — seconds; windows of 20 ms under `frac` (0.03) of the peak RMS for ≥ `minMs` (80).
  - `snapCuts(rough: number[], gaps: Array<{ start: number; end: number }>, duration: number): number[]` — `rough[0]` is the first line's start (ignored); returns cut times between lines (length `rough.length - 1`), each the middle of the gap nearest its rough start (score `|mid − rough| − 0.8 × length`), strictly after the previous cut + 0.5 s.
  - `speechSpan(samples: Int16Array, rate: number, from: number, to: number): { start: number; end: number }` — first/last 20 ms window ≥ 3 % of peak inside `[from, to)`.
  - `tightClips(samples: Int16Array, rate: number, cuts: number[], margin?: number): Array<{ samples: Int16Array; pauseBefore: number }>` — for each segment between cuts (0 … duration), its speech span ± `margin` (0.1 s); `pauseBefore` = this span's start − previous span's end (0 for the first).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { pauses, snapCuts, speechSpan, tightClips } from "../src/export/pcm";

const RATE = 8000;
/** Tone for `s` seconds then silence for `q` seconds, repeated. */
function pcm(segments: Array<[number, number]>): Int16Array {
  const out: number[] = [];
  for (const [s, q] of segments) {
    for (let i = 0; i < s * RATE; i++) out.push(Math.round(9000 * Math.sin((2 * Math.PI * 300 * i) / RATE)));
    for (let i = 0; i < q * RATE; i++) out.push(0);
  }
  return Int16Array.from(out);
}

describe("pcm", () => {
  const a = pcm([[1, 0.6], [1, 0.2], [1, 0.9], [1, 0]]); // lines 1 | 2+3 (short pause inside) | 4
  test("pauses are found with their times", () => {
    const g = pauses(a, RATE);
    expect(g.length).toBe(3);
    expect(g[0].start).toBeCloseTo(1, 1);
    expect(g[2].end - g[2].start).toBeCloseTo(0.9, 1);
  });
  test("cuts snap to the pause nearest each rough start, preferring longer ones", () => {
    const g = pauses(a, RATE);
    // two lines after the first: rough starts at 1.7 s and 4.5 s
    const cuts = snapCuts([0, 1.7, 4.5], g, a.length / RATE);
    expect(cuts[0]).toBeCloseTo(1.3, 1);
    expect(cuts[1]).toBeCloseTo(4.25, 1);
  });
  test("clips are tight around the words, and keep the pause before them", () => {
    const g = pauses(a, RATE);
    const cuts = snapCuts([0, 1.7, 4.5], g, a.length / RATE);
    const clips = tightClips(a, RATE, cuts);
    expect(clips.length).toBe(3);
    expect(clips[0].samples.length / RATE).toBeCloseTo(1.1, 1);
    expect(clips[1].pauseBefore).toBeCloseTo(0.6, 1);
    expect(clips[2].pauseBefore).toBeCloseTo(0.9, 1);
    const span = speechSpan(a, RATE, 0, 1.3);
    expect(span.start).toBeCloseTo(0, 1);
    expect(span.end).toBeCloseTo(1, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/pcm.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/export/pcm.ts
// A conversation take cut into lines (2026-10-08): pauses found by loudness,
// cut points snapped to the pause nearest each line's rough start, each line
// cut tight around its words, the pause before it kept as a number.

const WIN_S = 0.02;

function rmsWindows(samples: Int16Array, rate: number): number[] {
  const win = Math.max(1, Math.round(rate * WIN_S));
  const out: number[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += samples[j] * samples[j];
    out.push(Math.sqrt(s / win));
  }
  return out;
}

export function pauses(samples: Int16Array, rate: number, opts: { minMs?: number; frac?: number } = {}): Array<{ start: number; end: number }> {
  const rms = rmsWindows(samples, rate);
  const thr = Math.max(...rms, 1) * (opts.frac ?? 0.03);
  const min = (opts.minMs ?? 80) / 1000;
  const out: Array<{ start: number; end: number }> = [];
  let st: number | null = null;
  rms.forEach((v, i) => {
    if (v < thr) st ??= i;
    else {
      if (st !== null && st > 0 && (i - st) * WIN_S >= min) out.push({ start: st * WIN_S, end: i * WIN_S });
      st = null;
    }
  });
  return out;
}

export function snapCuts(rough: number[], gaps: Array<{ start: number; end: number }>, duration: number): number[] {
  const cuts: number[] = [];
  let after = 0;
  for (let i = 1; i < rough.length; i++) {
    const cand = gaps.filter((g) => (g.start + g.end) / 2 > after + 0.5);
    if (!cand.length) break;
    const best = cand.reduce((x, g) => (Math.abs((g.start + g.end) / 2 - rough[i]) - 0.8 * (g.end - g.start) < Math.abs((x.start + x.end) / 2 - rough[i]) - 0.8 * (x.end - x.start) ? g : x));
    const cut = Math.min(duration, (best.start + best.end) / 2);
    cuts.push(cut);
    after = cut;
  }
  return cuts;
}

export function speechSpan(samples: Int16Array, rate: number, from: number, to: number): { start: number; end: number } {
  const all = rmsWindows(samples, rate);
  const thr = Math.max(...all, 1) * 0.03;
  const a = Math.floor(from / WIN_S);
  const b = Math.min(all.length, Math.ceil(to / WIN_S));
  let s = -1;
  let e = -1;
  for (let i = a; i < b; i++) if (all[i] >= thr) (s < 0 && (s = i), (e = i));
  return s < 0 ? { start: from, end: from } : { start: s * WIN_S, end: (e + 1) * WIN_S };
}

export function tightClips(samples: Int16Array, rate: number, cuts: number[], margin = 0.1): Array<{ samples: Int16Array; pauseBefore: number }> {
  const duration = samples.length / rate;
  const edges = [0, ...cuts, duration];
  const out: Array<{ samples: Int16Array; pauseBefore: number }> = [];
  let prevEnd = 0;
  for (let i = 0; i + 1 < edges.length; i++) {
    const span = speechSpan(samples, rate, edges[i], edges[i + 1]);
    const from = Math.max(edges[i], span.start - margin);
    const to = Math.min(edges[i + 1], span.end + margin);
    out.push({ samples: samples.slice(Math.round(from * rate), Math.round(to * rate)), pauseBefore: i === 0 ? 0 : Math.max(0, span.start - prevEnd) });
    prevEnd = span.end;
  }
  return out;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/pcm.test.ts` → PASS. If a tolerance is off by one 20 ms window, widen `toBeCloseTo` precision to 1 decimal (already) — do not change the algorithm to fit.
- [ ] **Step 5: Commit** — `git add src/export/pcm.ts tests/pcm.test.ts && git commit -m "PCM toolkit: pauses, snapped cuts, tight clips with the pause before each"`

### Task 12: Timing and checking with Gemini 3.5 Flash

**Files:**
- Create: `src/export/gemini-align.ts`
- Test: `tests/gemini-align.test.ts`

**Interfaces:**
- Consumes: `pauses`, `snapCuts`, `tightClips` (Task 11); `pcmToMp3Base64`, `pcmMs` (gemini-tts.ts).
- Produces:
  - `roughStarts(apiKey, wav: Uint8Array, texts: string[], fetchImpl?): Promise<number[]>`
  - `transcribe(apiKey, wav: Uint8Array, fetchImpl?): Promise<string>`
  - `edgesMatch(heard: string, line: string): boolean` — first two and last two normalised words equal.
  - `splitTake(apiKey, take: { samples: Int16Array; rate: number }, texts: string[], opts?: { fetchImpl?: typeof fetch; moves?: number }): Promise<Array<{ text: string; clip?: { samples: Int16Array; pauseBefore: number }; problem?: "edges" | "missing" }>>` — `texts` includes the spare line last; the spare's clip is dropped from the result.
  - `pcmWav(samples: Int16Array, rate: number): Uint8Array`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { edgesMatch, splitTake } from "../src/export/gemini-align";

describe("edgesMatch", () => {
  test("numbers, case and punctuation are normalised", () => {
    expect(edgesMatch("In 1984, the German historian … 210 of them.", "In 1984 the German historian listed: two hundred and ten of them.")).toBe(true);
    expect(edgesMatch("Two more off the menu.", "Then I'll take two more off the menu.")).toBe(false);
    expect(edgesMatch("So how many would-be emperors does 50", "So how many would-be emperors does fifty years of chaos get you?")).toBe(false);
  });
});

describe("splitTake", () => {
  const RATE = 8000;
  const tone = (s: number) => Array.from({ length: s * RATE }, (_, i) => Math.round(9000 * Math.sin((2 * Math.PI * 300 * i) / RATE)));
  const quiet = (s: number) => Array(Math.round(s * RATE)).fill(0);
  const take = { samples: Int16Array.from([...tone(1), ...quiet(0.6), ...tone(1), ...quiet(0.7), ...tone(0.5)]), rate: RATE };
  test("rough starts snapped to pauses, every clip checked alone; the spare is dropped", async () => {
    const answers = [
      JSON.stringify({ starts: [0, 1.5, 3.2] }),        // rough starts
      "First line here.", "Second line here.",           // transcriptions, one per clip
    ];
    const fetchImpl = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answers.shift() }] } }] }), { status: 200 })) as unknown as typeof fetch;
    const out = await splitTake("KEY", take, ["First line here.", "Second line here.", "Right."], { fetchImpl });
    expect(out.map((o) => o.text)).toEqual(["First line here.", "Second line here."]);
    expect(out.every((o) => o.clip && !o.problem)).toBe(true);
    expect(out[1].clip!.pauseBefore).toBeCloseTo(0.6, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/gemini-align.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/export/gemini-align.ts
// Where each known line sits in a conversation take, and whether each cut
// clip holds exactly its line (2026-10-08). Gemini 3.5 Flash gives rough
// starts (to about a second); the cut snaps to the nearest real pause; each
// clip is transcribed ALONE (several clips in one request confuse it) and its
// edges compared; a wrong edge moves its cut to the neighbouring pause.

import { pauses, snapCuts, tightClips } from "./pcm";

const MODEL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";

export function pcmWav(samples: Int16Array, rate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(buf);
  const w = (o: number, s: string): void => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt "); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, samples.length * 2, true);
  new Int16Array(buf, 44).set(samples);
  return new Uint8Array(buf);
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function ask(apiKey: string, wav: Uint8Array, prompt: string, json: boolean, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(MODEL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: "audio/wav", data: b64(wav) } }, { text: prompt }] }],
      generationConfig: { temperature: 0, ...(json ? { responseMimeType: "application/json" } : {}) },
    }),
  });
  if (!res.ok) throw new Error(`Gemini 3.5 Flash: HTTP ${res.status}`);
  const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

export async function roughStarts(apiKey: string, wav: Uint8Array, texts: string[], fetchImpl: typeof fetch = fetch): Promise<number[]> {
  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const text = await ask(apiKey, wav, `This recording speaks these lines in order:\n${numbered}\n\nFor each line give the time in seconds where it begins. Answer only JSON: {"starts": [0.0, ...]} with one number per line.`, true, fetchImpl);
  const starts = (JSON.parse(text) as { starts?: unknown }).starts;
  if (!Array.isArray(starts) || starts.length !== texts.length) throw new Error("Gemini 3.5 Flash gave no usable line starts");
  return starts.map(Number);
}

export async function transcribe(apiKey: string, wav: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<string> {
  return (await ask(apiKey, wav, "Transcribe this clip exactly, word for word, including any partial word at its very start or end. Answer only the words.", false, fetchImpl)).trim();
}

const NUM: Record<string, string> = { "210": "two hundred and ten", "200": "two hundred", "50": "fifty", "1984": "nineteen eighty four" };
function words(s: string): string[] {
  let t = s.toLowerCase().replace(/['’]/g, "");
  t = t.replace(/\d+/g, (n) => NUM[n] ?? n);
  return t.replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

export function edgesMatch(heard: string, line: string): boolean {
  const h = words(heard);
  const x = words(line);
  if (h.length < 2 || x.length < 2) return h.join(" ") === x.join(" ");
  return h.slice(0, 2).join(" ") === x.slice(0, 2).join(" ") && h.slice(-2).join(" ") === x.slice(-2).join(" ");
}

export async function splitTake(
  apiKey: string,
  take: { samples: Int16Array; rate: number },
  texts: string[],
  opts: { fetchImpl?: typeof fetch; moves?: number } = {},
): Promise<Array<{ text: string; clip?: { samples: Int16Array; pauseBefore: number }; problem?: "edges" | "missing" }>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const duration = take.samples.length / take.rate;
  const gaps = pauses(take.samples, take.rate);
  const rough = await roughStarts(apiKey, pcmWav(take.samples, take.rate), texts, fetchImpl);
  const cuts = snapCuts(rough, gaps, duration);
  const result: Array<{ text: string; clip?: { samples: Int16Array; pauseBefore: number }; problem?: "edges" | "missing" }> = [];
  const real = texts.length - 1; // the spare is last
  for (let i = 0; i < real; i++) {
    let ok = false;
    let clip: { samples: Int16Array; pauseBefore: number } | undefined;
    for (let move = 0; move <= (opts.moves ?? 3) && !ok; move++) {
      clip = tightClips(take.samples, take.rate, cuts)[i];
      if (!clip) break;
      const heard = await transcribe(apiKey, pcmWav(clip.samples, take.rate), fetchImpl);
      ok = edgesMatch(heard, texts[i]);
      if (ok) break;
      // the start is wrong: move this line's start cut one pause earlier; the end is wrong: the next cut one pause later
      const h = words(heard);
      const x = words(texts[i]);
      const startWrong = h.slice(0, 2).join(" ") !== x.slice(0, 2).join(" ");
      const c = startWrong ? i - 1 : i;
      if (c < 0 || c >= cuts.length) break;
      const sorted = gaps.map((g) => (g.start + g.end) / 2).sort((p, q) => p - q);
      const at = sorted.findIndex((m) => Math.abs(m - cuts[c]) < 0.01);
      const next = startWrong ? sorted[at - 1] : sorted[at + 1];
      if (next === undefined || (c > 0 && next <= cuts[c - 1]) || (c + 1 < cuts.length && next >= cuts[c + 1])) break;
      cuts[c] = next;
    }
    result.push(ok && clip ? { text: texts[i], clip } : { text: texts[i], problem: clip ? "edges" : "missing" });
  }
  return result;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/gemini-align.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/export/gemini-align.ts tests/gemini-align.test.ts && git commit -m "Split a conversation take: rough starts, snapped cuts, every clip checked alone"`

### Task 13: The conversation take in the bake

**Files:**
- Modify: `src/export/gemini-batch.ts` (add `batchConversations`)
- Test: `tests/gemini-batch.test.ts` (append, with `splitTake` injected)

**Interfaces:**
- Consumes: `buildStretches`, `conversationRequest`, `submitBatch`, `pollBatch`, `jobsOf`, `splitTake`, `pcmToMp3Base64`, `wavPcm`, `pcmMs`, `takeOf`.
- Produces:
  - `batchConversations(apiKey, voices, lang, playlist, todo: SpeakLine[], opts?: { fetchImpl?; sleep?; onState?; timeoutMs?; onSubmitted?; resume?; split?: typeof splitTake }): Promise<Map<string, { mp3: string; ms: number; pause: number }>>` — stretches are built from ALL of the cast's Gemini lines (`include = isGeminiLine`), and only the stretches holding at least one `todo` line are recorded — **whole**, so the map also holds clips for their unchanged lines (the bake replaces those, Task 2). A stretch's clips that fail the check are left out (the bake then records the `todo` ones among them one by one through `synthesize` — the single-line Gemini path).

- [ ] **Step 1: Write the failing test** — fake fetch answering one stretch job with a WAV; inject `split` returning two clips and one `problem: "edges"`; expect the map to hold the two keys with `pause` and not the third.

```ts
test("batchConversations: one request per stretch; checked clips stored with their pause; failed ones left for the single-line path", async () => {
  const { batchConversations } = await import("../src/export/gemini-batch");
  const { parsePlaylistText } = await import("../src/playlist/playlist");
  const pl = parsePlaylistText('# T\n\n## P\n    text t "x" x 500 y 400\n    draw t\n      speak "One." voice a\n    draw t\n      speak "Two." voice b\n    draw t\n      speak "Three." voice a\n');
  const voices = { "@a": "gemini:Charon", "@b": "gemini:Puck" };
  const todo = [{ text: "One.", speaker: "a" as const }, { text: "Two.", speaker: "b" as const }, { text: "Three.", speaker: "a" as const }];
  const audio = Buffer.from(wav(24000)).toString("base64");
  const fetchImpl = (async (_u: string, init?: any) =>
    init?.method === "POST"
      ? new Response(JSON.stringify({ name: "batches/c1" }), { status: 200 })
      : new Response(JSON.stringify({ done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" }, response: { inlinedResponses: { inlinedResponses: [{ metadata: { key: "stretch-0" }, response: { candidates: [{ content: { parts: [{ inlineData: { data: audio } }] } }] } }] } } }), { status: 200 })) as unknown as typeof fetch;
  const clip = (n: number) => ({ samples: new Int16Array(n), pauseBefore: 0.3 });
  const split = async () => [{ text: "One.", clip: clip(2400) }, { text: "Two.", clip: clip(2400) }, { text: "Three.", problem: "edges" as const }];
  const out = await batchConversations("KEY", voices, "en", pl, todo, { fetchImpl, sleep: async () => {}, split });
  expect([...out.keys()].sort()).toEqual(["|a||One.", "|b||Two."]);
  expect(out.get("|b||Two.")!.pause).toBe(0.3);
});
```

(Adjust the key strings if the title card adds a line; keys are `speechKey` of each line.)

- [ ] **Step 2: Run test to verify it fails** — FAIL (not exported).

- [ ] **Step 3: Implement**

```ts
import { buildStretches, SPARE_LINE } from "./stretches";
import { splitTake } from "./gemini-align";
import type { Playlist } from "../playlist/playlist";

export async function batchConversations(
  apiKey: string,
  voices: Record<string, string>,
  lang: string | undefined,
  playlist: Playlist,
  todo: SpeakLine[],
  opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; onState?: (s: string) => void; timeoutMs?: number; onSubmitted?: (names: string[]) => void; resume?: string[]; split?: typeof splitTake } = {},
): Promise<Map<string, { mp3: string; ms: number; pause: number }>> {
  const want = new Set(todo.map(speechKey));
  // Stretches over all the cast's Gemini lines; a stretch is recorded whole when any of its lines needs recording.
  const stretches = buildStretches(playlist, (l) => isGeminiLine(voices, lang, l)).filter((s) => s.lines.some((l) => want.has(speechKey(l))));
  const voiceOf = (s: "a" | "b") => geminiVoice(preferredVoice(voices, lang ?? "en", s))!;
  const reqs: BatchRequest[] = stretches.map((s) => ({ key: s.key, model: voiceOf(s.lines[0].speaker ?? "a").model, body: conversationRequest(s, voiceOf) }));
  const names = opts.resume?.length ? opts.resume : await Promise.all(jobsOf(reqs).map((job) => submitBatch(apiKey, job[0].model, job, opts.fetchImpl)));
  opts.onSubmitted?.(names);
  const takes = new Map<string, BatchResult>();
  for (const name of names) for (const [k, r] of await pollBatch(apiKey, name, opts)) takes.set(k, r);
  const split = opts.split ?? splitTake;
  const out = new Map<string, { mp3: string; ms: number; pause: number }>();
  for (const s of stretches) {
    const r = takes.get(s.key);
    if (!r || !("wav" in r)) continue;
    const pcm = wavPcm(r.wav);
    const pieces = await split(apiKey, pcm, [...s.lines.map((l) => l.text), SPARE_LINE], { fetchImpl: opts.fetchImpl });
    for (const [i, p] of pieces.entries()) {
      if (!p.clip) continue;
      const clipPcm = { samples: p.clip.samples, rate: pcm.rate, channels: 1 };
      out.set(speechKey(s.lines[i]), { mp3: await pcmToMp3Base64(clipPcm), ms: pcmMs(clipPcm), pause: Math.round(p.clip.pauseBefore * 100) / 100 });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/gemini-batch.test.ts && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5: Commit** — `git add src/export/gemini-batch.ts tests/gemini-batch.test.ts && git commit -m "Gemini batch: conversation takes per stretch, split and checked into clips"`

### Task 14: Use the take in the script and the app

**Files:**
- Modify: `scripts/bake-narration.mjs`, `src/main.ts`

- [ ] **Step 1:** In both `synthesizeMany` functions (Tasks 6 and 7), choose by take:

```js
const conversation = takeOf(playlist.meta.voices) === "conversation";
const map = conversation
  ? await batchConversations(key, voices, declaredLang, playlist, todo, sharedOpts)
  : await batchLines(key, voices, declaredLang, todo, sharedOpts);
```

(`playlist` is `source` in main.ts.) Lines the conversation path leaves out fall back to `synthesize` — the single-line Gemini path (`synthesizeBase64`), as the bake already does.

- [ ] **Step 2: Record Rome as conversations**

```bash
cp dev-casts/publish/fall-of-rome/fall-of-rome.cast dev-casts/compare/rome-batch-conversation.cast
node scripts/bake-narration.mjs --apply dev-casts/compare/rome-batch-conversation.cast --a "gemini:Charon | a dry, warm historian with a twinkle, telling a good story, at a natural, lively podcast pace" --b "gemini:Puck | a cheerful, cheeky sceptic, amused and curious, at a natural, lively podcast pace" --take conversation > /tmp/rome-conv.log 2>&1
```

Expected: `… 71 clips`; `grep -c "pause:" dev-casts/compare/rome-batch-conversation.cast` > 50; the log lists any lines re-recorded singly.

- [ ] **Step 3: Commit** — `git add scripts/bake-narration.mjs src/main.ts && git commit -m "Gemini voices recorded as conversations by default; take: lines records line by line"`

### Task 15: The recorded pause as the breath before a line

**Files:**
- Modify: `src/render/inline-clips.ts` (`Clip` gains `pause?`), `src/render/published-speech.ts` (`ClipSource.pauseBefore?(key)`, `PublishedSpeech.pauseBefore(text, opts)`), `src/render/breath.ts` (`breathAfterMs` takes an optional `pauseOf(step)`), `src/render/player.ts` (pass it)
- Test: `tests/breath.test.ts`, `tests/published-speech.test.ts` (append)

**Interfaces:**
- Produces:
  - `ClipSource.pauseBefore?(key: string): number | undefined`
  - `PublishedSpeech.pauseBefore(text: string, opts?: SpeakOpts): number | undefined` (uses the same `speechKey` as `speakOne`)
  - `breathAfterMs(steps, index, pauseOf?: (next: PlanStep) => number | undefined): number` — when the next step is a blocking `speak` and `pauseOf(next)` is a number, return `pauseOf(next) * 1000`; every other rule unchanged (a following `pause` → 0, viewer turn → section breath).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/breath.test.ts (append)
test("a recorded pause before the next line is the breath, only between two spoken lines", () => {
  const steps = [{ kind: "speak", text: "One.", blocking: true }, { kind: "speak", text: "Two.", blocking: true }, { kind: "quiz" }] as any;
  const pauseOf = (s: any) => (s.text === "Two." ? 0.62 : undefined);
  expect(breathAfterMs(steps, 0, pauseOf)).toBe(620);
  expect(breathAfterMs(steps, 1, pauseOf)).toBe(BREATH_MS.section);
  expect(breathAfterMs(steps, 0)).toBe(BREATH_MS.beat);
});
```

```ts
// tests/published-speech.test.ts (append)
test("pauseBefore reads a baked clip's recorded pause", () => {
  const clips = { has: () => true, play: async () => {}, stop() {}, setMuted() {}, pauseBefore: (k: string) => (k === "|b||Two." ? 0.4 : undefined) };
  const ps = new PublishedSpeech(new InnerSpeech(), clips as any);
  expect(ps.pauseBefore("Two.", { speaker: "b" })).toBe(0.4);
  expect(ps.pauseBefore("One.", { speaker: "a" })).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run tests/breath.test.ts tests/published-speech.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`breath.ts`:

```ts
export function breathAfterMs(steps: readonly PlanStep[], index: number, pauseOf?: (next: PlanStep) => number | undefined): number {
  const step = steps[index];
  if (!step) return 0;
  const text = spokenText(step);
  if (text === null) return 0;
  let n = index + 1;
  while (steps[n]?.kind === "mark" && (steps[n] as { parallel?: true }).parallel) n++;
  const next = steps[n];
  if (next?.kind === "pause") return 0;
  if (!next || SECTION_NEXT.has(next.kind)) return BREATH_MS.section;
  // A conversation take's own pause before the next line (2026-10-08), when it has one.
  if (next.kind === "speak" && (next as { blocking?: boolean }).blocking) {
    const p = pauseOf?.(next);
    if (typeof p === "number") return Math.round(p * 1000);
  }
  if (/[?？]\s*$/.test(text)) return BREATH_MS.question;
  return BREATH_MS.beat;
}
```

`inline-clips.ts`: in `inlineClipIndex`, copy `pause` into each `Clip` (`{ bytes, ms, ...(typeof line.pause === "number" ? { pause: line.pause } : {}) }`) and add to the returned source `pauseBefore: (key) => index.get(key)?.pause`.

`published-speech.ts`: add `pauseBefore?(key: string): number | undefined;` to `ClipSource`, and

```ts
  /** A baked clip's recorded pause before it (a conversation take), if it has one. */
  pauseBefore(text: string, opts?: SpeakOpts): number | undefined {
    if (this.forceBrowser) return undefined;
    return this.clips.pauseBefore?.(speechKey({ text, speaker: opts?.speaker, delivery: opts?.delivery, gender: opts?.gender, lang: opts?.lang }));
  }
```

`player.ts` (run loop at ~913-937): replace `breathAfterMs(this.plan.steps, this.completed)` with

```ts
breathAfterMs(this.plan.steps, this.completed, (next) => {
  const sp = this.speech as { pauseBefore?: (t: string, o?: SpeakOpts) => number | undefined };
  if (next.kind !== "speak" || !sp.pauseBefore) return undefined;
  const s = next as { text: string; speaker?: "a" | "b"; delivery?: Delivery };
  return sp.pauseBefore(this.spokenLine(s.text), { speaker: s.speaker, delivery: s.delivery, gender: this.narratorGender ?? undefined });
})
```

(import `SpeakOpts`, `Delivery` types from `./delivery` if not already).

- [ ] **Step 4: Run tests** — `npx vitest run tests/breath.test.ts tests/published-speech.test.ts tests/baked-audio.test.ts && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5: Commit** — `git add src/render/breath.ts src/render/inline-clips.ts src/render/published-speech.ts src/render/player.ts tests/breath.test.ts tests/published-speech.test.ts && git commit -m "The player breathes a conversation take's own pause between two spoken lines"`

### Task 16: End-to-end listening check, docs, and the full suite

- [ ] **Step 1:** `npx vitest run` — all pass; `npx vite build` — builds.
- [ ] **Step 2:** Open `dev-casts/compare/rome-batch-conversation.cast` in the player (dev server, as in Task 7) and play the first page; confirm the gaps follow the take (no long uniform beats between quick replies) and drawings still start with their lines.
- [ ] **Step 3:** SKILL.md / publish.md: "`take: conversation` (default) records each stretch as a conversation and cuts it into lines, checking every clip; failed lines are recorded on their own."
- [ ] **Step 4:** Ask Hans to listen: Rome as conversation vs Rome line by line through batch, in the player.
- [ ] **Step 5: Commit** — `git add -A .claude/skills/drawcast && git commit -m "Skill: Gemini conversations through batch"`

---

## Not in this plan (from the spec)

- **Deviation, for Hans to confirm:** the spec's "app publish fills the narration in afterwards". In this plan the app's publish **waits in the dialog** (2–5 min, with the job's state shown); a background fill-in (publish at once, re-publish with the clips when the job is done, resumed on the next open) is a follow-up plan once Step B is proven. The script already resumes.
- Per-line tone notes; a "record narration now" editor button; overlapping reactions.
