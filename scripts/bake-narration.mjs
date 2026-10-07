// Record a cast's narration into the file itself (the published copy's
// `audio:` track), with the local Google TTS key from .env — the same bake,
// voices and cost model the app's "Embed narration" uses (src/export/bake.ts,
// tts.ts, tts-cost.ts), for casts published from here rather than from the
// app (2026-10-03: the front-page library).
//
//   node scripts/bake-narration.mjs <cast.json|.yaml|.cast> [...]          estimate only (no cost)
//   node scripts/bake-narration.mjs --apply <cast> [...]                    record, and write the file back
//   … --a "gemini:Charon | dry, warm historian" --b "gemini:Puck | cheerful sceptic"
//        the cast's own voices (its `voices:` header; written into the file with --apply).
//        A voice is a Cloud name (en-US-Studio-O) or gemini:<Voice> / gemini-lite:<Voice>
//        (export/gemini-tts.ts GEMINI_VOICES), after "|" a style the Gemini voice acts on.
//        Without them the header's own voices, else the defaults.
//
// Default voices (Settings' cloudVoices empty), rate 1.0, the declared
// language. Lines already recorded with the same voice are reused, never
// paid for again. A .json {request, subtitle, spec} becomes a playlist file
// beside it (<name>.cast) holding the audio; a .yaml/.cast is rewritten in place.

import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const voiceFlags = { a: flag("--a"), b: flag("--b") };
const flagValues = new Set(Object.values(voiceFlags).filter(Boolean));
const files = args.filter((a) => !a.startsWith("--") && !flagValues.has(a));
if (files.length === 0) {
  console.error("usage: node scripts/bake-narration.mjs [--apply] <cast> [...]");
  process.exit(2);
}
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const apiKey = env.GOOGLE_API_KEY;
// Gemini voices speak with their own key when there is one (Google keeps the Gemini API off Cloud TTS keys).
const geminiKey = env.GEMINI_API_KEY;
if (apply && !apiKey) {
  console.error("No GOOGLE_API_KEY in .env");
  process.exit(2);
}

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
const P = await vite.ssrLoadModule("/src/playlist/playlist.ts");
const { playlistBakeLines } = await vite.ssrLoadModule("/src/playlist/session.ts");
const { bakeNarration } = await vite.ssrLoadModule("/src/export/bake.ts");
const { synthesizeBase64, stampedVoice, runLang } = await vite.ssrLoadModule("/src/export/tts.ts");
const { bakeCost } = await vite.ssrLoadModule("/src/export/tts-cost.ts");
const { withCastVoices, readCastVoices } = await vite.ssrLoadModule("/src/export/gemini-tts.ts");

let totalUsd = 0;
let totalChars = 0;
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const isJson = file.endsWith(".json");
  const playlist = P.parsePlaylistText(isJson ? JSON.stringify(JSON.parse(raw).spec) : raw);
  if (voiceFlags.a || voiceFlags.b) {
    const merged = readCastVoices({ ...(playlist.meta.voices ?? {}), ...(voiceFlags.a ? { a: voiceFlags.a } : {}), ...(voiceFlags.b ? { b: voiceFlags.b } : {}) });
    if (merged) playlist.meta.voices = merged;
  }
  // The cast's own voices ride as "@a"/"@b" in the voice map (export/tts.ts preferredVoice).
  const voices = withCastVoices({}, playlist.meta.voices);
  const lines = playlistBakeLines(playlist);
  const declaredLang = P.itemsOf(playlist).find((i) => i.spec.lang)?.spec.lang;
  const existing = playlist.audio?.lines ?? {};
  const voiceOf = (line) => stampedVoice(voices, runLang(line, declaredLang), line);
  const cost = bakeCost(lines, voices);
  totalUsd += cost.usd;
  totalChars += cost.chars;
  if (!apply) {
    const who = playlist.meta.voices ? ` [voices: ${JSON.stringify(playlist.meta.voices)}]` : "";
    console.log(`${file}: ${lines.length} lines, ${cost.chars} chars, ≈ $${cost.usd.toFixed(2)}${Object.keys(existing).length ? ` (${Object.keys(existing).length} clips already recorded)` : ""}${who}`);
    continue;
  }
  const track = await bakeNarration(
    lines,
    {
      lang: declaredLang ?? "en",
      existing,
      synthesize: (line) => synthesizeBase64({ apiKey, geminiKey, rate: 1, voices, lang: declaredLang }, line.text, line),
      voiceOf,
    },
    (done, total) => process.stdout.write(`\r${file}: ${done}/${total}   `),
    new AbortController().signal,
  );
  const out = P.formatPublished(playlist, track, "script");
  const target = isJson ? file.replace(/\.json$/, ".cast") : file.replace(/\.yaml$/, ".cast");
  writeFileSync(target, out);
  console.log(`\n${file} → ${target}: ${Object.keys(track.lines).length} clips`);
}
if (!apply) console.log(`TOTAL ≈ $${totalUsd.toFixed(2)} for ${totalChars} characters (lines already recorded in the same voice are free).`);
await vite.close();
