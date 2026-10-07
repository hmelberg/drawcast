// Gemini TTS (Hans 2026-10-07): Google's Gemini 3.8 Flash TTS voices, which
// take a spoken-style direction ("dry, warm historian") per line. A cast
// names them in its `voices:` header as `gemini:Charon | dry, warm historian`
// (playlist meta; castVoiceMap below). Each line is still one request and
// one clip, so the drawing keeps its sync and the clip store its keys. The
// API answers WAV (24 kHz, mono, 16-bit); drawcast stores MP3, so the WAV is
// encoded here (lamejs, loaded only when a Gemini voice speaks).

/** The models, by the prefix a voice spec carries. */
export const GEMINI_MODELS: Record<string, string> = {
  gemini: "gemini-3.8-flash-tts",
  "gemini-lite": "gemini-3.8-flash-lite-tts",
};

/** The prebuilt voices and Google's one-word character for each. */
export const GEMINI_VOICES: ReadonlyArray<{ name: string; note: string }> = [
  { name: "Zephyr", note: "bright" }, { name: "Puck", note: "upbeat" }, { name: "Charon", note: "informative" },
  { name: "Kore", note: "firm" }, { name: "Fenrir", note: "excitable" }, { name: "Leda", note: "youthful" },
  { name: "Orus", note: "firm" }, { name: "Aoede", note: "breezy" }, { name: "Callirrhoe", note: "easy-going" },
  { name: "Autonoe", note: "bright" }, { name: "Enceladus", note: "breathy" }, { name: "Iapetus", note: "clear" },
  { name: "Umbriel", note: "easy-going" }, { name: "Algieba", note: "smooth" }, { name: "Despina", note: "smooth" },
  { name: "Erinome", note: "clear" }, { name: "Algenib", note: "gravelly" }, { name: "Rasalgethi", note: "informative" },
  { name: "Laomedeia", note: "upbeat" }, { name: "Achernar", note: "soft" }, { name: "Alnilam", note: "firm" },
  { name: "Schedar", note: "even" }, { name: "Gacrux", note: "mature" }, { name: "Pulcherrima", note: "forward" },
  { name: "Achird", note: "friendly" }, { name: "Zubenelgenubi", note: "casual" }, { name: "Vindemiatrix", note: "gentle" },
  { name: "Sadachbia", note: "lively" }, { name: "Sadaltager", note: "knowledgeable" }, { name: "Sulafat", note: "warm" },
];

export interface GeminiVoice {
  model: string;
  voice: string;
  style?: string;
}

/** A voice spec with its style note: "gemini:Charon | dry, warm" → voice "gemini:Charon", style "dry, warm". */
export function splitVoiceSpec(spec: string): { voice: string; style?: string } {
  const i = spec.indexOf("|");
  const voice = (i < 0 ? spec : spec.slice(0, i)).trim();
  const style = i < 0 ? "" : spec.slice(i + 1).trim();
  return style ? { voice, style } : { voice };
}

/** The Gemini voice a spec names, or null for a Cloud voice. */
export function geminiVoice(spec: string | undefined): GeminiVoice | null {
  if (!spec) return null;
  const { voice, style } = splitVoiceSpec(spec);
  const m = /^(gemini(?:-lite)?):([A-Za-z]+)$/.exec(voice);
  if (!m) return null;
  const name = GEMINI_VOICES.find((v) => v.name.toLowerCase() === m[2].toLowerCase())?.name;
  if (!name) return null;
  return { model: GEMINI_MODELS[m[1]], voice: name, ...(style ? { style } : {}) };
}

/** A line's delivery (render/delivery.ts) as words the model acts on. */
export const DELIVERY_STYLE: Record<string, string> = { grave: "slowly and gravely", brisk: "briskly" };

/** The direction one line is spoken with: the speaker's style, then the line's delivery. */
export function lineStyle(style: string | undefined, delivery: string | undefined): string | undefined {
  const parts = [style, delivery ? DELIVERY_STYLE[delivery] : undefined].filter((s): s is string => !!s);
  return parts.length ? parts.join("; ") : undefined;
}

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** The request body for one line (exported for tests). */
export function geminiRequestBody(v: GeminiVoice, text: string, delivery?: string): unknown {
  const style = lineStyle(v.style, delivery);
  return {
    model: v.model,
    input: [{ type: "user_input", content: [{ type: "text", text, ...(style ? { annotations: [{ type: "speech_metadata", style }] } : {}) }] }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: v.voice }] },
  };
}

/** The audio bytes in an interactions answer: steps[].content[].data, base64. */
export function audioOf(body: unknown): string | null {
  const steps = (body as { steps?: Array<{ content?: Array<{ data?: unknown }> }> })?.steps ?? [];
  for (const s of steps) for (const c of s.content ?? []) if (typeof c.data === "string" && c.data) return c.data;
  return null;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The PCM samples and rate of a WAV (RIFF, 16-bit PCM); headerless bytes are taken as 24 kHz mono. */
export function wavPcm(bytes: Uint8Array): { samples: Int16Array; rate: number; channels: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number): string => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    const n = Math.floor(bytes.length / 2);
    return { samples: new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + n * 2)), rate: 24000, channels: 1 };
  }
  let rate = 24000;
  let channels = 1;
  let o = 12;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    if (id === "fmt ") {
      channels = dv.getUint16(o + 10, true);
      rate = dv.getUint32(o + 12, true);
    } else if (id === "data") {
      const end = Math.min(bytes.length, o + 8 + size);
      const n = Math.floor((end - (o + 8)) / 2);
      const copy = bytes.slice(o + 8, o + 8 + n * 2);
      return { samples: new Int16Array(copy.buffer), rate, channels };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error("Gemini TTS: the WAV carried no audio data");
}

/** 16-bit PCM as a base64 MP3 (mono, 64 kbit/s — speech, the size Cloud's MP3 clips are). */
export async function pcmToMp3Base64(pcm: { samples: Int16Array; rate: number; channels: number }): Promise<string> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  let mono = pcm.samples;
  if (pcm.channels === 2) {
    mono = new Int16Array(Math.floor(pcm.samples.length / 2));
    for (let i = 0; i < mono.length; i++) mono[i] = (pcm.samples[2 * i] + pcm.samples[2 * i + 1]) >> 1;
  }
  const enc = new Mp3Encoder(1, pcm.rate, 64);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < mono.length; i += 1152) {
    const chunk = enc.encodeBuffer(mono.subarray(i, i + 1152));
    if (chunk.length) parts.push(chunk);
  }
  const tail = enc.flush();
  if (tail.length) parts.push(tail);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return bytesToB64(out);
}

/** One line spoken by a Gemini voice, as base64 MP3 (what Cloud TTS returns too). */
export async function geminiSynthesizeBase64(apiKey: string, v: GeminiVoice, text: string, delivery?: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(geminiRequestBody(v, text, delivery)),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* keep the status */
    }
    if (res.status === 403 || res.status === 401) message += " — the key must be allowed to use the Gemini API (Generative Language API) for its project.";
    throw new Error(`Gemini TTS: ${message}`);
  }
  const audio = audioOf(await res.json());
  if (!audio) throw new Error("Gemini TTS: the answer carried no audio");
  return pcmToMp3Base64(wavPcm(b64ToBytes(audio)));
}

/** A cast's own voices, per speaker: "gemini:Charon | dry, warm" or a Cloud name ("en-US-Studio-O"). */
export interface CastVoices {
  a?: string;
  b?: string;
}

/** A header's `voices:` value, read: an object with a and/or b (a lone string is a's), each a short spec; undefined when it says nothing. */
export function readCastVoices(raw: unknown): CastVoices | undefined {
  const obj = typeof raw === "string" ? { a: raw } : raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!obj) return undefined;
  const out: CastVoices = {};
  for (const k of ["a", "b"] as const) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) out[k] = v.replace(/\s+/g, " ").trim().slice(0, 200);
  }
  return out.a || out.b ? out : undefined;
}

/**
 * A cast's `voices:` header (playlist meta) as entries of the per-language
 * voice map every TTS caller already passes: "@a" and "@b" (export/tts.ts
 * preferredVoice reads them first).
 */
export function castVoiceMap(voices: { a?: string; b?: string } | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (voices?.a?.trim()) out["@a"] = voices.a.trim();
  if (voices?.b?.trim()) out["@b"] = voices.b.trim();
  return out;
}

/** The author's per-language picks with a cast's own voices on top. */
export function withCastVoices(voices: Record<string, string> | undefined, cast: { a?: string; b?: string } | undefined): Record<string, string> {
  return { ...(voices ?? {}), ...castVoiceMap(cast) };
}
