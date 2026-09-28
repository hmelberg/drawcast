import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { leafDrawables } from "../src/layout/model";
import { lintCommands } from "../src/lint/lint";
import { encodePhoto } from "../src/spec/trace";
import { linkFallbackTitle } from "../src/layout/tier2";
import type { Spec } from "../src/spec/types";

const spec = (el: Record<string, unknown>): Spec => ({ elements: [{ id: "go", type: "link", ...el }], commands: [{ draw: ["go"] }] }) as Spec;
const leafIds = (s: Spec): string[] => leafDrawables(layoutSpec(s, heuristicMeasure).drawables).map((d) => d.id);

describe("link element", () => {
  test("schema: href is required; form and open are enums", () => {
    expect(validateSpec(spec({ href: "./next.yaml" })).ok).toBe(true);
    expect(validateSpec(spec({ href: "lecture:2", form: "text", open: "window", title: "Next", image: "https://x.org/a.png", size: 240 })).ok).toBe(true);
    expect(validateSpec(spec({})).ok).toBe(false);
    expect(validateSpec(spec({ href: "./a.yaml", form: "button" })).ok).toBe(false);
    expect(validateSpec(spec({ href: "./a.yaml", open: "popup" })).ok).toBe(false);
  });

  test("a card with no picture is the fallback card: frame, title, play mark", () => {
    const ids = leafIds(spec({ href: "./03-the-theory.yaml" }));
    expect(ids).toEqual(expect.arrayContaining(["go__fallback", "go__mark", "go__frame"]));
    expect(ids).not.toContain("go__img");
  });

  test("a card with a picture shows it with the title under it", () => {
    const strokes = encodePhoto(0.75, "data:image/png;base64,AAAA");
    const ids = leafIds(spec({ href: "./a.yaml", title: "The theory", strokes }));
    expect(ids).toEqual(expect.arrayContaining(["go__img", "go__frame", "go__name"]));
    expect(ids).not.toContain("go__fallback");
  });

  test("size sets the card's width, and the group carries its box", () => {
    const layout = layoutSpec(spec({ href: "./a.yaml", size: 200, x: 500, y: 400 }), heuristicMeasure);
    const g = layout.drawables.find((d) => d.id === "go");
    expect(g?.kind === "group" && g.box).toEqual({ x: 395, y: 320, w: 210, h: 160 });
  });

  test("a text link is words and an underline", () => {
    const ids = leafIds(spec({ href: "./a.yaml", form: "text", title: "More" }));
    expect(ids).toEqual(["go__text", "go__line"]);
    const text = leafDrawables(layoutSpec(spec({ href: "./a.yaml", form: "text", title: "More" }), heuristicMeasure).drawables).find((d) => d.id === "go__text");
    expect(text?.kind === "text" && text.text).toBe("More ▸");
  });

  test("fallback titles", () => {
    expect(linkFallbackTitle("lecture:3")).toBe("Lecture 3");
    expect(linkFallbackTitle("./03-what-theory-holds.yaml")).toBe("What theory holds");
    expect(linkFallbackTitle("https://drawcast.app/#gh=o/r/c/intro_part.yaml")).toBe("Intro part");
  });

  test("lint warns on an unreadable href, not on a good one", () => {
    expect(lintCommands(spec({ href: "https://example.org/page" })).some((i) => i.rule === "link-target")).toBe(true);
    expect(lintCommands(spec({ href: "lecture:2" })).some((i) => i.rule === "link-target")).toBe(false);
  });
});
