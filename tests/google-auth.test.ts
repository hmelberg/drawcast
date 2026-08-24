import { describe, expect, test } from "vitest";
import { DRIVE_SCOPE, YOUTUBE_SCOPE, makeTokenStore } from "../src/google/auth";

describe("token store", () => {
  test("returns a token that is still comfortably valid", () => {
    let now = 1_000_000;
    const s = makeTokenStore(() => now);
    s.put(DRIVE_SCOPE, "tok-a", 3600);
    expect(s.get(DRIVE_SCOPE)).toBe("tok-a");
  });

  test("a Drive grant does NOT satisfy a YouTube request", () => {
    let now = 1_000_000;
    const s = makeTokenStore(() => now);
    s.put(DRIVE_SCOPE, "tok-a", 3600);
    expect(s.get(YOUTUBE_SCOPE)).toBeNull();
  });

  test("drops a token inside the 60s safety margin, so a long upload cannot start on one about to expire", () => {
    let now = 1_000_000;
    const s = makeTokenStore(() => now);
    s.put(DRIVE_SCOPE, "tok-a", 3600);
    now += (3600 - 61) * 1000;
    expect(s.get(DRIVE_SCOPE)).toBe("tok-a"); // 61s left — still usable
    now += 2000;
    expect(s.get(DRIVE_SCOPE)).toBeNull(); // 59s left — inside the margin
  });

  test("tokens() lists what sign-out has to revoke, each token once", () => {
    const s = makeTokenStore(() => 0);
    s.put(DRIVE_SCOPE, "tok-a", 3600);
    s.put(YOUTUBE_SCOPE, "tok-b", 3600);
    expect(s.tokens().sort()).toEqual(["tok-a", "tok-b"]);
    // Re-granting a scope replaces its entry rather than accumulating one.
    s.put(DRIVE_SCOPE, "tok-b", 3600);
    expect(s.tokens()).toEqual(["tok-b"]);
  });

  test("tokens() reports a token the expiry margin would already refuse — sign-out still revokes it", () => {
    let now = 1_000_000;
    const s = makeTokenStore(() => now);
    s.put(DRIVE_SCOPE, "tok-a", 3600);
    now += (3600 - 30) * 1000; // inside the 60s margin, so get() would hand out nothing
    expect(s.tokens()).toEqual(["tok-a"]);
  });

  test("clear() forgets every scope", () => {
    const s = makeTokenStore(() => 0);
    s.put(DRIVE_SCOPE, "tok-a", 3600);
    s.put(YOUTUBE_SCOPE, "tok-b", 3600);
    s.clear();
    expect(s.get(DRIVE_SCOPE)).toBeNull();
    expect(s.get(YOUTUBE_SCOPE)).toBeNull();
  });

  test("the only scopes this codebase knows are the two non-restricted ones", () => {
    // drive / drive.readonly are RESTRICTED scopes: requesting either triggers a
    // paid annual security assessment. This test is the tripwire.
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
    expect(YOUTUBE_SCOPE).toBe("https://www.googleapis.com/auth/youtube.upload");
  });
});
