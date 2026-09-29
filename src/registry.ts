// The Anvil registry (registry delivery 1): EVERY publish to the author's
// own GitHub repo — one drawcast or a whole course — claims the repo (proof
// the publisher controls it) and registers the published item, so the
// teacher dashboard and a free title name (drawcast.app/#<name>) work
// without anyone visiting Share -> Pretty link.
//
// Same POST body-is-text/plain-JSON shape as names.ts (registerName,
// claimCourse), but a DIFFERENT pair of endpoints with a different
// contract: this is the free, automatic registration every publish gets,
// not the bought pretty link. A registry failure must NEVER fail a
// publish — every function here is wrapped in try/catch and answers with a
// word rather than throwing; the 10 s bound (AbortSignal.timeout) is the
// caller's job, the same "bounded" fetch the course publish already uses
// for claimCourse/registerName.

import { apiBase } from "./learn";
import type { PublishFile } from "./publish/github";

/**
 * POST /claim: mints a one-time nonce for `repo` ("owner/repo") and hands
 * back the file the caller must commit ALONGSIDE the publish — proof, once
 * verifyClaim reads it back from raw.githubusercontent.com, that whoever is
 * publishing controls the repo. Null signed out (no token) or on any
 * refusal or network trouble; this never throws.
 */
export async function claimFile(api: string, token: string, repo: string, fetchImpl: typeof fetch = fetch): Promise<PublishFile | null> {
  if (!token) return null;
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/claim`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key: token, repo }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { nonce?: unknown; path?: unknown };
    if (typeof body.nonce !== "string") return null;
    const path = typeof body.path === "string" ? body.path : ".drawcast/claim";
    return { path, content: body.nonce + "\n" };
  } catch {
    return null;
  }
}

/**
 * POST /claim/verify, once the claim file above has been committed: true
 * only when Anvil has read it back from GitHub and its first line matches
 * the nonce. raw.githubusercontent.com can lag a commit made a second ago,
 * so an answer of {verified:false} is asked again — up to `attempts` times
 * (3), `delayMs` (3 s) apart, each attempt bounded by its own `timeoutMs`
 * signal (final review M3); `sleep` is injectable for tests. A refusal, a
 * malformed answer or network trouble is false at once, never a throw.
 */
export async function verifyClaim(
  api: string,
  token: string,
  repo: string,
  fetchImpl: typeof fetch = fetch,
  opts: { attempts?: number; delayMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 3_000;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delayMs);
    try {
      const res = await fetchImpl(`${apiBase(api)}/_/api/claim/verify`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ key: token, repo }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { verified?: unknown };
      if (body.verified === true) return true;
      if (body.verified !== false) return false;
    } catch {
      return false;
    }
  }
  return false;
}

export interface RegisterInput {
  /** The session token; omitted, the registration is read-only — the
   *  item's current state comes back, but no free name is minted or moved. */
  key?: string;
  kind: "cast" | "course";
  target: string;
  title?: string;
  page?: string;
  lectures?: string[];
}

export interface RegisterResult {
  item: unknown;
  /** The free title name now pointing at this item, or null in a read-only answer. */
  name: string | null;
  owner: "you" | "other" | "none";
  proven: boolean;
}

export type RegistryOutcome = RegisterResult | "key" | "rate" | "error";

/**
 * POST /register: records the published item and, signed in, mints or moves
 * its free title name. `"key"` is a 401 (a token the server no longer
 * knows), `"rate"` a 429; anything else that is not a 200 — a 400, a 5xx, a
 * network failure — is `"error"`. Never throws.
 */
export async function registerItem(api: string, reg: RegisterInput, fetchImpl: typeof fetch = fetch): Promise<RegistryOutcome> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/register`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(reg),
    });
    if (res.ok) {
      const body = (await res.json()) as Partial<RegisterResult>;
      const owner = body.owner === "you" || body.owner === "other" ? body.owner : "none";
      return { item: body.item, name: typeof body.name === "string" ? body.name : null, owner, proven: body.proven === true };
    }
    if (res.status === 401) return "key";
    if (res.status === 429) return "rate";
    return "error";
  } catch {
    return "error";
  }
}

/**
 * The status suffix after a publish registers (registry delivery 1): the
 * free name when one came back, a warning when the repo answers to someone
 * else's account (never a failure — the publish itself already landed), or
 * nothing at all when registration succeeded but minted no name to show.
 * `"key"`/`"rate"`/a network failure all read the same way to the author:
 * the publish is fine, only the registry step did not happen.
 */
export function registryNote(out: RegistryOutcome, signIn = "sign in again (Settings → Publishing)"): string {
  // A 401 is a stale or missing session, not an unreachable server — the
  // cure is signing in; the skill passes its own "run: … login" (M5).
  if (out === "key") return ` · not registered — ${signIn}`;
  if (out === "rate" || out === "error") return " · not registered (server unreachable)";
  if (out.owner === "other") return " · registered to another account — republish while signed in to prove the repo is yours";
  return out.name ? ` · drawcast.app/#${out.name}` : "";
}
