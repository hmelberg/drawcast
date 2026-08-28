// Link-kind sniffing and card actions: YouTube in all its spellings, wiki
// with language subdomains, pdf by path (and arxiv), everything else a
// plain new-tab url; actions get kind faces, hostname disambiguation for
// same-kind duplicates, and the four-action cap.
import { describe, expect, test } from "vitest";
import { linkKindOf, linkActionsFor } from "../src/ui/link-model";

describe("linkKindOf", () => {
  test("youtube variants yield the id", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    ]) {
      expect(linkKindOf(u)).toEqual({ kind: "youtube", id: "dQw4w9WgXcQ" });
    }
  });
  test("wikipedia articles yield language and title", () => {
    expect(linkKindOf("https://en.wikipedia.org/wiki/David_Ricardo")).toEqual({ kind: "wiki", lang: "en", title: "David_Ricardo" });
    expect(linkKindOf("https://no.m.wikipedia.org/wiki/Adam_Smith")).toEqual({ kind: "wiki", lang: "no", title: "Adam_Smith" });
  });
  test("pdf by extension and arxiv", () => {
    expect(linkKindOf("https://example.org/papers/wealth.pdf")).toEqual({ kind: "pdf" });
    expect(linkKindOf("https://example.org/papers/wealth.PDF?dl=1")).toEqual({ kind: "pdf" });
    expect(linkKindOf("https://arxiv.org/pdf/2401.12345")).toEqual({ kind: "pdf" });
  });
  test("everything else (and junk) is a plain url", () => {
    expect(linkKindOf("https://www.nber.org/papers/w1234")).toEqual({ kind: "url" });
    expect(linkKindOf("not a url")).toEqual({ kind: "url" });
    expect(linkKindOf("https://www.youtube.com/")).toEqual({ kind: "url" }); // no video id
  });
});

describe("linkActionsFor", () => {
  test("one action per link with kind faces", () => {
    const a = linkActionsFor([
      "https://youtu.be/dQw4w9WgXcQ",
      "https://example.org/wealth.pdf",
      "https://en.wikipedia.org/wiki/David_Ricardo",
      "https://www.nber.org/papers/w1234",
    ]);
    expect(a.map((x) => x.label)).toEqual(["📺 Watch", "📕 PDF", "📖 Wikipedia", "🌐 nber.org"]);
  });
  test("same-kind duplicates get hostnames; dedup and cap at four", () => {
    const a = linkActionsFor([
      "https://arxiv.org/pdf/2401.12345",
      "https://www.nber.org/w1.pdf",
      "https://www.nber.org/w1.pdf",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtu.be/aaaaaaaaaaa",
      "https://example.org/extra",
    ]);
    expect(a).toHaveLength(4);
    expect(a.map((x) => x.label)).toEqual(["📕 PDF · arxiv.org", "📕 PDF · nber.org", "📺 Watch · youtu.be", "📺 Watch · youtu.be"]);
  });
});
