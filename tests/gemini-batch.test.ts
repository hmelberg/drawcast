import { describe, expect, test } from "vitest";
import { BatchJobError, batchLines, isGeminiLine, isTimedOutJob, isUnusableJob, jobsOf, lineRequest, pollBatch, submitBatch } from "../src/export/gemini-batch";
import { speechKey } from "../src/render/delivery";

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

  test("poll throws on top-level batch error", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "Request rate limit exceeded" } }), { status: 200 })) as unknown as typeof fetch;
    await expect(pollBatch("KEY", "batches/abc", { fetchImpl })).rejects.toThrow(/batches\/abc failed.*Request rate limit exceeded/);
  });

  test("poll throws on finished with no results", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ done: true }), { status: 200 })) as unknown as typeof fetch;
    await expect(pollBatch("KEY", "batches/abc", { fetchImpl })).rejects.toThrow(/batches\/abc finished with no results/);
  });

  test("poll retries 5xx once then succeeds", async () => {
    const audio = Buffer.from(wav()).toString("base64");
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 503 });
      return new Response(JSON.stringify({
        name: "batches/abc", done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" },
        response: { inlinedResponses: { inlinedResponses: [
          { metadata: { key: "k1" }, response: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: audio } }] } }] } },
        ] } },
      }), { status: 200 });
    }) as unknown as typeof fetch;
    let sleepCalls = 0;
    const out = await pollBatch("KEY", "batches/abc", { fetchImpl, sleep: async () => void sleepCalls++ });
    expect(calls).toBe(2);
    expect(sleepCalls).toBe(1);
    expect((out.get("k1") as { wav: Uint8Array }).wav.length).toBe(44 + 4800);
  });

  test("poll rejects after 3 persistent 5xx responses", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "Service Unavailable" } }), { status: 503 });
    }) as unknown as typeof fetch;
    let sleepCalls = 0;
    await expect(pollBatch("KEY", "batches/abc", { fetchImpl, sleep: async () => void sleepCalls++ })).rejects.toThrow(/Gemini batch poll.*Service Unavailable/);
    expect(calls).toBe(3);
    expect(sleepCalls).toBe(2);
  });

  test("poll rejects after 3 persistent network errors", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      throw new Error("Network timeout");
    }) as unknown as typeof fetch;
    let sleepCalls = 0;
    await expect(pollBatch("KEY", "batches/abc", { fetchImpl, sleep: async () => void sleepCalls++ })).rejects.toThrow("Network timeout");
    expect(calls).toBe(3);
    expect(sleepCalls).toBe(2);
  });
});

test("batchLines: one job for the Gemini lines, each answer that line's MP3, failures left out", async () => {
  const voices = { "@a": "gemini:Charon | dry", "@b": "gemini:Puck" };
  const lines = [{ text: "One.", speaker: "a" as const }, { text: "Two.", speaker: "b" as const }];
  const audio = Buffer.from(wav()).toString("base64");
  const sent: any[] = [];
  const fetchImpl = (async (_url: string, init?: any) => {
    if (init?.method === "POST") {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ name: "batches/j1" }), { status: 200 });
    }
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

test("batchLines sends the SAYABLE text, as the single-line path does (QALY said 'qualy'), keyed by the written line", async () => {
  const voices = { "@a": "gemini:Charon" };
  const line = { text: "Each QALY costs less than the ICER says.", speaker: "a" as const };
  const sent: any[] = [];
  const fetchImpl = (async (_url: string, init?: any) => {
    if (init?.method === "POST") {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ name: "batches/j1" }), { status: 200 });
    }
    return new Response(JSON.stringify({ done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" }, response: { inlinedResponses: { inlinedResponses: [] } } }), { status: 200 });
  }) as unknown as typeof fetch;
  await batchLines("KEY", voices, "en", [line], { fetchImpl, sleep: async () => {} });
  const req = sent[0].batch.input_config.requests.requests[0];
  expect(req.request.contents[0].parts[0].text).toBe("Each qualy costs less than the iceer says.");
  expect(req.metadata.key).toBe(speechKey(line));
});

describe("a job that can never answer is told apart from a passing failure (final review 4)", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const kindOf = async (p: Promise<unknown>) => p.then(() => "resolved", (e) => (isUnusableJob(e) ? "unusable" : isTimedOutJob(e) ? "timeout" : e instanceof BatchJobError ? "other-batch" : "transient"));

  test.each(["BATCH_STATE_EXPIRED", "BATCH_STATE_FAILED", "BATCH_STATE_CANCELLED"])("%s is unusable", async (state) => {
    const fetchImpl = (async () => json({ done: true, metadata: { state } })) as unknown as typeof fetch;
    expect(await kindOf(pollBatch("KEY", "batches/abc", { fetchImpl }))).toBe("unusable");
  });

  test.each([404, 403, 400])("a %i poll is unusable, with the job's name", async (status) => {
    const fetchImpl = (async () => json({ error: { message: "gone" } }, status)) as unknown as typeof fetch;
    const err = await pollBatch("KEY", "batches/abc", { fetchImpl }).catch((e) => e);
    expect(isUnusableJob(err)).toBe(true);
    expect(err.job).toBe("batches/abc");
  });

  test("a timeout, 429, 5xx after retries and network errors are not unusable", async () => {
    const running = (async () => json({ metadata: { state: "BATCH_STATE_RUNNING" } })) as unknown as typeof fetch;
    expect(await kindOf(pollBatch("KEY", "b", { fetchImpl: running, sleep: async () => {}, timeoutMs: 1 }))).toBe("timeout");
    const busy = (async () => json({ error: { message: "slow down" } }, 429)) as unknown as typeof fetch;
    expect(await kindOf(pollBatch("KEY", "b", { fetchImpl: busy, sleep: async () => {} }))).toBe("transient");
    const down = (async () => json({ error: { message: "down" } }, 503)) as unknown as typeof fetch;
    expect(await kindOf(pollBatch("KEY", "b", { fetchImpl: down, sleep: async () => {} }))).toBe("transient");
    const offline = (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await kindOf(pollBatch("KEY", "b", { fetchImpl: offline, sleep: async () => {} }))).toBe("transient");
  });

  test("resuming an expired job falls through to a fresh submission in the same run", async () => {
    const voices = { "@a": "gemini:Charon" };
    const lines = [{ text: "One.", speaker: "a" as const }, { text: "Two.", speaker: "a" as const }];
    const audio = Buffer.from(wav()).toString("base64");
    const posts: any[] = [];
    const fetchImpl = (async (url: string, init?: any) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(init.body));
        return json({ name: "batches/fresh" });
      }
      if (String(url).endsWith("batches/old")) return json({ done: true, metadata: { state: "BATCH_STATE_EXPIRED" } });
      const reqs = posts[0].batch.input_config.requests.requests;
      return json({
        done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" },
        response: { inlinedResponses: { inlinedResponses: reqs.map((r: any) => ({ metadata: r.metadata, response: { candidates: [{ content: { parts: [{ inlineData: { data: audio } }] } }] } })) } },
      });
    }) as unknown as typeof fetch;
    const submitted: string[][] = [];
    const gone: string[] = [];
    const out = await batchLines("KEY", voices, "en", lines, {
      fetchImpl, sleep: async () => {}, resume: ["batches/old"],
      onSubmitted: (n) => submitted.push(n), onResumeGone: (e) => gone.push(e.job),
    });
    expect(gone).toEqual(["batches/old"]);
    expect(submitted).toEqual([["batches/old"], ["batches/fresh"]]);
    expect(posts).toHaveLength(1);
    expect(posts[0].batch.input_config.requests.requests).toHaveLength(2);
    expect([...out.keys()].sort()).toEqual(lines.map(speechKey).sort());
  });

  test("a freshly submitted job that ends unusable is not resubmitted again and again", async () => {
    let posts = 0;
    const fetchImpl = (async (_url: string, init?: any) => {
      if (init?.method === "POST") return (posts++, json({ name: "batches/new" }));
      return json({ done: true, metadata: { state: "BATCH_STATE_FAILED" } });
    }) as unknown as typeof fetch;
    const err = await batchLines("KEY", { "@a": "gemini:Charon" }, "en", [{ text: "One.", speaker: "a" }], { fetchImpl, sleep: async () => {} }).catch((e) => e);
    expect(isUnusableJob(err)).toBe(true);
    expect(posts).toBe(1);
  });

  test("the bake script drops the sidecar on an unusable job and keeps it on a timeout", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../scripts/bake-narration.mjs", import.meta.url), "utf8");
    expect(src).toMatch(/onResumeGone:[\s\S]{0,120}unlinkSync\(sidecar\)/);
    expect(src).toMatch(/kind === "unusable"\)\s*\{\s*if \(existsSync\(sidecar\)\) unlinkSync\(sidecar\)/);
  });
});

test("isGeminiLine: a line with a language mark is not a whole-line Gemini request", () => {
  const voices = { "@a": "gemini:Charon" };
  expect(isGeminiLine(voices, "en", { text: "Say [de:Guten Tag] now", speaker: "a" })).toBe(false);
  expect(isGeminiLine(voices, "en", { text: "Say hello now", speaker: "a" })).toBe(true);
  expect(isGeminiLine({ "@a": "en-US-Neural2-D" }, "en", { text: "Plain", speaker: "a" })).toBe(false);
});
