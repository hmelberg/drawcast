// Browser-only Google sign-in. Tokens are held in memory and NEVER persisted:
// an access token against someone's YouTube channel is an XSS exfiltration
// target, and localStorage is readable by any script on the origin. The cost is
// that a session lapses after ~1h and is then re-acquired silently while the
// user's Google session is live.
//
// Scopes are requested incrementally, by the action that needs them, so a user
// who only saves specs never sees a consent screen mentioning video uploads.

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export type Scope = typeof DRIVE_SCOPE | typeof YOUTUBE_SCOPE;

/** Seconds of headroom: a token this close to expiry must not start a long upload. */
const EXPIRY_MARGIN_S = 60;

export interface TokenStore {
  get(scope: Scope): string | null;
  put(scope: Scope, token: string, expiresInSeconds: number): void;
  clear(): void;
}

/** Exported for tests; production uses the module-level instance below. */
export function makeTokenStore(now: () => number = Date.now): TokenStore {
  const grants = new Map<Scope, { token: string; expiresAt: number }>();
  return {
    get(scope) {
      const g = grants.get(scope);
      if (!g) return null;
      if (g.expiresAt - EXPIRY_MARGIN_S * 1000 <= now()) {
        grants.delete(scope);
        return null;
      }
      return g.token;
    },
    put(scope, token, expiresInSeconds) {
      grants.set(scope, { token, expiresAt: now() + expiresInSeconds * 1000 });
    },
    clear() {
      grants.clear();
    },
  };
}

const store = makeTokenStore();
let user: { email: string } | null = null;

// import.meta.env has no repo-local vite-env.d.ts declaring ImportMetaEnv, so
// index through a cast rather than `keyof ImportMetaEnv`.
const env = import.meta.env as unknown as Record<string, string | undefined>;

export function clientId(): string {
  return env.VITE_GOOGLE_CLIENT_ID ?? "";
}
export function pickerKey(): string {
  return env.VITE_GOOGLE_PICKER_KEY ?? "";
}

/**
 * Sign-in is possible. This is the gate for EVERYTHING except Drive "Open":
 * Drive Save and YouTube upload need only the client id.
 */
export function googleConfigured(): boolean {
  return clientId() !== "";
}

/**
 * The file chooser additionally needs its own developer key, so "Open" can be
 * unavailable while the rest of the feature works. Gating YouTube on this key
 * would hide a button that has nothing to do with the Picker.
 */
export function pickerConfigured(): boolean {
  return clientId() !== "" && pickerKey() !== "";
}

export function currentUser(): { email: string } | null {
  return user;
}

export function signOut(): void {
  store.clear();
  user = null;
}

/** Loaded on first use only — a user who never signs in pays nothing at boot. */
let gsiReady: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  gsiReady ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("could not load Google sign-in"));
    document.head.appendChild(s);
  });
  return gsiReady;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

/**
 * The lazy sign-in gate — mirrors requireKey() in main.ts:1495. Resolves with a
 * token, or null when the user declines or sign-in is unavailable. A decline is
 * a normal outcome the caller reports via setStatus, never an exception.
 */
export async function requireScope(scope: Scope): Promise<string | null> {
  const cached = store.get(scope);
  if (cached) return cached;
  if (!googleConfigured()) return null;
  try {
    await loadGsi();
  } catch {
    return null; // blocked or offline — the caller reports it the same as a decline
  }

  return new Promise<string | null>((resolve) => {
    const google = (window as unknown as { google: any }).google;
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope,
      callback: async (res: TokenResponse) => {
        if (!res.access_token) return resolve(null);
        store.put(scope, res.access_token, res.expires_in ?? 3600);
        await fetchEmail(res.access_token);
        resolve(res.access_token);
      },
      error_callback: () => resolve(null),
    });
    // "" lets Google skip the prompt when this scope was already granted in a
    // live session — the silent re-acquire that replaces a stored refresh token.
    client.requestAccessToken({ prompt: "" });
  });
}

/**
 * Marks the grant signed-in and best-effort attaches an email for the sidebar
 * row. `user` is set here EITHER way — with a real email on success, or ""
 * on failure — because a live token with `user` left null would make the row
 * fall back to its signed-out label with no way to reach sign-out (a
 * privacy-extension-blocked userinfo call must not orphan the grant it
 * belongs to). The sidebar then shows a generic "Signed in" label when the
 * email is "".
 */
async function fetchEmail(token: string): Promise<void> {
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      user = { email: "" };
      return;
    }
    const j = (await r.json()) as { email?: string };
    user = { email: j.email ?? "" };
  } catch {
    user = { email: "" };
  }
}
