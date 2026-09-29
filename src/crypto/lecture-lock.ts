// Private lectures (registry delivery 2): a lecture YAML becomes an envelope —
// a plain header naming the item, then AES-GCM ciphertext. The IV is derived
// from the content (HMAC of the plaintext with a key derived from the item
// key), so an unchanged lecture locks to the same bytes: no diff, no
// re-upload. The item is bound as additional data, so an envelope can't be
// moved to another item. Pure; WebCrypto only (browsers and node).
export const LOCK_HEADER = "drawcast-encrypted: 1";
export const ENROLL_API = "https://drawcast.anvil.app";
const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64url(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function keysFor(keyB64: string) {
  const raw = fromB64url(keyB64);
  const aes = await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  const base = await crypto.subtle.importKey("raw", raw as BufferSource, "HKDF", false, ["deriveKey"]);
  const mac = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("drawcast-lecture-iv") },
    base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  return { aes, mac };
}

export function isLocked(text: string): boolean {
  return text.startsWith(LOCK_HEADER + "\n");
}

export function envelopeOf(text: string): { item: string; enroll: string; iv: string; data: string } | null {
  if (!isLocked(text)) return null;
  const f: Record<string, string> = {};
  for (const line of text.split("\n").slice(1)) {
    const i = line.indexOf(": ");
    if (i > 0) f[line.slice(0, i)] = line.slice(i + 2).trim();
  }
  return f.item && f.iv && f.data ? { item: f.item, enroll: f.enroll ?? ENROLL_API, iv: f.iv, data: f.data } : null;
}

export async function lockText(text: string, keyB64: string, item: string): Promise<string> {
  const { aes, mac } = await keysFor(keyB64);
  const pt = enc.encode(text);
  const iv = new Uint8Array(await crypto.subtle.sign("HMAC", mac, pt as BufferSource)).slice(0, 12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: enc.encode(item) as BufferSource },
      aes,
      pt as BufferSource,
    ),
  );
  return `${LOCK_HEADER}\nitem: ${item}\nenroll: ${ENROLL_API}\nalg: AES-GCM-256\niv: ${toB64url(iv)}\ndata: ${toB64url(ct)}\n`;
}

export async function unlockText(envelope: string, keyB64: string): Promise<string> {
  const e = envelopeOf(envelope);
  if (!e) throw new Error("not-locked");
  const { aes } = await keysFor(keyB64);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(e.iv) as BufferSource, additionalData: enc.encode(e.item) as BufferSource },
      aes,
      fromB64url(e.data) as BufferSource,
    );
    return dec.decode(pt);
  } catch {
    throw new Error("wrong-key");
  }
}
