// Narration credit (registry delivery 3): the app never holds Anvil's
// Google TTS key — it lives only in Anvil Secrets. A signed-in author with
// no Google TTS key of their own (own or vended, store.ts's getTtsKey) can
// still publish narration: the server synthesizes each line against prepaid
// credit, charged at 4x Google's list price per character (the server's own
// markup — the same rule as AI calls on credit since 2026-10-06 — the app never applies it itself, only ESTIMATES it for the Share
// hint before a line is sent).
//
// Same contract shape as registry.ts: POST text/plain JSON to
// `${apiBase}/_/api/...`; every function that is not the synthesizer itself
// never throws — a word answers instead, exactly like quotePrivate/
// startPrivatePayment. serverSynthesize is the one exception: it plugs
// straight into bakeNarration's `synthesize(line) => Promise<string>` seam
// (export/bake.ts), which propagates a rejection as a publish-stopping
// failure — that IS the point (a credit shortfall must stop the bake before
// any commit, never publish half-narrated).

import { apiBase } from "./learn";
import { ttsRequestBody, type TtsBodyConfig } from "./export/tts";
import type { SpeakOpts } from "./render/delivery";

/** Whole credits (a credit is a cent, 10,000 micro-dollars): what is needed rounds UP, what is left rounds DOWN. */
function credits(micro: number, round: (x: number) => number): string {
  const n = Math.max(0, round(micro / 10_000));
  return `${n.toLocaleString("en-US")} credit${n === 1 ? "" : "s"}`;
}

/**
 * Thrown by serverSynthesize on a 402 (the reserve found too little credit).
 * Its message is already the whole sentence a status line shows — mirrors
 * LockError (publish/lock.ts) and how main.ts/course.ts already special-case
 * that: `e instanceof CreditError ? e.message : "Publish failed — …"`.
 *
 * `null` (fix round 1) is a MALFORMED 402 — the server answered 402 but its
 * body carried no numbers at all (an unreadable body, a future response
 * shape this client doesn't know) — never "the server said $0". Only when
 * BOTH are null does the message fall back to a plain sentence with no
 * dollar figures; one real number is still worth showing (the other reads
 * as $0.00, which is at least an honest "we don't know" for that half, not a
 * fabricated total).
 */
export class CreditError extends Error {
  neededMicro: number | null;
  balanceMicro: number | null;
  constructor(neededMicro: number | null, balanceMicro: number | null) {
    super(
      neededMicro === null && balanceMicro === null
        ? "Not enough credit for narration. Buy credit under Settings → Credits."
        : `Not enough credit for narration — about ${credits(neededMicro ?? 0, Math.ceil)} needed, ${credits(balanceMicro ?? 0, Math.floor)} left. Buy credit under Settings → Credits.`,
    );
    this.name = "CreditError";
    this.neededMicro = neededMicro;
    this.balanceMicro = balanceMicro;
  }
}

export interface CreditBalance {
  balanceMicro: number;
  /** Whole credits, rounded down by the server. */
  credits: number;
  /** The server's own "12.34" formatting — used verbatim rather than
   *  re-derived, so a rounding rule change on the server needs no app release. */
  balanceUsd: string;
}

export type CreditBalanceOutcome = CreditBalance | "key" | "error";

/**
 * POST /credit/balance: the signed-in author's narration-credit balance, for
 * the Share panel's hint. Signed in only — a 401 is `"key"`, anything else
 * that is not a 200 (a malformed body, a 5xx, a network failure) is
 * `"error"`. Never throws.
 */
export async function creditBalance(api: string, key: string, fetchImpl: typeof fetch = fetch): Promise<CreditBalanceOutcome> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/credit/balance`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return res.status === 401 ? "key" : "error";
    const b = (await res.json()) as Partial<{ balance_micro: unknown; balance_usd: unknown; credits: unknown }>;
    if (typeof b.balance_micro !== "number") return "error";
    return {
      balanceMicro: b.balance_micro,
      credits: typeof b.credits === "number" ? b.credits : Math.floor(b.balance_micro / 10_000),
      balanceUsd: typeof b.balance_usd === "string" ? b.balance_usd : (b.balance_micro / 1_000_000).toFixed(2),
    };
  } catch {
    return "error";
  }
}

export type CreditPayOutcome =
  | { url: string }
  | "pending" // 409 — a checkout for this account's credit purchase is already open
  | "key" // 401
  | "error";

/**
 * POST /credit/pay: opens a Stripe Checkout session for one of the three
 * credit packs — `{url}` is where the browser goes next; Stripe returns it to
 * `<return origin>/#creditpaid=<cents>` or `#creditunpaid=0` (creditInHash
 * below). Every refusal is a word; never throws.
 */
export async function startCreditPayment(
  api: string,
  body: { key: string; cents: 500 | 1000 | 2000; return: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CreditPayOutcome> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/credit/pay`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const b = (await res.json()) as { url?: unknown };
      return typeof b.url === "string" ? { url: b.url } : "error";
    }
    if (res.status === 409) return "pending";
    if (res.status === 401) return "key";
    return "error";
  } catch {
    return "error";
  }
}

/**
 * Stripe's return for a credit purchase, read from the URL fragment —
 * privateInHash's sibling (src/registry.ts) for `/credit/pay`. `cents` is 0
 * on the unpaid branch (the server's own `#creditunpaid=0`).
 */
export function creditInHash(hash: string): { outcome: "creditpaid" | "creditunpaid"; cents: number } | null {
  const m = /^#(creditpaid|creditunpaid)=(\d+)$/.exec(hash);
  if (!m) return null;
  return { outcome: m[1] as "creditpaid" | "creditunpaid", cents: Number(m[2]) };
}

/**
 * One line, synthesized on the SERVER against prepaid narration credit — the
 * no-key, signed-in path getTtsKey() leaves open. Sends exactly the same
 * request body a local key would send Google (ttsRequestBody, export/tts.ts),
 * so the server can validate and price it against Google's own request
 * shape; the server holds the real Google key and this app never sees it.
 *
 * Bounded to 30 s (the contract's own limit for a single line, matching
 * Anvil's ~30s HTTP ceiling) — AbortSignal.timeout, like every other bounded
 * call this app makes. A 402 throws CreditError (stops the bake before any
 * commit, export/bake.ts); every other refusal is a plain Error whose
 * message is safe to show as-is.
 */
export async function serverSynthesize(
  api: string,
  key: string,
  cfg: TtsBodyConfig,
  text: string,
  opts?: SpeakOpts,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = ttsRequestBody(cfg, text, opts);
  const res = await fetchImpl(`${apiBase(api)}/_/api/tts`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ key, body }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 402) {
    const b = (await res.json().catch(() => ({}))) as Partial<{ needed_micro: unknown; balance_micro: unknown }>;
    throw new CreditError(typeof b.needed_micro === "number" ? b.needed_micro : null, typeof b.balance_micro === "number" ? b.balance_micro : null);
  }
  if (res.status === 401) throw new Error("Sign in again to publish with narration credit (Settings → Publishing).");
  if (!res.ok) throw new Error("Narration credit synthesis failed — try again in a moment.");
  const b = (await res.json()) as { audio?: unknown };
  if (typeof b.audio !== "string") throw new Error("the credit TTS response carried no audio");
  return b.audio;
}

export interface StatementRow {
  at: string | null;
  /** purchase, llm (an AI call), llm_hold (one still running), tts, refund, grant. */
  reason: string;
  /** Signed: positive in, negative out. */
  credits: number;
  note: { model?: string; in?: number; out?: number; read?: number; write?: number } | null;
}

/**
 * POST /credit/statement: the account's last rows, newest first, and the
 * balance in credits. Never throws.
 */
export async function creditStatement(api: string, key: string, fetchImpl: typeof fetch = fetch): Promise<{ rows: StatementRow[]; credits: number } | "key" | "error"> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/credit/statement`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return res.status === 401 ? "key" : "error";
    const b = (await res.json()) as { rows?: unknown; credits?: unknown };
    if (!Array.isArray(b.rows) || typeof b.credits !== "number") return "error";
    return { rows: b.rows as StatementRow[], credits: b.credits };
  } catch {
    return "error";
  }
}

/** One statement row as words: "AI · Opus 5.5 · 41k in, 6k out". */
export function describeRow(row: StatementRow, modelLabel: (id: string) => string = (id) => id): string {
  const k = (x: number | undefined): string => (!x ? "0" : x >= 1000 ? `${Math.round(x / 1000)}k` : String(x));
  switch (row.reason) {
    case "purchase":
      return "Bought credit";
    case "grant":
      return "Credit given";
    case "tts":
      return "Narration line";
    case "refund":
      return "Refund";
    case "llm_hold":
      return `AI call running${row.note?.model ? ` · ${modelLabel(row.note.model)}` : ""} (most it can cost)`;
    case "llm": {
      const n = row.note ?? {};
      const cached = (n.read ?? 0) + (n.write ?? 0);
      return `AI · ${n.model ? modelLabel(n.model) : "call"} · ${k((n.in ?? 0) + cached)} in, ${k(n.out)} out`;
    }
    default:
      return row.reason;
  }
}
