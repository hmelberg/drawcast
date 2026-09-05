// The client half of the sign-in handshake (spec §1). The app and the server
// are two origins, so a session cookie cannot authorise a fetch from here;
// what crosses is a one-time token in a redirect, exchanged once for a
// session token that lives in this browser like the GitHub token does.
//
// Nothing here may throw into a page load: every failure returns null.
//
// Imports only learn.ts, which imports nothing. store.ts must never be pulled
// in here: it is the library, and the viewer chunk would drag it along.

import { apiBase, DEFAULT_ENROLL_API } from "./learn";

const TOKEN_KEY = "drawcast.token";
/** `t` as its own parameter — never the `t` inside another word. */
const TOKEN_RE = /[#&]t=([^&]+)/;

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null; // private mode can throw on access, not only on use
  }
}

export function getToken(): string {
  try {
    return storage()?.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  const s = storage();
  if (!s) return;
  try {
    if (token) s.setItem(TOKEN_KEY, token);
    else s.removeItem(TOKEN_KEY);
  } catch {
    /* no storage — this browser signs in again next time */
  }
}

export function signInUrl(returnTo: string, api: string = DEFAULT_ENROLL_API): string {
  return `${apiBase(api)}/#signin?return=${encodeURIComponent(returnTo)}`;
}

export function tokenInHash(hash: string): string | null {
  const m = TOKEN_RE.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]) || null;
  } catch {
    return null; // a malformed escape is not a token, not a crash
  }
}

/** The same URL without `t=`, so a copied address never carries a token. */
export function stripToken(url: string): string {
  return url.replace(/([#&])t=[^&]*&/, "$1").replace(/[#&]t=[^&]*$/, "");
}

export async function redeemToken(api: string, token: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/redeem`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ token, label: navigator.userAgent.slice(0, 60) }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { key?: unknown };
    return typeof body.key === "string" ? body.key : null;
  } catch {
    return null;
  }
}

export async function signOut(api: string, token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl(`${apiBase(api)}/_/api/signout`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key: token }),
    });
  } catch {
    /* signing out locally is what matters; the row can be revoked from the dashboard */
  }
}
