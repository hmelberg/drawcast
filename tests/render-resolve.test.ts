import { describe, expect, it } from "vitest";
import { resolvedRenderSpec } from "../src/render/resolve";
import type { Spec } from "../src/spec/types";

const spec = (): Spec =>
  ({
    elements: [
      { id: "p1", type: "portrait", of: "Ricardo" },
      { id: "s1", type: "source", of: "Das Kapital" },
    ],
    commands: [],
  }) as unknown as Spec;

type El = { strokes?: string; source?: string };
const el = (s: Spec, i: number): El => (s.elements as unknown as El[])[i];

describe("resolvedRenderSpec — render never writes into the document (B11)", () => {
  it("hands a clone to the resolvers and returns it; the input spec stays byte-untouched", async () => {
    const doc = spec();
    const before = JSON.stringify(doc);
    const out = await resolvedRenderSpec(doc, {
      contactEmail: "x@y.z",
      resolvePortraits: async (s) => {
        el(s, 0).strokes = "t2:aa";
        el(s, 0).source = "https://example.org/ricardo.jpg";
      },
      resolveSources: async (s) => {
        el(s, 1).strokes = "img1:aa:data:,x";
      },
    });
    expect(out).not.toBe(doc);
    expect(el(out, 0).strokes).toBe("t2:aa");
    expect(el(out, 1).strokes).toBe("img1:aa:data:,x");
    // The test that matters: viewing must not rewrite the author's document.
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("swallows resolver failures — the figure degrades to placeholders, render never throws", async () => {
    const out = await resolvedRenderSpec(spec(), {
      contactEmail: "",
      resolvePortraits: async () => {
        throw new Error("no network");
      },
      resolveSources: async () => Promise.reject(new Error("paywalled")),
    });
    expect(el(out, 0).strokes).toBeUndefined();
  });

  it("passes the contact email through to the source resolver", async () => {
    let seen = "";
    await resolvedRenderSpec(spec(), {
      contactEmail: "hans@example.org",
      resolvePortraits: async () => {},
      resolveSources: async (_s, opts) => {
        seen = opts.contactEmail;
      },
    });
    expect(seen).toBe("hans@example.org");
  });
});
