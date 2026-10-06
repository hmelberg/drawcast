// Subscriptions (credit plan delivery 4, 2026-10-06): Basic $5, Pro $9,
// Business $50 a month. A subscription carries no credit; it gives AI and
// narration at half price, names at half price, unlisted free, private
// (subscribers only) and storage on the drawcast server — the plans differ
// only in how much. Stripe runs the subscription; Anvil keeps the account in
// step with it. Same contract shape as credit.ts: text/plain JSON POSTs,
// never throws, every refusal a word.

import { apiBase } from "./learn";

export interface PlanInfo {
  cents: number;
  quotaMb: number;
  label: string;
}

export interface SubStatus {
  plan: string | null;
  active: boolean;
  /** Ended less than 30 days ago: stored drawcasts are kept, readable, not writable. */
  grace: boolean;
  admin: boolean;
  until: string | null;
  quotaBytes: number;
  usedBytes: number;
  /** A Stripe customer exists, so the Customer Portal can open. */
  manageable: boolean;
  plans: Record<string, PlanInfo>;
  /** False while Stripe runs in test mode, for anyone but an admin. */
  onSale: boolean;
}

async function post(api: string, path: string, body: unknown, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(`${apiBase(api)}/_/api${path}`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function subStatus(api: string, key: string, fetchImpl: typeof fetch = fetch): Promise<SubStatus | "key" | "error"> {
  try {
    const res = await post(api, "/sub/status", { key }, fetchImpl);
    if (!res.ok) return res.status === 401 ? "key" : "error";
    const b = (await res.json()) as Record<string, unknown>;
    const plans: Record<string, PlanInfo> = {};
    for (const [id, p] of Object.entries((b.plans ?? {}) as Record<string, { cents: number; quota_mb: number; label: string }>)) {
      plans[id] = { cents: p.cents, quotaMb: p.quota_mb, label: p.label };
    }
    return {
      plan: typeof b.plan === "string" ? b.plan : null,
      active: b.active === true,
      grace: b.grace === true,
      admin: b.admin === true,
      until: typeof b.until === "string" ? b.until : null,
      quotaBytes: typeof b.quota_bytes === "number" ? b.quota_bytes : 0,
      usedBytes: typeof b.used_bytes === "number" ? b.used_bytes : 0,
      manageable: b.manageable === true,
      plans,
      onSale: b.on_sale === true,
    };
  } catch {
    return "error";
  }
}

export type SubStart = { url: string } | "subscribed" | "closed" | "key" | "error";

/** POST /sub/start: a Stripe Checkout for `plan`; back at `#subscribed=<plan>`. */
export async function startSubscription(api: string, body: { key: string; plan: string; return: string }, fetchImpl: typeof fetch = fetch): Promise<SubStart> {
  try {
    const res = await post(api, "/sub/start", body, fetchImpl);
    if (res.ok) {
      const b = (await res.json()) as { url?: unknown };
      return typeof b.url === "string" ? { url: b.url } : "error";
    }
    if (res.status === 409) return "subscribed";
    if (res.status === 403) return "closed";
    if (res.status === 401) return "key";
    return "error";
  } catch {
    return "error";
  }
}

/** POST /sub/portal: Stripe's Customer Portal — change plan, cancel, update the card. */
export async function openPortal(api: string, body: { key: string; return: string }, fetchImpl: typeof fetch = fetch): Promise<{ url: string } | "none" | "key" | "error"> {
  try {
    const res = await post(api, "/sub/portal", body, fetchImpl);
    if (res.ok) {
      const b = (await res.json()) as { url?: unknown };
      return typeof b.url === "string" ? { url: b.url } : "error";
    }
    if (res.status === 404) return "none";
    if (res.status === 401) return "key";
    return "error";
  } catch {
    return "error";
  }
}

/** `#subscribed=<plan>` (or `=0` when it did not go through), from /sub/done or the checkout's cancel. */
export function subscribedInHash(hash: string): { plan: string | null } | null {
  const m = /^#subscribed=([a-z0-9]+)$/.exec(hash);
  if (!m) return null;
  return { plan: m[1] === "0" ? null : m[1] };
}

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);

/** Under the plan cards: where the subscription stands, or "" when there
 *  is nothing to say (no plan, or an admin — whose card says "Your plan"). */
export function planStatus(s: SubStatus): string {
  if (s.admin) return "";
  const until = s.until ? new Date(s.until).toLocaleDateString(undefined, { dateStyle: "medium" }) : "";
  if (s.active && s.plan) return `Paid until ${until} · ${mb(s.usedBytes)} of ${mb(s.quotaBytes)} MB used.`;
  if (s.grace) return `Your plan ended ${until}. Your stored drawcasts are kept 30 days, then deleted — subscribe again to keep them.`;
  return "";
}

/** Above the cards: why subscribe at all. */
export const PLAN_INTRO = "Subscribers pay half price for AI and narration.";

/** Below the cards. */
export const PLAN_EVERY = "A plan includes no credit; buy that separately.";

/** What each card says it is for (the plans differ only in storage). */
export const PLAN_FOR: Record<string, string> = {
  basic: "For trying it out: a few private drawcasts.",
  pro: "For teaching: a course or two, with narration.",
  business: "For many courses, or a whole department.",
};

/** What every plan gives, listed on each card. */
export const PLAN_GIVES = ["AI and narration at half price", "Private drawcasts and courses", "Unlisting for free", "drawcast.app/#names at half price"];
