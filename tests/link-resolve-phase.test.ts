import { beforeEach, describe, expect, test } from "vitest";
import { clearLinkMemo, docFacts, resolveLinks, type LinkDeps } from "../src/render/link";
import { decodePhoto } from "../src/spec/trace";
import type { LinkBase } from "../src/links/resolve";
import type { Spec } from "../src/spec/types";

const gh: LinkBase = { kind: "gh", owner: "o", repo: "r", path: "c/01.yaml" };

function deps(files: Record<string, string>, pictures: string[]): LinkDeps & { loaded: string[] } {
  const loaded: string[] = [];
  return {
    loaded,
    fetch: (async (url: string) => (url in files ? new Response(files[url]) : new Response("", { status: 404 }))) as typeof fetch,
    loadRaster: async (url: string) => {
      loaded.push(url);
      if (!pictures.includes(url)) throw new Error("404");
      return { width: 4, height: 3 } as never;
    },
    encode: () => "data:image/png;base64,AAAA",
    base: () => gh,
    viewerBase: () => "https://www.drawcast.app",
  };
}

const link = (el: Record<string, unknown>): Spec => ({ elements: [{ id: "go", type: "link", ...el }], commands: [] }) as Spec;
const T = "https://raw.githubusercontent.com/o/r/HEAD/c/02.yaml";
const P = "https://raw.githubusercontent.com/o/r/HEAD/c/02.png";

describe("resolveLinks", () => {
  beforeEach(() => clearLinkMemo());

  test("docFacts reads the top-level title and poster only", () => {
    expect(docFacts('title: "The theory"\nposter: https://x.org/p.png\nentries:\n  - title: nested\n')).toEqual({ title: "The theory", poster: "https://x.org/p.png" });
    expect(docFacts("entries: []\n")).toEqual({});
  });

  test("title from the target; picture from its thumbnail", async () => {
    const spec = link({ href: "./02.yaml" });
    await resolveLinks(spec, deps({ [T]: "title: The theory\n" }, [P]));
    expect(spec.elements![0].title).toBe("The theory");
    expect(decodePhoto(spec.elements![0].strokes!)?.aspect).toBeCloseTo(0.75);
  });

  test("the author's image wins; a failed one falls through to the thumbnail", async () => {
    const d1 = deps({}, ["https://a.org/mine.png", P]);
    await resolveLinks(link({ href: "./02.yaml", title: "x", image: "https://a.org/mine.png" }), d1);
    expect(d1.loaded).toEqual(["https://a.org/mine.png"]);
    clearLinkMemo();
    const d2 = deps({}, [P]);
    const spec = link({ href: "./02.yaml", title: "x", image: "https://a.org/broken.png" });
    await resolveLinks(spec, d2);
    expect(d2.loaded).toEqual(["https://a.org/broken.png", P]);
    expect(spec.elements![0].strokes).toBeDefined();
  });

  test("then the target's own poster: field", async () => {
    const spec = link({ href: "./02.yaml" });
    const d = deps({ [T]: "title: T\nposter: https://x.org/own.png\n" }, ["https://x.org/own.png"]);
    await resolveLinks(spec, d);
    expect(d.loaded).toEqual([P, "https://x.org/own.png"]);
    expect(spec.elements![0].strokes).toBeDefined();
  });

  test("nothing loads: no picture, no throw (the fallback card)", async () => {
    const spec = link({ href: "./02.yaml" });
    await resolveLinks(spec, deps({}, []));
    expect(spec.elements![0].strokes).toBeUndefined();
    expect(spec.elements![0].title).toBeUndefined();
  });

  test("a text link fetches no picture", async () => {
    const d = deps({ [T]: "title: T\n" }, [P]);
    const spec = link({ href: "./02.yaml", form: "text" });
    await resolveLinks(spec, d);
    expect(d.loaded).toEqual([]);
    expect(spec.elements![0].title).toBe("T");
  });

  test("an unresolvable href is left alone", async () => {
    const spec = link({ href: "lecture:2" }); // no course base
    await resolveLinks(spec, deps({}, []));
    expect(spec.elements![0]).toEqual({ id: "go", type: "link", href: "lecture:2" });
  });
});
