// The card lab's page (card-lab.html, dev only, 2026-10-05): every library
// cast's compiled card (scripts/card-lab.mjs → docs/card-lab/runs/latest/
// cards.json) beside today's server-drawn card and over its own poster.

import { drawCard } from "../card/draw";
import type { CardResult } from "../card/types";
import { h } from "../ui/dom";

interface LabRow {
  slug: string;
  title: string;
  name?: string;
  poster: string;
  ms: number;
  result: CardResult | null;
  error?: string;
}

interface LabStats {
  rendererGzip?: number;
  drawMs?: number;
  drawMsSlow?: number;
}

type Rating = "good" | "ok" | "bad";
const RATINGS_KEY = "cardlab:ratings";

function readRatings(): Record<string, Rating> {
  try {
    return JSON.parse(localStorage.getItem(RATINGS_KEY) ?? "{}") as Record<string, Rating>;
  } catch {
    return {};
  }
}

function saveRatings(r: Record<string, Rating>): void {
  try {
    localStorage.setItem(RATINGS_KEY, JSON.stringify(r));
  } catch {
    /* a lab convenience */
  }
}

function svgNode(markup: string): Element {
  const wrap = document.createElement("div");
  wrap.innerHTML = markup;
  return wrap.firstElementChild!;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

async function main(): Promise<void> {
  const app = document.getElementById("app")!;
  const loaded = (await fetch("/docs/card-lab/runs/latest/cards.json").then((r) => (r.ok ? r.json() : null)).catch(() => null)) as LabRow[] | null;
  if (!loaded) {
    app.textContent = "No run yet — npm run cardlab";
    return;
  }
  const rows = loaded;
  const stats = ((await fetch("/docs/card-lab/runs/latest/stats.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}))) ?? {}) as LabStats;
  const ratings = readRatings();
  const phone = document.getElementById("phone") as HTMLInputElement;
  phone.addEventListener("change", () => document.body.classList.toggle("phone", phone.checked));

  const t0 = performance.now();
  const lines: HTMLElement[] = [h("div", { class: "row head" }, h("div", {}, "Cast"), h("div", {}, "Today (server)"), h("div", {}, "Card: drawing"), h("div", {}, "Card: over the poster"))];
  for (const r of rows) {
    const today = r.name ? h("img", { src: `https://drawcast.app/card/${r.name}.png`, alt: "", loading: "lazy" }) : h("div", { class: "meta" }, "no name");
    const drawing = r.result ? svgNode(drawCard(r.result.card)) : h("div", { class: "meta" }, r.error ?? "no card");
    const over = r.result ? svgNode(drawCard(r.result.card, { posterHref: r.poster })) : h("div", {});
    const counts = new Map<string, number>();
    for (const d of r.result?.dropped ?? []) counts.set(d, (counts.get(d) ?? 0) + 1);
    const rate = h("div", { class: "rate" });
    for (const v of ["good", "ok", "bad"] as Rating[]) {
      const b = h("button", { type: "button", "aria-pressed": String(ratings[r.slug] === v) }, v) as HTMLButtonElement;
      b.addEventListener("click", () => {
        ratings[r.slug] = v;
        saveRatings(ratings);
        for (const x of Array.from(rate.children)) x.setAttribute("aria-pressed", String(x.textContent === v));
        showStats();
      });
      rate.append(b);
    }
    lines.push(
      h(
        "div",
        { class: "row" },
        h(
          "div",
          {},
          h("div", {}, h("b", {}, r.title || r.slug)),
          h("div", { class: "meta" }, r.result ? `${kb(r.result.bytes)} + icons ${kb(r.result.iconBytes)} · ${r.result.card.items.length} items · ${r.ms} ms` : ""),
          h("div", { class: "meta" }, [...counts].map(([k, n]) => `${k} ×${n}`).join(", ") || "nothing dropped"),
          rate,
        ),
        h("div", { class: "cell" }, today),
        h("div", { class: "cell" }, drawing),
        h("div", { class: "cell" }, over),
      ),
    );
  }
  app.replaceChildren(...lines);
  const drawMs = Math.round(performance.now() - t0);
  (window as unknown as { __drawMs: number }).__drawMs = drawMs;

  const ok = rows.filter((r) => r.result).map((r) => r.result!);
  const coverage = new Map<string, number>();
  for (const r of ok) for (const d of new Set(r.dropped)) coverage.set(d, (coverage.get(d) ?? 0) + 1);
  function showStats(): void {
    const rated = Object.values(ratings);
    const tally = (v: Rating): number => rated.filter((x) => x === v).length;
    document.getElementById("stats")!.textContent =
      `${ok.length}/${rows.length} cards · median ${kb(median(ok.map((r) => r.bytes)))}, largest ${kb(Math.max(0, ...ok.map((r) => r.bytes)))} (icons apart; median icons ${kb(median(ok.map((r) => r.iconBytes)))}) · ` +
      `drawn in ${drawMs} ms here${stats.drawMsSlow ? `, ${stats.drawMsSlow} ms at 4× slower CPU` : ""}${stats.rendererGzip ? ` · renderer ${kb(stats.rendererGzip)} gzip` : ""} · ` +
      `rated ${rated.length}: good ${tally("good")}, ok ${tally("ok")}, bad ${tally("bad")} · dropped (casts): ${[...coverage].map(([k, n]) => `${k} ${n}`).join(", ")}`;
  }
  showStats();

  document.getElementById("ledger")!.addEventListener("click", () => {
    const date = new Date().toISOString().slice(0, 10);
    const rated = rows.filter((r) => ratings[r.slug]);
    const text = [`## ${date} — round 1 ratings (${rated.length} casts)`, "", ...rated.map((r) => `- ${r.slug}: ${ratings[r.slug]}`), ""].join("\n");
    void navigator.clipboard.writeText(text);
  });
}

void main();
