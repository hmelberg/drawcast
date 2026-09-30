// Private lectures (registry delivery 2): a lecture YAML becomes an envelope —
// a plain header naming the item, then AES-GCM ciphertext. Both the AES key
// and the HMAC key used for the IV are HKDF-SHA-256-derived from the raw item
// key (distinct info strings; the raw bytes are never used as an AES key
// directly). The IV is derived from the item and the content (HMAC of
// u32be(len(item)) || item || plaintext), so an unchanged lecture under the
// same item locks to the same bytes (no diff, no re-upload), while the same
// plaintext under a different item gets a different IV. The item is also
// bound as AES-GCM additional data, so an envelope can't be moved to another
// item. Pure; WebCrypto only (browsers and node).
export const LOCK_HEADER = "drawcast-encrypted: 1";
export const ENROLL_API = "https://drawcast.anvil.app";
const ALG = "AES-GCM-256";
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
  if (raw.length !== 32) throw new Error("bad-key");
  const base = await crypto.subtle.importKey("raw", raw as BufferSource, "HKDF", false, ["deriveKey"]);
  const aes = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("drawcast-lecture-enc") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const mac = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("drawcast-lecture-iv") },
    base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  return { aes, mac };
}

// u32be(byteLength(item)) || item bytes || plaintext — binds the item into the
// content-derived IV, so identical content under different items diverges.
function ivInput(item: string, pt: Uint8Array): Uint8Array {
  const itemBytes = enc.encode(item);
  const out = new Uint8Array(4 + itemBytes.length + pt.length);
  new DataView(out.buffer).setUint32(0, itemBytes.length, false);
  out.set(itemBytes, 4);
  out.set(pt, 4 + itemBytes.length);
  return out;
}

export function isLocked(text: string): boolean {
  return /^drawcast-encrypted: 1\r?\n/.test(text);
}

export function envelopeOf(
  text: string,
): { item: string; enroll: string; iv: string; data: string; alg: string } | null {
  if (!isLocked(text)) return null;
  const f: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const i = line.indexOf(": ");
    if (i > 0) f[line.slice(0, i)] = line.slice(i + 2).trim();
  }
  return f.item && f.iv && f.data
    ? { item: f.item, enroll: f.enroll ?? ENROLL_API, iv: f.iv, data: f.data, alg: f.alg ?? "" }
    : null;
}

export async function lockText(text: string, keyB64: string, item: string): Promise<string> {
  if (!item || /[\r\n]/.test(item) || item !== item.trim()) throw new Error("bad-item");
  const { aes, mac } = await keysFor(keyB64);
  const pt = enc.encode(text);
  const iv = new Uint8Array(await crypto.subtle.sign("HMAC", mac, ivInput(item, pt) as BufferSource)).slice(0, 12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: enc.encode(item) as BufferSource },
      aes,
      pt as BufferSource,
    ),
  );
  return `${LOCK_HEADER}\nitem: ${item}\nenroll: ${ENROLL_API}\nalg: ${ALG}\niv: ${toB64url(iv)}\ndata: ${toB64url(ct)}\n`;
}

export async function unlockText(envelope: string, keyB64: string): Promise<string> {
  const e = envelopeOf(envelope);
  if (!e) throw new Error("not-locked");
  if (e.alg !== ALG) throw new Error("wrong-key");
  try {
    const { aes } = await keysFor(keyB64);
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
