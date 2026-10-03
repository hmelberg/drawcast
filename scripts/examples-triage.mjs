// The bundled examples as one table, for choosing what the front page shows
// (plan 2026-10-03 "drawcast.app front page", content track): which to keep
// and publish, which are long enough to be a course, which to archive.
// Read-only — it prints, it never changes a file.
//
//   node scripts/examples-triage.mjs > dev-casts/examples-triage.md
//
// Columns: index · title · spoken lines · items · format guess (book →
// Xplanation; a question in the first third and few lines → Quiz; else
// Drawcast — "(asks)" when it has any question, e.g. a closing quiz) · packs ·
// suggestion (archive? / keep / course?). The suggestion is a starting
// point for a person, not a decision.

import { readFileSync } from "node:fs";
import { createServer } from "vite";

const examples = JSON.parse(readFileSync(new URL("../src/examples.json", import.meta.url), "utf8"));

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
const { parsePlaylistText, itemsOf } = await vite.ssrLoadModule("/src/playlist/playlist.ts");
const { playlistSpeakLines } = await vite.ssrLoadModule("/src/playlist/session.ts");

const QUESTION_RE = /"(ask|quiz|choose|guess)"\s*:/;

function row(e, i) {
  let lines = 0;
  let items = 0;
  let specs = [];
  try {
    const playlist = parsePlaylistText(e.playlist ?? JSON.stringify(e.spec ?? {}));
    specs = itemsOf(playlist).map((it) => it.spec);
    items = specs.length;
    lines = playlistSpeakLines(playlist).length;
  } catch {
    /* unparseable: shown with zeros, a candidate for the archive */
  }
  const book = specs.some((s) => s && s.book);
  // Question-LED, not merely ending in a quiz (most examples close with
  // one): the first question sits in the first third of the commands.
  const commands = specs.flatMap((s) => (Array.isArray(s?.commands) ? s.commands : []));
  const firstQ = commands.findIndex((c) => QUESTION_RE.test(JSON.stringify(c)));
  const questions = firstQ >= 0;
  const questionLed = questions && firstQ <= Math.max(2, commands.length / 3);
  const format = book ? "Xplanation" : questionLed && lines <= 12 ? "Quiz" : "Drawcast";
  const suggestion = lines < 4 ? "archive?" : lines > 45 || items > 3 ? "course?" : "keep";
  const title = String(e.title ?? specs[0]?.title ?? e.request ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 70);
  return `| ${i} | ${title} | ${lines} | ${items} | ${format}${questions ? " (asks)" : ""} | ${(e.packs ?? []).join(", ")} | ${suggestion} |`;
}

const out = [
  `# Bundled examples — triage (${examples.length})`,
  "",
  "| # | Title | Lines | Items | Format | Packs | Suggestion |",
  "|---|---|---|---|---|---|---|",
  ...examples.map(row),
];
console.log(out.join("\n"));
await vite.close();
