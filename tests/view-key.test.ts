// Key algebra for view counting. Pure — no Blobs, no network.
import { describe, expect, test } from "vitest";
import {
  castKeyOfHitKey,
  castKeyOfRollup,
  courseFolderOf,
  dayOfHitKey,
  dayString,
  hitKey,
  hitPrefix,
  isValidCastKey,
  repoHitPrefix,
  repoRollupPrefix,
  rollupKey,
} from "../netlify/lib/view-key.mts";

describe("isValidCastKey", () => {
  test("accepts what the viewer itself can open", () => {
    expect(isValidCastKey("hmelberg/kurs/casts/did.yaml")).toBe(true);
    expect(isValidCastKey("hmelberg/kurs/courses/causal/did.yml")).toBe(true);
    expect(isValidCastKey("h-m.b/re-po.x/a/b/c.json")).toBe(true);
    expect(isValidCastKey("hmelberg/kurs/notes.txt")).toBe(true);
  });

  test("rejects traversal, wrong extensions and short paths", () => {
    expect(isValidCastKey("hmelberg/kurs/../secrets.yaml")).toBe(false);
    expect(isValidCastKey("hmelberg/kurs/did.exe")).toBe(false);
    expect(isValidCastKey("hmelberg/did.yaml")).toBe(false);
    expect(isValidCastKey("/hmelberg/kurs/did.yaml")).toBe(false);
    expect(isValidCastKey("")).toBe(false);
  });

  test("rejects a key long enough to threaten the 600-byte Blobs key limit", () => {
    expect(isValidCastKey(`a/b/${"x".repeat(400)}.yaml`)).toBe(false);
  });

  test("rejects characters that would change meaning once encoded", () => {
    expect(isValidCastKey("hmelberg/kurs/a b.yaml")).toBe(false);
    expect(isValidCastKey("hmelberg/kurs/a%2Fb.yaml")).toBe(false);
  });
});

describe("blob key construction", () => {
  const key = "hmelberg/kurs/casts/did.yaml";

  test("hit and rollup keys use the cast key's own slashes as real path separators", () => {
    expect(hitPrefix(key)).toBe(`h/${key}/`);
    expect(hitKey(key, "2026-09-04", "abc")).toBe(`h/${key}/2026-09-04/abc`);
    expect(rollupKey(key)).toBe(`r/${key}`);
  });

  test("REGRESSION: constructed keys/prefixes never introduce a percent-encoded character", () => {
    // The Netlify Blobs SDK embeds set/get/delete's `key` directly into the
    // request PATH, but sends list's `prefix` through URLSearchParams, which
    // independently re-encodes it. A key built by percent-encoding the cast
    // key's slashes into one segment (the previous design here) therefore
    // travels the wire with a DIFFERENT number of encoding layers depending
    // on which operation carries it — verified directly against both
    // Netlify's own local Blobs emulator (leaves path segments un-decoded:
    // the encoded form matched) and a plain one-decode-per-segment router,
    // what most real HTTP frameworks do (it matched NOTHING). That second
    // case is what production actually did: every POST "succeeded" while
    // every list() came back empty, with no lag — not eventually-consistency,
    // a permanent mismatch. A fake in-memory store — see view-store.test.ts —
    // cannot reproduce that: it does `.startsWith()` on whatever plain JS
    // string it's handed, blind to how the real HTTP API would have encoded
    // it, which is exactly how the bug shipped with green tests. This test
    // instead pins the necessary (not sufficient) condition checkable
    // without a platform: a valid cast key never contains "%" (see
    // CAST_KEY_RE), so nothing built from one should either. Only the live
    // smoke test against the deployed function exercises the real wire
    // encoding this pins the precondition for.
    const built = [
      hitKey(key, "2026-09-04", "abc"),
      hitPrefix(key),
      rollupKey(key),
      repoHitPrefix("hmelberg", "kurs"),
      repoRollupPrefix("hmelberg", "kurs"),
    ];
    for (const s of built) {
      expect(s).not.toContain("%");
      expect(decodeURIComponent(s)).toBe(s); // idempotent under decode
    }
  });

  test("a repo prefix matches every cast in that repo and nothing else", () => {
    expect(hitKey(key, "2026-09-04", "abc").startsWith(repoHitPrefix("hmelberg", "kurs"))).toBe(true);
    expect(rollupKey(key).startsWith(repoRollupPrefix("hmelberg", "kurs"))).toBe(true);
    expect(hitKey(key, "2026-09-04", "abc").startsWith(repoHitPrefix("hmelberg", "kur"))).toBe(false);
  });

  test("keys parse back into a cast key and a day", () => {
    expect(castKeyOfHitKey(`h/${key}/2026-09-04/abc`)).toBe(key);
    expect(dayOfHitKey(`h/${key}/2026-09-04/abc`)).toBe("2026-09-04");
    expect(castKeyOfRollup(`r/${key}`)).toBe(key);
    expect(dayOfHitKey("h/nonsense")).toBeNull();
  });

  test("a cast key with more path segments still round-trips", () => {
    const deep = "hmelberg/kurs/courses/causal/methods/did.yaml";
    expect(castKeyOfHitKey(hitKey(deep, "2026-09-04", "abc"))).toBe(deep);
    expect(dayOfHitKey(hitKey(deep, "2026-09-04", "abc"))).toBe("2026-09-04");
    expect(castKeyOfRollup(rollupKey(deep))).toBe(deep);
  });

  test("a stray key that isn't a valid cast key returns null instead of throwing or misparsing", () => {
    // `list()` can hand back keys this module never wrote — a stray blob in
    // the same store, or an orphan from the old percent-encoded layout (a
    // literal "%" is never a valid cast key character, so those are
    // rejected here rather than silently treated as live).
    expect(castKeyOfHitKey("h/broken%2/2026-09-04/abc")).toBeNull();
    expect(castKeyOfRollup("r/broken%2")).toBeNull();
    expect(castKeyOfHitKey("h/hmelberg/kurs/noext/2026-09-04/abc")).toBeNull(); // no valid extension
    expect(castKeyOfHitKey("h/hmelberg%2Fkurs%2Fcasts%2Fdid.yaml/2026-09-04/abc")).toBeNull(); // pre-fix orphan
    expect(castKeyOfRollup("r/hmelberg%2Fkurs%2Fcasts%2Fdid.yaml")).toBeNull(); // pre-fix orphan
  });
});

describe("dayString", () => {
  test("is UTC, so a day means the same thing everywhere", () => {
    expect(dayString(Date.UTC(2026, 8, 4, 23, 30))).toBe("2026-09-04");
    expect(dayString(Date.UTC(2026, 8, 5, 0, 30))).toBe("2026-09-05");
  });

  test("sorts chronologically as a string, which compaction relies on", () => {
    expect(dayString(Date.UTC(2026, 8, 4)) < dayString(Date.UTC(2026, 8, 5))).toBe(true);
  });
});

describe("courseFolderOf", () => {
  test("groups lectures by the folder the course publishes into", () => {
    expect(courseFolderOf("hmelberg/kurs/courses/causal/did.yaml")).toBe("courses/causal");
    expect(courseFolderOf("hmelberg/kurs/casts/did.yaml")).toBe("casts");
  });
});
