// The viewer's own lists (save round, 2026-10-04): Saved (the ♡ under the
// player) and Liked (the open thumb) come from Anvil — POST /my/list answers
// them as catalogue items, only what is still listed and public — and History
// is kept in this browser alone (localStorage), so it works signed out.

import { apiBase, DEFAULT_ENROLL_API } from "../learn";
import { parseCatalogueItem, type CatalogueItem } from "../catalogue";

export type MyList = "saved" | "liked" | "history";
export const MY_LISTS: { id: MyList; label: string; empty: string }[] = [
  { id: "saved", label: "Saved", empty: "Nothing saved yet — press ♡ Save under a drawcast to keep it here." },
  { id: "liked", label: "Liked", empty: "Nothing liked yet — the thumbs under a drawcast put it here." },
  { id: "history", label: "Watch history", empty: "Nothing watched in this browser yet." },
];

const HISTORY_KEY = "drawcast.history";
/** How many names History keeps (the catalogue answers at most 50 by name). */
export const HISTORY_MAX = 50;

export interface HistoryEntry {
  name: string;
  at: number;
}

function store(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** History newest first; a broken entry is dropped, never thrown. */
export function readHistory(s: Storage | null = store()): HistoryEntry[] {
  try {
    const raw = JSON.parse(s?.getItem(HISTORY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is HistoryEntry => !!e && typeof (e as HistoryEntry).name === "string" && typeof (e as HistoryEntry).at === "number");
  } catch {
    return [];
  }
}

/** A watch: to the top, once (a lecture `course/3` counts as its course). */
export function recordWatch(rawName: string, now = Date.now(), s: Storage | null = store()): HistoryEntry[] {
  const name = rawName.split("/", 1)[0].trim();
  if (!name) return readHistory(s);
  const next = [{ name, at: now }, ...readHistory(s).filter((e) => e.name !== name)].slice(0, HISTORY_MAX);
  try {
    s?.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* full or blocked: history is a convenience */
  }
  return next;
}

export function clearHistory(s: Storage | null = store()): void {
  try {
    s?.removeItem(HISTORY_KEY);
  } catch {
    /* nothing to do */
  }
}

/** Saved or Liked from the registry; "signin" when the session is gone. */
export async function fetchMyList(list: "saved" | "liked", key: string, fetchImpl: typeof fetch = fetch, api = DEFAULT_ENROLL_API): Promise<CatalogueItem[] | "signin" | "error"> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/my/list`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key, list }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) return "signin";
    if (!res.ok) return "error";
    const body = (await res.json()) as { items?: unknown };
    if (!Array.isArray(body.items)) return "error";
    return body.items.map(parseCatalogueItem).filter((i): i is CatalogueItem => i !== null);
  } catch {
    return "error";
  }
}

export function parseMyList(value: string | null): MyList | null {
  return MY_LISTS.some((l) => l.id === value) ? (value as MyList) : null;
}
