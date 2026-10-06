// The site's address (src/site.ts, 2026-10-06: www.drawcast.app primary).
import { describe, expect, test } from "vitest";
import { liveUrl, SITE } from "../src/site";

describe("site", () => {
  test("www is the address", () => {
    expect(SITE).toBe("https://www.drawcast.app");
  });
  test("own functions are same-origin on drawcast's hosts, absolute elsewhere", () => {
    for (const h of ["drawcast.app", "www.drawcast.app", "drawcast.netlify.app", "deploy-preview-3--drawcast.netlify.app"]) expect(liveUrl("/api/feed", h), h).toBe("/api/feed");
    for (const h of ["localhost", "hmelberg.github.io", "drawcast.app.evil.test"]) expect(liveUrl("/api/feed", h), h).toBe("https://www.drawcast.app/api/feed");
  });
});
