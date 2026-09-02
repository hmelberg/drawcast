// B15 — resumable narration bake. Hans hit his TTS quota mid-publish
// (2026-09-02): the publish rightly commits nothing on failure, but that
// also discarded every clip the failed attempt had already paid Google
// for. Now each clip is written to a local IndexedDB cache the moment it
// is synthesized, and the bake reads that cache before calling the API —
// a retry resumes where the quota stopped it, at zero extra cost.
//
// The cache is a wallet-protector, not a store of record: entries expire
// after 30 days (pruned lazily), reads and writes never fail the bake,
// and the published copy remains the durable reuse source. Same IndexedDB
// idiom as the portrait cache (render/portrait.ts), same in-memory
// fallback for tests and headless runs.

import { narrationVoice } from "./tts";
import { detectLang } from "../render/speech";
import { speechKey, type SpeakLine } from "../render/delivery";

/**
 * Everything that determines the audio bytes is in the key: the rate the
 * call would send, the exact voice narrationVoice() decides (language code
 * and name), and speechKey's gender/speaker/delivery/text.
 */
export function clipCacheKey(rate: number, voices: Record<string, string> | undefined, line: SpeakLine): string {
  const v = narrationVoice(voices, detectLang(line.text), line);
  return `${rate}|${v.languageCode}|${v.name ?? ""}|${speechKey(line)}`;
}

export interface ClipStore {
  get(key: string): Promise<string | null>;
  put(key: string, b64: string): Promise<void>;
}

/**
 * Wraps a synthesizer so every clip is cached the moment it exists and
 * every call checks the cache first. Cache failures are invisible: a read
 * error falls through to the API, a write error still returns the clip.
 */
export function cachingSynthesizer(
  store: ClipStore,
  keyOf: (line: SpeakLine) => string,
  synthesize: (line: SpeakLine) => Promise<string>,
): (line: SpeakLine) => Promise<string> {
  return async (line) => {
    const key = keyOf(line);
    const hit = await store.get(key).catch(() => null);
    if (hit) return hit;
    const b64 = await synthesize(line);
    // BEFORE returning: the whole point is that a failure right after this
    // line cannot lose the clip.
    await store.put(key, b64).catch(() => undefined);
    return b64;
  };
}

// ---- the IndexedDB store (in-memory fallback for tests/headless) ----------

const memCache = new Map<string, string>();
const DB_NAME = "drawcast-bake-clips";
const STORE = "clips";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/** Entries are `{t, a}` JSON — the timestamp is what pruning reads. */
let prunedThisSession = false;
function pruneOld(db: IDBDatabase): void {
  if (prunedThisSession) return;
  prunedThisSession = true;
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    const cursorReq = db.transaction(STORE, "readwrite").objectStore(STORE).openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      try {
        const v = JSON.parse(cursor.value as string) as { t?: number };
        if ((v.t ?? 0) < cutoff) cursor.delete();
      } catch {
        cursor.delete(); // unreadable entries have no timestamp to defend them
      }
      cursor.continue();
    };
  } catch {
    /* pruning is a nicety */
  }
}

export const bakeClipStore: ClipStore = {
  async get(key) {
    const hit = memCache.get(key);
    if (hit) return hit;
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => {
        try {
          const v = JSON.parse(req.result as string) as { a?: string };
          resolve(typeof v.a === "string" ? v.a : null);
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  },
  async put(key, b64) {
    memCache.set(key, b64);
    const db = await openDb();
    if (!db) return;
    pruneOld(db);
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(JSON.stringify({ t: Date.now(), a: b64 }), key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },
};
