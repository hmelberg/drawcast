// Key algebra for view counting. Pure — no Blobs, no network.
import { describe, expect, test } from "vitest";
import {
  castKeyOfHitKey,
  castKeyOfRollup,
  courseFolderOf,
  dayOfHitKey,
  dayString,
  encodeCastKey,
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
  const enc = "hmelberg%2Fkurs%2Fcasts%2Fdid.yaml";

  test("a cast key becomes exactly one path segment", () => {
    expect(encodeCastKey(key)).toBe(enc);
    expect(encodeCastKey(key)).not.toContain("/");
  });

  test("hit and rollup keys are built from the encoded segment", () => {
    expect(hitPrefix(enc)).toBe(`h/${enc}/`);
    expect(hitKey(enc, "2026-09-04", "abc")).toBe(`h/${enc}/2026-09-04/abc`);
    expect(rollupKey(enc)).toBe(`r/${enc}`);
  });

  test("a repo prefix matches every cast in that repo and nothing else", () => {
    expect(hitKey(enc, "2026-09-04", "abc").startsWith(repoHitPrefix("hmelberg", "kurs"))).toBe(true);
    expect(rollupKey(enc).startsWith(repoRollupPrefix("hmelberg", "kurs"))).toBe(true);
    expect(hitKey(enc, "2026-09-04", "abc").startsWith(repoHitPrefix("hmelberg", "kur"))).toBe(false);
  });

  test("keys parse back into a cast key and a day", () => {
    expect(castKeyOfHitKey(`h/${enc}/2026-09-04/abc`)).toBe(key);
    expect(dayOfHitKey(`h/${enc}/2026-09-04/abc`)).toBe("2026-09-04");
    expect(castKeyOfRollup(`r/${enc}`)).toBe(key);
    expect(dayOfHitKey("h/nonsense")).toBeNull();
  });

  test("a malformed percent-sequence returns null instead of throwing", () => {
    // `list()` can hand back keys this module never wrote — a stray or
    // legacy blob in the same store — so decodeURIComponent must not be
    // trusted to succeed on them.
    expect(castKeyOfHitKey("h/broken%2/2026-09-04/abc")).toBeNull();
    expect(castKeyOfRollup("r/broken%2")).toBeNull();
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
