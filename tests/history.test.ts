// tests/history.test.ts
import { describe, expect, test } from "vitest";
import {
  MAX_VERSIONS, atNewest, currentVersion, emptyStack, pushManualEdit,
  pushVersion, restoreViewed, seedStack, viewAt,
} from "../src/history";

const TS = "2026-08-24T10:00:00.000Z";

describe("pushVersion", () => {
  test("appends and leaves the cursor on the newest version", () => {
    let s = seedStack("a", "first");
    s = pushVersion(s, { text: "b", label: "second", kind: "revise", ts: TS });
    expect(s.versions.map((v) => v.text)).toEqual(["a", "b"]);
    expect(s.cursor).toBe(1);
    expect(atNewest(s)).toBe(true);
  });

  test("records `from` only when pushing from a version that is not the newest", () => {
    let s = seedStack("a", "first");
    s = pushVersion(s, { text: "b", label: "second", kind: "revise", ts: TS });
    expect(currentVersion(s)!.from).toBeUndefined();

    s = viewAt(s, 0);
    s = pushVersion(s, { text: "c", label: "third", kind: "revise", ts: TS });
    expect(currentVersion(s)!.from).toBe("first");
    expect(s.versions).toHaveLength(3); // nothing was truncated
  });

  test("drops the oldest version past the cap, keeping the cursor newest", () => {
    let s = seedStack("v0", "v0");
    for (let i = 1; i <= MAX_VERSIONS + 3; i++) {
      s = pushVersion(s, { text: `v${i}`, label: `v${i}`, kind: "revise", ts: TS });
    }
    expect(s.versions).toHaveLength(MAX_VERSIONS);
    expect(s.versions[0].text).toBe(`v${MAX_VERSIONS + 3 - MAX_VERSIONS + 1}`);
    expect(currentVersion(s)!.text).toBe(`v${MAX_VERSIONS + 3}`);
    expect(s.cursor).toBe(MAX_VERSIONS - 1);
  });
});

describe("pushManualEdit", () => {
  test("coalesces consecutive manual edits into one version", () => {
    let s = seedStack("a", "first");
    s = pushManualEdit(s, "b", TS);
    s = pushManualEdit(s, "c", "2026-08-24T10:05:00.000Z");
    expect(s.versions).toHaveLength(2);
    expect(currentVersion(s)!.text).toBe("c");
    expect(currentVersion(s)!.ts).toBe("2026-08-24T10:05:00.000Z");
  });

  test("does not coalesce when an AI version intervened", () => {
    let s = seedStack("a", "first");
    s = pushManualEdit(s, "b", TS);
    s = pushVersion(s, { text: "c", label: "steeper", kind: "revise", ts: TS });
    s = pushManualEdit(s, "d", TS);
    expect(s.versions).toHaveLength(4);
  });

  test("does not coalesce when the cursor is not on the newest version", () => {
    let s = seedStack("a", "first");
    s = pushManualEdit(s, "b", TS);
    s = viewAt(s, 0);
    s = pushManualEdit(s, "c", TS);
    expect(s.versions).toHaveLength(3);
    expect(currentVersion(s)!.from).toBe("first");
  });
});

describe("restoreViewed", () => {
  test("appends a copy of the viewed version and keeps every earlier one", () => {
    let s = seedStack("a", "first");
    s = pushVersion(s, { text: "b", label: "second", kind: "revise", ts: TS });
    s = viewAt(s, 0);
    s = restoreViewed(s, TS);
    expect(s.versions.map((v) => v.text)).toEqual(["a", "b", "a"]);
    expect(currentVersion(s)!.label).toBe('restored "first"');
    expect(currentVersion(s)!.from).toBeUndefined(); // the label already names the parent
    expect(atNewest(s)).toBe(true);
  });
});

describe("viewAt", () => {
  test("clamps out-of-range indices", () => {
    let s = seedStack("a", "first");
    s = pushVersion(s, { text: "b", label: "second", kind: "revise", ts: TS });
    expect(viewAt(s, -5).cursor).toBe(0);
    expect(viewAt(s, 99).cursor).toBe(1);
  });

  test("an empty stack has no current version and reports newest", () => {
    const s = emptyStack();
    expect(currentVersion(s)).toBeNull();
    expect(atNewest(s)).toBe(true);
  });
});
