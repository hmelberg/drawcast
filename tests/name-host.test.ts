// NAME.drawcast.app → drawcast.app/#name (name-host round, 2026-09-17). The
// pure rule behind the edge function: which hosts redirect, and to where.
// The registry then decides whether the name opens anything — an unknown
// label lands on the app's own "No drawcast called …", never a blank host.
import { describe, expect, test } from "vitest";
import { hostToHash, NAME_LABEL_RE, RESERVED_LABELS } from "../netlify/lib/name-host.mts";
import { NAME_RE, RESERVED_PREFIXES } from "../src/names";

describe("hostToHash", () => {
  test("a single label under drawcast.app redirects to the hash form", () => {
    expect(hostToHash("micro-i.drawcast.app")).toBe("https://drawcast.app/#micro-i");
  });
  test("the label is lower-cased and a port is ignored", () => {
    expect(hostToHash("Micro-I.drawcast.app:443")).toBe("https://drawcast.app/#micro-i");
  });
  test("the apex and www pass through (null)", () => {
    expect(hostToHash("drawcast.app")).toBeNull();
    expect(hostToHash("www.drawcast.app")).toBeNull();
  });
  test("two labels, other domains and Netlify's own hosts pass through", () => {
    expect(hostToHash("a.b.drawcast.app")).toBeNull();
    expect(hostToHash("drawcast.netlify.app")).toBeNull();
    expect(hostToHash("deploy-preview-12--drawcast.netlify.app")).toBeNull();
    expect(hostToHash("localhost:5173")).toBeNull();
    expect(hostToHash("evil-drawcast.app")).toBeNull();
  });
  test("a label the name rule refuses passes through — reserved prefixes and malformed labels alike", () => {
    expect(hostToHash("gh-foo.drawcast.app")).toBeNull();
    expect(hostToHash("anvil.drawcast.app")).toBeNull();
    expect(hostToHash("api.drawcast.app")).toBeNull();
    expect(hostToHash("-bad-.drawcast.app")).toBeNull();
    expect(hostToHash("under_score.drawcast.app")).toBeNull();
  });
  test("the label rule is the base half of the shared name rule, and the reserved list is the shared one", () => {
    // NAME_RE is `^<base>(?:/<sub>)?$`; a hostname has no sub-segment.
    const base = NAME_RE.source.replace(/\(\?:\\\/\[a-z0-9-\]\{1,20\}\)\?\$$/, "$");
    expect(NAME_LABEL_RE.source).toBe(base);
    expect([...RESERVED_LABELS]).toEqual([...RESERVED_PREFIXES]);
    expect(RESERVED_PREFIXES).toContain("www");
  });
});
