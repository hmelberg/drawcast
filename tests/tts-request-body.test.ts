// Task 4 (registry deliveries 3-4): ttsRequestBody was pulled out of
// synthesizeBase64 so the credit synthesizer (src/credit.ts) can build the
// SAME Google text:synthesize body and hand it to the server — the server
// validates and prices a line by that exact shape (server task 3). This test
// pins byte-identical behaviour: whatever synthesizeBase64 actually sends to
// Google, ttsRequestBody must produce from the same inputs, for
// representative cases across voice families, delivery, rate and gender.

import { describe, expect, test } from "vitest";
import { synthesizeBase64, ttsRequestBody, type TtsConfig } from "../src/export/tts";
import type { SpeakOpts } from "../src/render/delivery";

async function sentBodyOf(cfg: TtsConfig, text: string, opts?: SpeakOpts): Promise<unknown> {
  const g = globalThis as unknown as { fetch: unknown };
  const original = g.fetch;
  let sent: unknown;
  g.fetch = async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ audioContent: "AAA" }) };
  };
  try {
    await synthesizeBase64(cfg, text, opts);
  } finally {
    g.fetch = original;
  }
  return sent;
}

describe("ttsRequestBody — byte-identical to what synthesizeBase64 actually sends", () => {
  const cases: { name: string; cfg: TtsConfig; text: string; opts?: SpeakOpts }[] = [
    { name: "the default English narrator, no delivery", cfg: { apiKey: "K", rate: 1 }, text: "Hello there." },
    {
      name: "a Norwegian per-language pick, grave delivery",
      cfg: { apiKey: "K", rate: 1, voices: { nb: "nb-NO-Wavenet-E" }, lang: "nb" },
      text: "Vi ser på tallene.",
      opts: { delivery: "grave" },
    },
    {
      name: "a Chirp voice (no pitch/gain, capped rate), brisk delivery",
      cfg: { apiKey: "K", rate: 1.5, voices: { nb: "nb-NO-Chirp3-HD-Charon" }, lang: "nb" },
      text: "Vi ser på tallene.",
      opts: { delivery: "brisk" },
    },
    {
      name: "a Studio voice with an authored gender",
      cfg: { apiKey: "K", rate: 0.9 },
      text: "Hello there.",
      opts: { gender: "female" },
    },
    {
      name: "a dialogue speaker b (gendered-table default, not the per-language pick)",
      cfg: { apiKey: "K", rate: 1, voices: { en: "en-GB-Neural2-A" } },
      text: "Hello there.",
      opts: { speaker: "b" },
    },
    {
      name: "an edited rate, no delivery",
      cfg: { apiKey: "K", rate: 1.2 },
      text: "Hello there.",
    },
  ];

  test.each(cases)("$name", async ({ cfg, text, opts }) => {
    const sent = await sentBodyOf(cfg, text, opts);
    expect(ttsRequestBody(cfg, text, opts)).toEqual(sent);
  });

  test("withName=false matches synthesizeBase64's own 400-retry body (an unrecognised default voice name dropped)", async () => {
    const g = globalThis as unknown as { fetch: unknown };
    const original = g.fetch;
    let call = 0;
    let secondSent: unknown;
    g.fetch = async (_url: string, init: { body: string }) => {
      call++;
      if (call === 1) return { ok: false, status: 400, json: async () => ({ error: { message: "bad voice" } }) };
      secondSent = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ audioContent: "AAA" }) };
    };
    const cfg: TtsConfig = { apiKey: "K", rate: 1 };
    try {
      await synthesizeBase64(cfg, "Hello there.");
    } finally {
      g.fetch = original;
    }
    expect(ttsRequestBody(cfg, "Hello there.", undefined, false)).toEqual(secondSent);
  });
});
