// Round 6 §8: the Spec source editor folds `assets:` and long data strings;
// what the app reads from it is always the whole text.
import { describe, expect, test } from "vitest";
import { attachSpecFolding, foldSpecText, unfoldSpecText } from "../src/ui/spec-fold";
import { formatPlaylist, itemsOf, parsePlaylistText, singlePlaylist } from "../src/playlist/playlist";
import { encodeIconSvg } from "../src/spec/icon-data";
import bundled from "../src/examples.json";
import type { Spec } from "../src/spec/types";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><path fill="#d99e82" d="${"M1 1L2 2 ".repeat(40)}"/></svg>`;
const spec = {
  title: "Owls",
  elements: [
    { id: "b", type: "node", shape: "rect", text: "Owl", icon: "owl" },
    { id: "p", type: "portrait", name: "x", strokes: `t2:${"Ab".repeat(200)}` },
  ],
  commands: [{ draw: ["b"] }, { speak: `${"A long sentence the narrator says, with spaces in it. ".repeat(6)}` }],
  assets: { "icon.owl": encodeIconSvg("twemoji", "owl", svg), foto: "abc" },
} as unknown as Spec;

describe("folding the spec text", () => {
  const text = formatPlaylist(singlePlaylist(spec), "script");
  const { shown, folds } = foldSpecText(text);

  test("the assets block is one marker line; a long encoded string is a marker; narration is not folded", () => {
    expect(shown).toMatch(/```assets\n⟪folded #\d+ · assets, 2 entries, \d+ (KB|B)⟫\n```/);
    expect(shown).not.toContain("ics1:");
    expect(shown).not.toContain("Ab".repeat(100));
    expect(shown).toContain("A long sentence the narrator says");
    expect(shown.length).toBeLessThan(text.length / 2);
  });
  test("unfolding gives back exactly the text", () => {
    expect(unfoldSpecText(shown, folds)).toBe(text);
  });
  test("a YAML assets key folds too", () => {
    const yaml = "title: x\nelements: []\nassets:\n  foto: abc\n  icon.owl: ics1:twemoji:owl:<svg/>\n";
    const f = foldSpecText(yaml);
    expect(f.shown).toBe(`title: x\nelements: []\nassets:\n  ⟪folded #0 · assets, 2 entries, ${f.folds[0].length} B⟫\n`);
    expect(f.folds[0]).toBe("foto: abc\n  icon.owl: ics1:twemoji:owl:<svg/>");
    expect(unfoldSpecText(f.shown, f.folds)).toBe(yaml);
  });
  test("every bundled example round-trips through the fold", () => {
    for (const e of bundled as { spec?: Spec; playlist?: string }[]) {
      const t = e.playlist ?? formatPlaylist(singlePlaylist(e.spec!), "script");
      const f = foldSpecText(t);
      expect(unfoldSpecText(f.shown, f.folds)).toBe(t);
    }
  });
});

describe("a folded textarea", () => {
  class FakeArea {
    #v = "";
    get value(): string {
      return this.#v;
    }
    set value(v: string) {
      this.#v = v;
    }
    /** What the screen shows. */
    get shown(): string {
      return this.#v;
    }
    type(next: string): void {
      this.#v = next;
    }
  }
  const text = formatPlaylist(singlePlaylist(spec), "script");

  test("reads the whole text, shows the folded one, and keeps an edit around a marker", () => {
    const area = new FakeArea();
    attachSpecFolding(area);
    area.value = text;
    expect(area.shown).toContain("⟪folded #");
    expect(area.value).toBe(text);
    // The author retitles the cast: the data is still all there.
    area.type(area.shown.replace("# Owls", "# Owls at night"));
    expect(area.value).toBe(text.replace("# Owls", "# Owls at night"));
    expect(itemsOf(parsePlaylistText(area.value))[0].spec.assets!["icon.owl"]).toBe(spec.assets!["icon.owl"]);
  });
  test("detaching shows the whole text again", () => {
    const area = new FakeArea();
    const detach = attachSpecFolding(area);
    area.value = text;
    detach();
    expect(area.shown).toBe(text);
  });
});
