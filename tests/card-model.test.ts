// Info-card targets: portraits and authored labels qualify, symbols and
// internals don't; Search carries the drawcast's title as context.
import { describe, expect, test } from "vitest";
import { cardTargets, meaningfulName, searchUrl } from "../src/ui/card-model";
import type { Spec } from "../src/spec/types";

const spec = (elements: unknown[]): Spec => ({ elements, commands: [] }) as unknown as Spec;

describe("meaningfulName", () => {
  test("real names pass; curve symbols and numbers don't", () => {
    for (const good of ["GDP", "Demand curve", "Mitochondria", "Løvborg"]) expect(meaningfulName(good)).toBe(true);
    for (const bad of ["D", "P*", "D′", "42", "Q*′", "  "]) expect(meaningfulName(bad)).toBe(false);
  });
});

describe("cardTargets", () => {
  test("portraits carry their person and wiki identity", () => {
    const t = cardTargets(spec([{ id: "ricardo", type: "portrait", of: "David Ricardo" }]));
    expect(t.get("ricardo")).toEqual({ id: "ricardo", name: "David Ricardo", kind: "portrait", wikiName: "David Ricardo", links: [] });
  });
  test("label elements name themselves AND what they attach to; symbols are skipped", () => {
    const t = cardTargets(
      spec([
        { id: "mito", type: "circle" },
        { id: "mito_lbl", type: "label", text: "Mitochondria", attach_to: "mito" },
        { id: "d_lbl", type: "label", text: "D", attach_to: "demand" },
        { id: "num", type: "label", text: "42" },
      ]),
    );
    expect(t.get("mito")?.name).toBe("Mitochondria");
    expect(t.get("mito_lbl")?.name).toBe("Mitochondria");
    expect(t.has("d_lbl")).toBe(false);
    expect(t.has("demand")).toBe(false);
    expect(t.has("num")).toBe(false);
  });
  test("a portrait wins over a label attached to it", () => {
    const t = cardTargets(
      spec([
        { id: "p1", type: "portrait", of: "Charles Darwin" },
        { id: "l1", type: "label", text: "Evolution man", attach_to: "p1" },
      ]),
    );
    expect(t.get("p1")?.kind).toBe("portrait");
    expect(t.get("p1")?.name).toBe("Charles Darwin");
    expect(t.get("l1")?.name).toBe("Evolution man");
  });
  test("portrait internals (__name captions) and missing ids never qualify", () => {
    const t = cardTargets(spec([{ id: "p__name", type: "label", text: "David Ricardo" }, { type: "portrait", of: "Someone" }]));
    expect(t.size).toBe(0);
  });
  test("a spec without elements yields no targets", () => {
    expect(cardTargets({ commands: [] } as unknown as Spec).size).toBe(0);
  });
  test("links make an unlabeled element card-bearing, named by its id", () => {
    const t = cardTargets(spec([{ id: "wealth_book", type: "shape", link: ["https://x.org/won.pdf"] }]));
    expect(t.get("wealth_book")).toEqual({ id: "wealth_book", name: "wealth book", kind: "plain", links: ["https://x.org/won.pdf"] });
  });
  test("links merge from the element and its label, deduped; a bare string link tolerated", () => {
    const t = cardTargets(
      spec([
        { id: "book", type: "shape", link: "https://x.org/won.pdf" },
        { id: "book_lbl", type: "label", text: "Wealth of Nations", attach_to: "book", link: ["https://youtu.be/dQw4w9WgXcQ", "https://x.org/won.pdf"] },
      ]),
    );
    expect(t.get("book")?.name).toBe("Wealth of Nations");
    expect(t.get("book")?.links).toEqual(["https://youtu.be/dQw4w9WgXcQ", "https://x.org/won.pdf"]);
    expect(t.get("book_lbl")?.links).toEqual(["https://youtu.be/dQw4w9WgXcQ", "https://x.org/won.pdf"]);
  });
  test("a portrait keeps its person name but gains an attached label's links", () => {
    const t = cardTargets(
      spec([
        { id: "p1", type: "portrait", of: "Adam Smith", link: ["https://x.org/won.pdf"] },
        { id: "l1", type: "label", text: "The author", attach_to: "p1", link: ["https://youtu.be/dQw4w9WgXcQ"] },
      ]),
    );
    expect(t.get("p1")?.name).toBe("Adam Smith");
    expect(t.get("p1")?.kind).toBe("portrait");
    expect(t.get("p1")?.links).toEqual(["https://youtu.be/dQw4w9WgXcQ", "https://x.org/won.pdf"]);
  });
});

describe("searchUrl", () => {
  test("joins name and context, URL-encoded", () => {
    expect(searchUrl("demand curve", "Supply and demand")).toBe(
      "https://www.google.com/search?q=demand%20curve%20Supply%20and%20demand",
    );
    expect(searchUrl("GDP")).toBe("https://www.google.com/search?q=GDP");
  });
});
