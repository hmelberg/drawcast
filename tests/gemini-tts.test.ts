// Gemini TTS and a cast's own voices (2026-10-07).
import { describe, expect, test } from "vitest";
import { audioOf, castVoiceMap, geminiRequestBody, geminiSynthesizeBase64, geminiVoice, lineStyle, readCastVoices, wavPcm, withCastVoices } from "../src/export/gemini-tts";
import { narrationVoice, preferredVoice, stampedVoice, clipCacheKey, isUsableVoice } from "../src/export/tts";
import { bakeCost, OWN_KEY_PRICE_PER_MILLION, voiceTier } from "../src/export/tts-cost";
import { formatPlaylist, parsePlaylistText } from "../src/playlist/playlist";

/** A tiny RIFF WAV: 24 kHz mono 16-bit, `n` samples of a sine. */
function wav(n = 2400): Uint8Array {
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 24000));
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const w = (o: number, s: string): void => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE");
  w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 24000, true); dv.setUint32(28, 48000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(data);
  return new Uint8Array(buf);
}

describe("voice specs", () => {
  test("gemini:<Voice> and gemini-lite:<Voice>, with a style after |; anything else is not a Gemini voice", () => {
    expect(geminiVoice("gemini:Charon | dry, warm")).toEqual({ model: "gemini-3.8-flash-tts", voice: "Charon", style: "dry, warm" });
    expect(geminiVoice("gemini-lite:puck")).toEqual({ model: "gemini-3.8-flash-lite-tts", voice: "Puck" });
    expect(geminiVoice("gemini:Nobody")).toBeNull();
    expect(geminiVoice("en-US-Studio-O")).toBeNull();
    expect(isUsableVoice("gemini:Kore")).toBe(true);
    expect(isUsableVoice("en-US-Studio-O | cheerful")).toBe(true);
  });
  test("a line's direction: the speaker's style, then its delivery", () => {
    expect(lineStyle("dry, warm", "grave")).toBe("dry, warm; slowly and gravely");
    expect(lineStyle(undefined, undefined)).toBeUndefined();
  });
  test("the request carries the model, the voice and the style; the answer's audio is found", () => {
    const body = geminiRequestBody({ model: "gemini-3.8-flash-tts", voice: "Puck", style: "cheerful" }, "Hello") as any;
    expect(body.model).toBe("gemini-3.8-flash-tts");
    expect(body.generation_config.speech_config).toEqual([{ voice: "Puck" }]);
    expect(body.input[0].content[0].annotations).toEqual([{ type: "speech_metadata", style: "cheerful" }]);
    expect(audioOf({ steps: [{ content: [{ type: "text" }, { data: "QUJD" }] }] })).toBe("QUJD");
    expect(audioOf({})).toBeNull();
  });
  test("the WAV is read and encoded to MP3", async () => {
    expect(wavPcm(wav(100)).samples.length).toBe(100);
    const fetchImpl = (async () => new Response(JSON.stringify({ steps: [{ content: [{ data: Buffer.from(wav()).toString("base64") }] }] }), { status: 200 })) as typeof fetch;
    const mp3 = Buffer.from(await geminiSynthesizeBase64("KEY", { model: "gemini-3.8-flash-tts", voice: "Puck" }, "Hi", undefined, fetchImpl), "base64");
    // an MP3 frame sync (0xFFE…) near the start
    expect(mp3.length).toBeGreaterThan(100);
    expect([...mp3.subarray(0, 4)].some((b, i) => b === 0xff && (mp3[i + 1] & 0xe0) === 0xe0)).toBe(true);
  });
  test("a Gemini line uses its own key: the config's, else the app's, else the Cloud key", async () => {
    const { geminiKeyFor, setGeminiKeySource } = await import("../src/export/gemini-tts");
    expect(geminiKeyFor({ apiKey: "CLOUD", geminiKey: "GEM" })).toBe("GEM");
    setGeminiKeySource(() => "APP");
    expect(geminiKeyFor({ apiKey: "CLOUD" })).toBe("APP");
    setGeminiKeySource(() => "");
    expect(geminiKeyFor({ apiKey: "CLOUD" })).toBe("CLOUD");
  });
  test("a rate limit is waited out and retried, as long as the answer says", async () => {
    let calls = 0;
    const waits: number[] = [];
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: "Rate limit exceeded. Please retry in 3s." } }), { status: 429 });
      return new Response(JSON.stringify({ steps: [{ content: [{ data: Buffer.from(wav()).toString("base64") }] }] }), { status: 200 });
    }) as typeof fetch;
    const mp3 = await geminiSynthesizeBase64("KEY", { model: "m", voice: "Puck" }, "Hi", undefined, fetchImpl, async (ms) => void waits.push(ms));
    expect(calls).toBe(2);
    expect(waits).toEqual([4000]);
    expect(mp3.length).toBeGreaterThan(10);
  });
  test("a refused key says what to enable", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "blocked" } }), { status: 403 })) as typeof fetch;
    await expect(geminiSynthesizeBase64("KEY", { model: "m", voice: "Puck" }, "Hi", undefined, fetchImpl)).rejects.toThrow(/Gemini API/);
  });
});

describe("a cast's own voices", () => {
  const voices = withCastVoices({ en: "en-US-Studio-Q" }, { a: "gemini:Charon | dry", b: "en-US-Studio-O" });
  test("the header reads to a and b; the map carries them as @a and @b", () => {
    expect(readCastVoices({ a: " gemini:Charon | dry ", b: 3 })).toEqual({ a: "gemini:Charon | dry" });
    expect(readCastVoices("gemini:Puck")).toEqual({ a: "gemini:Puck" });
    expect(readCastVoices({})).toBeUndefined();
    expect(castVoiceMap({ a: "x", b: "y" })).toEqual({ "@a": "x", "@b": "y" });
  });
  test("each speaker gets its own voice, and the stamp carries it (style too), so a change re-records", () => {
    expect(preferredVoice(voices, "en", "a")).toBe("gemini:Charon | dry");
    expect(narrationVoice(voices, "en", { speaker: "a" }).name).toBe("gemini:Charon | dry");
    expect(narrationVoice(voices, "en", { speaker: "b" }).name).toBe("en-US-Studio-O");
    expect(stampedVoice(voices, "en", { speaker: "b" })).toBe("en-US-Studio-O");
    expect(clipCacheKey(1, voices, { text: "Hi", speaker: "a" })).not.toBe(clipCacheKey(1, withCastVoices({}, { a: "gemini:Charon | wet" }), { text: "Hi", speaker: "a" }));
  });
  test("a Cloud voice keeps to its own language; a Gemini voice speaks any", () => {
    expect(preferredVoice(voices, "de", "b")).toBeUndefined();
    expect(preferredVoice(voices, "de", "a")).toBe("gemini:Charon | dry");
  });
  test("Gemini lines are priced at the Gemini tier", () => {
    expect(voiceTier("gemini:Charon")).toBe("gemini");
    const c = bakeCost([{ text: "hello there, plain english words", speaker: "a" }], voices);
    expect(c.usd).toBeCloseTo((c.chars * OWN_KEY_PRICE_PER_MILLION.gemini) / 1_000_000, 6);
  });
  test("the header survives the cast file, YAML and script alike", () => {
    const text = '# T\nvoices: {"a": "gemini:Charon | dry, warm", "b": "en-US-Studio-O"}\n\n## T\nuse: bar_chart\n';
    const p = parsePlaylistText(text);
    expect(p.meta.voices).toEqual({ a: "gemini:Charon | dry, warm", b: "en-US-Studio-O" });
    expect(parsePlaylistText(formatPlaylist(p, "script")).meta.voices).toEqual(p.meta.voices);
    expect(parsePlaylistText(formatPlaylist(p, "yaml")).meta.voices).toEqual(p.meta.voices);
  });
});
