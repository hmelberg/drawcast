// Round 6 §8: the Spec source editor folds `assets:` and long data strings;
// what the app reads from it is always the whole text.
import { describe, expect, test } from "vitest";
import { attachSpecFolding, foldSpecText, leftoverFoldMarker, unfoldSpecText, type ClipboardLike } from "../src/ui/spec-fold";
import { checkSaveable } from "../src/ui/save-gate";
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
  const { shown, folds, nonce } = foldSpecText(text, "ab12");

  test("the assets block is one marker line; a long encoded string is a marker; narration is not folded", () => {
    expect(shown).toMatch(/```assets\n⟪folded ab12#\d+ · assets, 2 entries, \d+ (KB|B)⟫\n```/);
    expect(shown).not.toContain("ics1:");
    expect(shown).not.toContain("Ab".repeat(100));
    expect(shown).toContain("A long sentence the narrator says");
    expect(shown.length).toBeLessThan(text.length / 2);
  });
  test("unfolding gives back exactly the text", () => {
    expect(unfoldSpecText(shown, folds, nonce)).toBe(text);
  });
  test("a YAML assets key folds too", () => {
    const yaml = "title: x\nelements: []\nassets:\n  foto: abc\n  icon.owl: ics1:twemoji:owl:<svg/>\n";
    const f = foldSpecText(yaml, "zz99");
    expect(f.shown).toBe(`title: x\nelements: []\nassets:\n  ⟪folded zz99#0 · assets, 2 entries, ${f.folds[0].length} B⟫\n`);
    expect(f.folds[0]).toBe("foto: abc\n  icon.owl: ics1:twemoji:owl:<svg/>");
    expect(unfoldSpecText(f.shown, f.folds, f.nonce)).toBe(yaml);
  });
  test("every bundled example round-trips through the fold", () => {
    for (const e of bundled as { spec?: Spec; playlist?: string }[]) {
      const t = e.playlist ?? formatPlaylist(singlePlaylist(e.spec!), "script");
      const f = foldSpecText(t);
      expect(unfoldSpecText(f.shown, f.folds, f.nonce)).toBe(t);
    }
  });
});

describe("a folded textarea", () => {
  class FakeArea {
    #v = "";
    selectionStart = 0;
    selectionEnd = 0;
    handlers = new Map<string, (e: ClipboardLike) => void>();
    inputs = 0;
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
    select(from: number, to: number): void {
      this.selectionStart = from;
      this.selectionEnd = to;
    }
    setSelectionRange(a: number, b: number): void {
      this.select(a, b);
    }
    addEventListener(type: string, fn: (e: ClipboardLike) => void): void {
      this.handlers.set(type, fn);
    }
    dispatchEvent(): boolean {
      this.inputs++;
      return true;
    }
    /** A copy or cut: what lands on the clipboard (null when the browser's own copy runs). */
    clip(type: "copy" | "cut"): string | null {
      let data: string | null = null;
      let prevented = false;
      this.handlers.get(type)!({
        type,
        clipboardData: { setData: (_f: string, d: string) => void (data = d) },
        preventDefault: () => void (prevented = true),
      });
      return prevented ? data : null;
    }
  }
  const text = formatPlaylist(singlePlaylist(spec), "script");

  test("reads the whole text, shows the folded one, and keeps an edit around a marker", () => {
    const area = new FakeArea();
    attachSpecFolding(area);
    area.value = text;
    expect(area.shown).toMatch(/⟪folded [a-z0-9]{4}#/);
    expect(area.value).toBe(text);
    // The author retitles the cast: the data is still all there.
    area.type(area.shown.replace("# Owls", "# Owls at night"));
    expect(area.value).toBe(text.replace("# Owls", "# Owls at night"));
    expect(itemsOf(parsePlaylistText(area.value))[0].spec.assets!["icon.owl"]).toBe(spec.assets!["icon.owl"]);
  });
  test("detaching shows the whole text again", () => {
    const area = new FakeArea();
    const folding = attachSpecFolding(area);
    area.value = text;
    folding.detach();
    expect(area.shown).toBe(text);
  });

  test("a marker pasted from another document is never read as this one's data — and is named", () => {
    const a = new FakeArea();
    attachSpecFolding(a);
    a.value = text;
    const markerLine = a.shown.split("\n").find((l) => l.startsWith("⟪folded"))!;
    const b = new FakeArea();
    attachSpecFolding(b);
    const other = formatPlaylist(singlePlaylist({ ...spec, assets: { "icon.owl": encodeIconSvg("twemoji", "cat", svg), x: "y" } } as Spec), "script");
    b.value = other;
    // Doc B's own assets marker replaced by A's (a paste over it).
    const own = b.shown.split("\n").find((l) => l.startsWith("⟪folded"))!;
    b.type(b.shown.replace(own, markerLine));
    expect(b.value).toContain(markerLine);
    expect(b.value).not.toContain(":owl:");
    expect(parsePlaylistText(b.value).warnings.join(" ")).toMatch(/folded-data marker/);
    expect(checkSaveable(b.value)).toMatchObject({ ok: false, reason: expect.stringMatching(/folded-data marker/) });
  });
  test("a half-edited marker is named, not saved", () => {
    const a = new FakeArea();
    attachSpecFolding(a);
    a.value = text;
    a.type(a.shown.replace(/(⟪folded [a-z0-9]+)#/, "$1"));
    expect(leftoverFoldMarker(a.value)).not.toBeNull();
    const refused = checkSaveable(a.value);
    expect(refused.ok ? "" : refused.reason).toMatch(/folded-data marker/);
    const plain = checkSaveable(text);
    expect(plain.ok ? "" : plain.reason).not.toMatch(/folded-data marker/);
  });
  test("copy puts the data on the clipboard, not the marker; a plain selection is the browser's own copy", () => {
    const a = new FakeArea();
    attachSpecFolding(a);
    a.value = text;
    a.select(0, a.shown.length);
    expect(a.clip("copy")).toBe(text);
    a.select(0, 3);
    expect(a.clip("copy")).toBeNull();
  });
  test("cut takes the data out with it and leaves the rest whole", () => {
    const a = new FakeArea();
    attachSpecFolding(a);
    a.value = text;
    const start = a.shown.indexOf("```assets");
    const end = a.shown.indexOf("```", start + 3) + 3;
    a.select(start, end);
    const cut = a.clip("cut")!;
    expect(cut).toContain(spec.assets!["icon.owl"] as string);
    expect(a.value).not.toContain("```assets");
    expect(a.value).toContain("# Owls");
    expect(a.inputs).toBe(1);
  });
  test("Show data unfolds the editor and keeps it open across writes; folding again hides it", () => {
    const a = new FakeArea();
    const folding = attachSpecFolding(a);
    a.value = text;
    folding.showData(true);
    expect(a.shown).toBe(text);
    a.value = text;
    expect(a.shown).toBe(text);
    folding.showData(false);
    expect(a.shown).toMatch(/⟪folded/);
    expect(a.value).toBe(text);
  });
  test("only machine payloads fold: in every bundled example no with:, path, ask, cards or narration line is folded (final fix I)", () => {
    const PAYLOAD = /^["']?(?:(?:t1|t2|img1|img2|lnk1):[A-Za-z0-9_-]{2}:|ic1:\[|ics1:[\w-]+:[\w-]+:<svg|data:[\w.+-]+\/[\w.+-]+[;,])|^[A-Za-z0-9+/=_-]+$/;
    let payloads = 0;
    for (const e of bundled as { spec?: Spec; playlist?: string }[]) {
      const t = e.playlist ?? formatPlaylist(singlePlaylist(e.spec!), "script");
      const f = foldSpecText(t, "qq00");
      for (const line of f.shown.split("\n")) {
        if (!line.includes("⟪folded")) continue;
        expect(line.trim(), line.slice(0, 80)).not.toMatch(/^(with:|path\b|ask\b|cards\b|speak\b|-\s*speak:)/);
      }
      for (const fold of f.folds) {
        if (!/^```assets|^assets/.test(fold)) expect(fold.slice(0, 60)).toMatch(PAYLOAD);
        payloads++;
      }
    }
    // The bundled pictures' data URIs still fold.
    expect(payloads).toBeGreaterThan(0);
  });
  test("a narration line with the word data: is not folded; a data URI is", () => {
    const speak = `  - speak: "Here is the data: ${"each bar is one country, ".repeat(10)}across the whole world."`;
    expect(foldSpecText(speak).shown).toBe(speak);
    const uri = `  href: data:image/png;base64,${"iVBORw0KGgo".repeat(30)}`;
    expect(foldSpecText(uri, "aa11").shown).toBe("  href: ⟪folded aa11#0 · 352 B⟫");
  });
  test("compact JSON, point lists and a long plain word run stay as written; a bare base64 run folds", () => {
    const json = `    with: {"bars":[${Array.from({ length: 40 }, (_, i) => `{"label":"b${i}","value":${i}}`).join(",")}]}`;
    expect(foldSpecText(json).shown).toBe(json);
    const pts = `    path p points=[${Array.from({ length: 60 }, (_, i) => `[${i},${i * 2}]`).join(",")}]`;
    expect(foldSpecText(pts).shown).toBe(pts);
    const b64 = `    foto: ${"QUJDRA==".repeat(40)}`;
    expect(foldSpecText(b64, "bb22").shown).toBe("    foto: ⟪folded bb22#0 · 320 B⟫");
  });
  test("a word ending in data: (metadata:) inside a sentence is not folded", () => {
    const line = `    speak The metadata: ${"says what the file is and who made it, ".repeat(6)}`;
    expect(foldSpecText(line).shown).toBe(line);
  });
});

