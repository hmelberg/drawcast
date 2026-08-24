// The version stack behind the editor's ◀ ▶ arrows. Append-only by design:
// restoring an older version pushes a COPY rather than rewinding into it, so no
// user action ever removes a version and there is nothing to confirm. The only
// thing that drops a version is the age-based cap below.
//
// Phase 1 keeps this in memory only — versions are gone on reload. See
// docs/superpowers/specs/2026-08-24-revise-and-history-design.md §0.

export type VersionKind = "loaded" | "generate" | "revise" | "manual" | "restore";

export interface Version {
  /** The serialized document — exactly what the editor textarea holds. */
  text: string;
  label: string;
  kind: VersionKind;
  /** The parent's LABEL, set only when this version derived from a non-newest one. */
  from?: string;
  ts: string;
}

export interface Stack {
  versions: Version[];
  /** View cursor into `versions`; -1 only when the stack is empty. */
  cursor: number;
}

export const MAX_VERSIONS = 20;

export function emptyStack(): Stack {
  return { versions: [], cursor: -1 };
}

/** Reset to a single baseline version — a fresh generation, or a document just loaded. */
export function seedStack(text: string, label: string, kind: VersionKind = "loaded"): Stack {
  return { versions: [{ text, label, kind, ts: new Date().toISOString() }], cursor: 0 };
}

export function currentVersion(stack: Stack): Version | null {
  return stack.versions[stack.cursor] ?? null;
}

/** True when the cursor sits on the newest version — i.e. normal editing, not viewing. */
export function atNewest(stack: Stack): boolean {
  return stack.cursor === stack.versions.length - 1;
}

export function viewAt(stack: Stack, index: number): Stack {
  if (stack.versions.length === 0) return stack;
  const cursor = Math.min(Math.max(index, 0), stack.versions.length - 1);
  return { ...stack, cursor };
}

/**
 * Append a version. When the cursor is parked on an older version, the new one
 * records where it came from — a "restore" never does, because its own label
 * already names the parent and saying it twice reads as noise.
 */
export function pushVersion(stack: Stack, entry: Omit<Version, "from">): Stack {
  const parent = atNewest(stack) || entry.kind === "restore" ? undefined : currentVersion(stack)?.label;
  const versions = [...stack.versions, { ...entry, ...(parent ? { from: parent } : {}) }];
  // Age-based eviction, and the ONLY thing that removes a version.
  const trimmed = versions.length > MAX_VERSIONS ? versions.slice(versions.length - MAX_VERSIONS) : versions;
  return { versions: trimmed, cursor: trimmed.length - 1 };
}

/**
 * Hand-edits arrive as a stream with no natural boundary, so a run of them
 * collapses into ONE version whose timestamp refreshes; the next AI action seals
 * it. Without this the arrows fill with identical "manual edit" steps and push
 * the real revisions off the end.
 */
export function pushManualEdit(stack: Stack, text: string, ts: string): Stack {
  const newest = stack.versions[stack.versions.length - 1];
  if (newest && newest.kind === "manual" && atNewest(stack)) {
    const versions = [...stack.versions];
    versions[versions.length - 1] = { ...newest, text, ts };
    return { versions, cursor: versions.length - 1 };
  }
  return pushVersion(stack, { text, label: "manual edit", kind: "manual", ts });
}

/** Append a copy of the version being viewed. Never rewinds, never deletes. */
export function restoreViewed(stack: Stack, ts: string): Stack {
  const viewed = currentVersion(stack);
  if (!viewed) return stack;
  return pushVersion(stack, { text: viewed.text, label: `restored "${viewed.label}"`, kind: "restore", ts });
}
