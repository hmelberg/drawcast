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
