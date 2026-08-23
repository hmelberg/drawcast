// Password redemption (key vending). The Settings key field accepts either a
// real Anthropic key or the shared password; anything that doesn't look like
// an Anthropic key is TRIED against the vending endpoint — the server decides.
// Nothing about the password (not even its shape) lives in this bundle.

export interface VendedKeys {
  anthropicKey: string;
  googleKey: string;
}

export function looksLikeAnthropicKey(text: string): boolean {
  return text.startsWith("sk-ant-");
}

/**
 * Endpoints tried in order. Same-origin covers the Netlify deploy (and
 * `netlify dev`); the absolute URL covers the GitHub Pages deploy, which
 * calls the drawcast.app function cross-origin (its CORS allowlist has
 * hmelberg.github.io).
 */
export const VENDING_ENDPOINTS = [
  "/.netlify/functions/keys",
  "https://drawcast.app/.netlify/functions/keys",
];

/**
 * Try to exchange `password` for the real keys. Returns null on any failure
 * (wrong password, endpoint missing, network error) — the caller falls back
 * to treating the text as a normal key, exactly like today.
 */
export async function redeemPassword(
  password: string,
  endpoints: string[] = VENDING_ENDPOINTS,
  fetchImpl: typeof fetch = fetch,
): Promise<VendedKeys | null> {
  for (const url of endpoints) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as Partial<VendedKeys>;
      if (typeof json.anthropicKey === "string" && json.anthropicKey.length > 0) {
        return { anthropicKey: json.anthropicKey, googleKey: typeof json.googleKey === "string" ? json.googleKey : "" };
      }
    } catch {
      /* try the next endpoint */
    }
  }
  return null;
}
