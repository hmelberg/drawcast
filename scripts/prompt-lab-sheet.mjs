// Builds the blind comparison page for a prompt-lab run: per case, the two
// arms side by side as "X" and "Y" (order shuffled per case, key kept in
// key.json so the verdicts can be un-blinded afterwards), each with its
// contact-sheet screenshot (<base>.jpg, taken by the frames harness) and its
// spoken lines. Cost, time and arm are left out on purpose.
//
//   node scripts/prompt-lab-sheet.mjs docs/prompt-lab/runs/<stamp> [armX armY]   (default A C)
//   → compare-<armX>-<armY>.html and key-<armX>-<armY>.json

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/prompt-lab-sheet.mjs <run dir>");
const [armA, armB] = [process.argv[3] ?? "A", process.argv[4] ?? "C"];
const tag = `${armA}-${armB}`;
const records = JSON.parse(readFileSync(`${dir}/records.json`, "utf8")).filter((r) => r.arm === armA || r.arm === armB);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const keyPath = `${dir}/key-${tag}.json`;
const key = existsSync(keyPath) ? JSON.parse(readFileSync(keyPath, "utf8")) : {};
const cases = [...new Set(records.map((r) => r.case))];
const sections = [];
for (const n of cases) {
  const rs = records.filter((r) => r.case === n);
  if (rs.length < 2) continue;
  if (!key[n]) key[n] = Math.random() < 0.5 ? { X: rs[0].arm, Y: rs[1].arm } : { X: rs[1].arm, Y: rs[0].arm };
  const cols = ["X", "Y"].map((label) => {
    const r = rs.find((x) => x.arm === key[n][label]);
    const base = `${r.case}-${r.kind}-${r.arm}`;
    const file = `${dir}/${base}.json`;
    const spec = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).spec : null;
    const lines = (spec?.commands ?? []).flatMap((c) => {
      const out = [];
      if (typeof c.speak === "string") out.push(c.speak);
      if (c.quiz) out.push(`QUIZ: ${c.quiz.question} — ${(c.quiz.choices ?? []).join(" / ")}`);
      return out;
    });
    const png = existsSync(`${dir}/${base}.jpg`) ? `<img src="${base}.jpg" alt="frames ${label}">` : `<p class="miss">no picture</p>`;
    return `<div class="col"><h3>${label}</h3>${spec ? png : `<p class="miss">no spec: ${esc(r.error ?? "")}</p>`}<ol>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol></div>`;
  });
  sections.push(`<section><h2>${n}. ${esc(rs[0].request)}</h2><div class="pair">${cols.join("")}</div></section>`);
}
writeFileSync(keyPath, JSON.stringify(key, null, 1));
writeFileSync(
  `${dir}/compare-${tag}.html`,
  `<!doctype html><meta charset="utf-8"><title>Prompt lab — blind pairs</title>
<style>
body{font:15px/1.45 system-ui,sans-serif;margin:24px;color:#2b2724;background:#fbf8f3}
h2{font-size:18px;margin:32px 0 8px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.col{background:#fff;border:1px solid #e3ddd3;border-radius:8px;padding:12px;min-width:0}
.col img{width:100%;border:1px solid #eee}.col h3{margin:0 0 8px}ol{padding-left:22px}li{margin:3px 0}
.miss{color:#b5482e}
</style>
<h1>Prompt lab — blind pairs</h1>
<p>Per question: which is better, X or Y, and why (one line)? The arms are shuffled per question; the key is in key-${tag}.json.</p>
${sections.join("\n")}`,
);
console.log(`${dir}/compare-${tag}.html — ${sections.length} pairs`);
