import { describe, expect, it } from "vitest";
import { withAuthoredTemplates } from "../src/publish/embed";
import { DEFAULT_META, itemsOf, type Playlist } from "../src/playlist/playlist";
import type { Spec } from "../src/spec/types";

const cast = (...specs: object[]): Playlist => ({ meta: { ...DEFAULT_META }, entries: specs.map((spec) => ({ kind: "item" as const, spec: spec as Spec })), warnings: [] });

// A published copy carries the author's own templates (2026-09-24): a viewer
// has none of them, so a cast drawn on one would render blank.
const doc = { template: "my_bridge", title: "Bridge", layout: "return [];" };
const docOf = (id: string) => (id === "my_bridge" ? doc : null);

describe("withAuthoredTemplates", () => {
  it("embeds the doc into each item that uses an authored template, never touching the input", () => {
    const pl = cast({ template: "my_bridge" }, { template: "my_bridge" }, { template: "ppf" });
    const before = JSON.stringify(pl);
    const out = withAuthoredTemplates(pl, docOf);
    const specs = itemsOf(out).map((i) => i.spec);
    expect(specs[0].templates).toEqual([doc]);
    expect(specs[1].templates).toEqual([doc]);
    expect(specs[2].templates).toBeUndefined();
    expect(JSON.stringify(pl)).toBe(before);
  });

  it("leaves a cast alone when nothing is missing", () => {
    const plain = cast({ template: "ppf" });
    expect(withAuthoredTemplates(plain, docOf)).toBe(plain);
    const carried = cast({ template: "my_bridge", templates: [doc] });
    expect(withAuthoredTemplates(carried, docOf)).toBe(carried);
  });
});
