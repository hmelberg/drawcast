// tests/share-link.test.ts
// What Share hands out (spec 2026-10-02-share-design §§3, 6): a /c/ path
// wherever a card is possible, the plain # link where it is not, nothing for
// a cast that lives only in its own link.
import { describe, expect, test } from "vitest";
import { parseSharePath } from "../netlify/lib/share-card.mts";
import { COMMENT_MAX, platformUrl, shareLinkFor, TAKES_TEXT } from "../src/share/link";

describe("shareLinkFor", () => {
  test("names and sub-names become /c/ links", () => {
    expect(shareLinkFor("#vaccines")).toEqual({ url: "https://www.drawcast.app/c/vaccines", card: true });
    expect(shareLinkFor("#learn-russian/3&mode=silent")).toEqual({ url: "https://www.drawcast.app/c/learn-russian/3", card: true });
  });
  test("GitHub casts become /c/gh/ links, either spelling", () => {
    expect(shareLinkFor("#gh=ann/casts/casts/herd.yaml&speed=1.5")).toEqual({ url: "https://www.drawcast.app/c/gh/ann/casts/casts/herd.yaml", card: true });
    expect(shareLinkFor("#gh-ann/casts/casts/herd.yaml")).toEqual({ url: "https://www.drawcast.app/c/gh/ann/casts/casts/herd.yaml", card: true });
  });
  test("server and Drive casts keep their # link, with no card", () => {
    expect(shareLinkFor("#anvil=srv/intro.yaml&join")).toEqual({ url: "https://www.drawcast.app/#anvil=srv/intro.yaml", card: false });
    expect(shareLinkFor("#gdrive=abcdefghijkl")).toEqual({ url: "https://www.drawcast.app/#gdrive=abcdefghijkl", card: false });
  });
  test("nothing to share for a cast inside its link, a paste, or no hash", () => {
    for (const h of ["#cast=eJx", "#paste", "", "#"]) expect(shareLinkFor(h), h).toBeNull();
  });
  test("a gh path the /c/ parser would refuse keeps its # link, with no card", () => {
    for (const p of ["ann/casts/a%20b.yaml", "ann/casts/a b.yaml", "ann/casts/../x.yaml", "ann/casts/./x.yaml", "ann/casts/é.yaml", "ann/casts/a//b.yaml"]) {
      expect(shareLinkFor(`#gh=${p}`), p).toEqual({ url: `https://www.drawcast.app/#gh=${p}`, card: false });
    }
  });
  test("every /c/ link it hands out is one the card function parses back to the same cast (the two rules cannot drift)", () => {
    const hashes = ["#vaccines", "#learn-russian/3", "#gh=ann/casts/casts/herd.yaml", "#gh-ann/casts/x.yml", "#gh=a.b/c_d/e-f/g.h.YAML", "#gh=ann/casts/a%20b.yaml", "#gh=ann/casts/../x.yaml", "#gh=ann/casts/a b.yaml", "#gh=ann/casts/./x.yaml"];
    for (const h of hashes) {
      const link = shareLinkFor(h);
      expect(link, h).not.toBeNull();
      if (!link!.card) continue;
      const t = parseSharePath(new URL(link!.url).pathname, "/c/");
      expect(t, h).not.toBeNull();
      const back = t!.kind === "name" ? `#${t!.name}` : `#gh=${t!.owner}/${t!.repo}/${t!.path}`;
      expect(back, h).toBe(h.replace(/^#gh-/, "#gh="));
    }
  });
  test("the origin is the one given", () => {
    expect(shareLinkFor("#vaccines", "http://localhost:8888")?.url).toBe("http://localhost:8888/c/vaccines");
  });
});

describe("platformUrl", () => {
  const s = { url: "https://www.drawcast.app/c/vaccines", title: "Why vaccines work", comment: "Thought of you & this" };
  test("each platform gets the link; those that take text get the comment", () => {
    expect(platformUrl("facebook", s)).toBe("https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fwww.drawcast.app%2Fc%2Fvaccines");
    expect(platformUrl("linkedin", s)).toBe("https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fwww.drawcast.app%2Fc%2Fvaccines");
    expect(platformUrl("x", s)).toBe("https://x.com/intent/post?url=https%3A%2F%2Fwww.drawcast.app%2Fc%2Fvaccines&text=Thought%20of%20you%20%26%20this");
    expect(platformUrl("bluesky", s)).toBe("https://bsky.app/intent/compose?text=Thought%20of%20you%20%26%20this%20https%3A%2F%2Fwww.drawcast.app%2Fc%2Fvaccines");
    expect(platformUrl("whatsapp", s)).toBe("https://wa.me/?text=Thought%20of%20you%20%26%20this%20https%3A%2F%2Fwww.drawcast.app%2Fc%2Fvaccines");
    expect(platformUrl("email", s)).toBe("mailto:?subject=Why%20vaccines%20work&body=Thought%20of%20you%20%26%20this%0A%0Ahttps%3A%2F%2Fwww.drawcast.app%2Fc%2Fvaccines");
  });
  test("no comment: the title is the text, and the email body is just the link", () => {
    const n = { ...s, comment: "  " };
    expect(platformUrl("x", n)).toContain("&text=Why%20vaccines%20work");
    expect(platformUrl("email", n)).toBe("mailto:?subject=Why%20vaccines%20work&body=https%3A%2F%2Fwww.drawcast.app%2Fc%2Fvaccines");
  });
  test("a comment over the limit is cut", () => {
    const long = { ...s, comment: "y".repeat(400) };
    const whatsappUrl = platformUrl("whatsapp", long);
    const textParam = whatsappUrl.split("?text=")[1] || "";
    expect(decodeURIComponent(textParam).startsWith("y".repeat(COMMENT_MAX) + " https")).toBe(true);
  });
  test("Facebook and LinkedIn take no text", () => {
    expect(TAKES_TEXT).toEqual({ facebook: false, linkedin: false, x: true, bluesky: true, whatsapp: true, email: true });
  });
});

describe(".cast casts (published since 2026-10-03) get card links too", () => {
  test("a #gh= .cast link becomes a /c/gh/ link, and parseSharePath takes it back", async () => {
    const { parseSharePath } = await import("../netlify/lib/share-card.mts");
    const link = shareLinkFor("#gh=ann/casts/casts/herd.cast&mode=silent");
    expect(link).toEqual({ url: "https://www.drawcast.app/c/gh/ann/casts/casts/herd.cast", card: true });
    expect(parseSharePath(new URL(link!.url).pathname, "/c/")).toEqual({ kind: "gh", owner: "ann", repo: "casts", path: "casts/herd.cast" });
  });
  test("another extension still keeps its # link", () => {
    expect(shareLinkFor("#gh=ann/casts/casts/herd.json")).toEqual({ url: "https://www.drawcast.app/#gh=ann/casts/casts/herd.json", card: false });
  });
});
