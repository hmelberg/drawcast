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
/**
 * Attaching a caption track needs this one — captions.insert accepts only
 * force-ssl (or youtubepartner, which is for content partners). It is far
 * wider than uploading: Google presents it as seeing, editing and permanently
 * deleting the user's videos, ratings, comments and captions. So it is asked
 * for on its own, by the button that adds subtitles, and never as part of an
 * upload — a user who is happy dragging the .vtt into Studio never sees it.
 */
export const YOUTUBE_CAPTIONS_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
export type Scope = typeof DRIVE_SCOPE | typeof YOUTUBE_SCOPE | typeof YOUTUBE_CAPTIONS_SCOPE;

/** Seconds of headroom: a token this close to expiry must not start a long upload. */
const EXPIRY_MARGIN_S = 60;

export interface TokenStore {
  get(scope: Scope): string | null;
  put(scope: Scope, token: string, expiresInSeconds: number): void;
  /** Every distinct token held, expired or not — sign-out revokes these. */
  tokens(): string[];
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
    tokens() {
      return [...new Set([...grants.values()].map((g) => g.token))];
    },
    clear() {
      grants.clear();
    },
  };
}

const store = makeTokenStore();
/**
 * Signed-in marker for the sidebar row. There is no email: `userinfo` needs an
 * `openid`/`email` token and this app requests neither — `drive.file` and
 * `youtube.upload` are all it will ever ask for. The invariant that matters is
 * that a live token always leaves sign-out reachable, so this is set by the
 * grant itself rather than by anything that could fail after it.
 */
let granted = false;

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

/** True once any scope has been granted this session. Cleared by signOut(). */
export function signedIn(): boolean {
  return granted;
}

/**
 * Forget every token AND tell Google to invalidate it. Forgetting alone would
 * make the label a lie: `requestAccessToken({prompt:""})` re-acquires silently
 * from the still-live Google session, so sign-out → sign-in would round-trip
 * back in with no interaction and no way to actually let go of the grant.
 */
export function signOut(): void {
  for (const token of store.tokens()) revoke(token);
  store.clear();
  granted = false;
}

/** Best effort: GIS may never have loaded, and a failed revoke must not throw. */
function revoke(token: string): void {
  try {
    const oauth2 = (window as unknown as { google?: { accounts?: { oauth2?: { revoke?: (t: string, cb: () => void) => void } } } }).google?.accounts?.oauth2;
    oauth2?.revoke?.(token, () => {});
  } catch {
    /* the local token is dropped either way — that is the part we control */
  }
}

/** Loaded on first use only — a user who never signs in pays nothing at boot. */
let gsiReady: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  // The memo must not retain a REJECTED promise: one flaky script load would
  // otherwise disable Google for the life of the page, and every retry would
  // be reported to the user as "sign-in was cancelled".
  gsiReady ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("could not load Google sign-in"));
    document.head.appendChild(s);
  }).catch((err: unknown) => {
    gsiReady = null;
    throw err;
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
      // Defaults to true, which folds every previously granted scope into the
      // new request — and Google refuses youtube.upload and drive.file in one
      // authorization ("scopes that cannot be requested together", 400). Each
      // request must stand alone; the store above already keeps one token per
      // scope, so nothing here ever needs a multi-scope token.
      include_granted_scopes: false,
      callback: (res: TokenResponse) => {
        if (!res.access_token) return resolve(null);
        store.put(scope, res.access_token, res.expires_in ?? 3600);
        granted = true; // set with the token itself: a live grant always keeps sign-out reachable
        resolve(res.access_token);
      },
      error_callback: () => resolve(null),
    });
    // "" lets Google skip the prompt when this scope was already granted in a
    // live session — the silent re-acquire that replaces a stored refresh token.
    client.requestAccessToken({ prompt: "" });
  });
}
