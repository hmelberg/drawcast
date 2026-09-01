// The YouTube panel after the publish-polish rework (spec §2, rulings 1-6):
// a label/field grid, "Translate to" chips instead of nineteen checkboxes,
// translation deferred to the Upload click, a per-language description, and no
// burn-in checkbox at all.
//
// Most of this lives inside share.ts's build() — DOM code that cannot run in
// this node suite — so the behavioural rules are pinned two ways: the pure
// queue helper is called for real, and the wiring is read out of the source
// with every extraction truthy-guarded, so a rename that empties a slice fails
// loudly instead of passing vacuously.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ytQueue } from "../src/ui/share";
import { translateText } from "../src/llm/translate";

const shareSrc = () => readFile(new URL("../src/ui/share.ts", import.meta.url), "utf8");
const cssSrc = () => readFile(new URL("../src/styles.css", import.meta.url), "utf8");

/** Source with wrapped string literals joined back up ("a " + \n "b" → "a b"),
 *  so a sentence can be pinned as the reader sees it rather than as prettier
 *  happened to break it. */
function joined(src: string): string {
  return src.replace(/["`] \+\s*\n\s*["`]/g, "");
}

/** share.ts's YouTube region — everything from its banner to the modal shell. */
async function ytRegion(): Promise<string> {
  const src = await shareSrc();
  const from = src.indexOf("// ---- YouTube panel");
  const to = src.indexOf("// ---- the modal shell");
  expect(from).toBeGreaterThan(0);
  expect(to).toBeGreaterThan(from);
  const region = src.slice(from, to);
  expect(region.length).toBeGreaterThan(2000);
  return region;
}

describe("ytQueue — which languages get recorded, in which order", () => {
  it("puts the source first when its chip is there", () => {
    expect(ytQueue("nb", ["nb", "de", "fr"])).toEqual(["nb", "de", "fr"]);
    expect(ytQueue("nb", ["de", "nb", "fr"])).toEqual(["nb", "de", "fr"]);
  });

  it("keeps the added order among the translations", () => {
    expect(ytQueue("en", ["en", "fr", "de"])).toEqual(["en", "fr", "de"]);
    expect(ytQueue("en", ["en", "de", "fr"])).toEqual(["en", "de", "fr"]);
  });

  it("uploads only the translation when the source chip was removed", () => {
    expect(ytQueue("nb", ["de"])).toEqual(["de"]);
  });

  it("dedupes — the same language cannot be queued twice", () => {
    expect(ytQueue("nb", ["nb", "de", "de", "nb"])).toEqual(["nb", "de"]);
  });

  it("is empty when every chip has been removed — the Upload button's off switch", () => {
    expect(ytQueue("nb", [])).toEqual([]);
  });

  it("ignores blanks, which is what the add-select's placeholder value is", () => {
    expect(ytQueue("nb", ["", "de"])).toEqual(["de"]);
  });
});

describe("translateText — the description in the video's own language", () => {
  it("returns nothing for an empty description, without calling the API", async () => {
    // No fetch is stubbed here: an implementation that called out would throw.
    expect(await translateText("", { code: "de", label: "German" }, { apiKey: "k", model: "m" })).toBe("");
    expect(await translateText("   \n ", { code: "de", label: "German" }, { apiKey: "k", model: "m" })).toBe("");
  });

  it("is exported with the description prompt, one call, translation only", async () => {
    const src = await readFile(new URL("../src/llm/translate.ts", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("export async function translateText"));
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).toContain("Translate this YouTube video description into");
    expect(fn).toContain("return the translation only");
    expect(fn).toContain("callForText(");
    // The signal has to reach it, or Cancel cannot stop phase 1 mid-description.
    expect(fn).toContain("opts");
  });
});

describe("the panel is a label/field grid, not a wall of checkboxes", () => {
  it("has no checkbox left anywhere in the YouTube region", async () => {
    const yt = await ytRegion();
    expect(yt).not.toContain('type: "checkbox"');
    expect(yt).not.toContain("ytBurnCb");
    expect(yt).not.toContain("ytLangCbs");
  });

  it("drops the nineteen-language row for a chips row and an add-select", async () => {
    const src = await shareSrc();
    expect(src).not.toMatch(/class: "yt-lang"/);
    expect(src).not.toMatch(/class: "yt-langs"/);
    const yt = await ytRegion();
    expect(yt).toContain('class: "yt-grid"');
    expect(yt).toContain('class: "yt-chips"');
    expect(yt).toContain("yt-add-lang");
    expect(yt).toContain("＋ Add a language…");
  });

  it("names its five rows", async () => {
    const yt = await ytRegion();
    for (const row of ["Title", "Description", "Publishes in", "Translate to", "Visibility"]) {
      expect(yt).toContain(`"${row}"`);
    }
  });

  it("marks the source chip as the original and lets it be removed like any other", async () => {
    const yt = await ytRegion();
    expect(yt).toContain("(original)");
    expect(yt).toContain("yt-chip-source");
    expect(yt).toMatch(/Remove \$\{/);
  });

  it("styles the grid as the house does — auto label column, 1fr field, stacked first", async () => {
    const css = await cssSrc();
    const grid = css.slice(css.indexOf(".yt-grid"));
    expect(grid.length).toBeGreaterThan(100);
    expect(css).toMatch(/\.yt-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/@media \(min-width: 36rem\)[^@]*\.yt-grid\s*\{[^}]*auto minmax\(0, 1fr\)/s);
    // The retired language row takes its rules with it.
    expect(css).not.toContain(".yt-langs");
    expect(css).not.toContain(".yt-lang ");
  });
});

describe("selecting a language costs nothing; Upload pays (ruling 1)", () => {
  it("has no change-handler translation left — chips only mutate the queue", async () => {
    const yt = await ytRegion();
    // One translate loop in the whole region: ensureTranslations.
    expect(yt.match(/translateSpec\(/g)?.length).toBe(1);
    expect(yt).toContain("async function ensureTranslations(");
    expect(yt).not.toContain("async function translateInto(");
  });

  it("passes the run's abort signal into every translate call", async () => {
    const yt = await ytRegion();
    expect(yt).toMatch(/translateSpec\([^;]*\{ signal \}\)/);
    expect(yt).toMatch(/translateText\([^;]*\{ signal \}\)/);
  });

  it("translates in phase 1 of the upload — after consent, close and beginExport", async () => {
    const yt = await ytRegion();
    const run = yt.slice(yt.indexOf("async function runYoutubeUpload"), yt.indexOf("function reportUploads"));
    expect(run.length).toBeGreaterThan(600);
    const order = ["requireScope(YOUTUBE_SCOPE)", "modal.dialog.close()", "deps.beginExport(", "ensureTranslations("];
    let at = -1;
    for (const step of order) {
      const next = run.indexOf(step);
      expect(next, step).toBeGreaterThan(at);
      at = next;
    }
    // A failed or cancelled phase 1 records nothing: it reports and returns
    // before the render loop, and the finally still ends the export.
    expect(run).toMatch(/if \(!run\.ok\) \{[^}]*deps\.setStatus\(run\.message/s);
  });

  it("both verbs share one translate routine — Save copies pays its own way (ruling 6)", async () => {
    const yt = await ytRegion();
    expect(yt.match(/ensureTranslations\(/g)?.length).toBe(3); // the definition and two call sites
    const save = yt.slice(yt.indexOf("ytSaveCopy.addEventListener"), yt.indexOf("async function runYoutubeUpload"));
    expect(save.length).toBeGreaterThan(400);
    expect(save).toContain("ensureTranslations(");
    expect(save).toContain("ytStatus.textContent");
  });

  it("caches the translated description beside the playlist and uploads it (ruling 5)", async () => {
    const yt = await ytRegion();
    expect(yt).toContain("new Map<string, { playlist: Playlist; description: string }>()");
    expect(yt).toContain("function descriptionFor(");
    expect(yt).toMatch(/description: descriptionFor\(code\)/);
    expect(yt).not.toMatch(/description: ytDesc\.value,/);
  });

  it("enables Upload on a non-empty queue alone — nothing to be 'ready' for any more", async () => {
    const yt = await ytRegion();
    const fn = yt.slice(yt.indexOf("function refreshYtButtons"), yt.indexOf("async function ensureTranslations"));
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).toMatch(/ytGo\.disabled = queue\.length === 0;/);
    expect(fn).not.toContain("ytTranslations.has");
  });
});

describe("the copy says what a translation costs, once (rulings 3-4)", () => {
  it("shows the cost line only when a translation is queued", async () => {
    const yt = joined(await ytRegion());
    expect(yt).toContain(
      "extra video(s) will be recorded in real time — roughly ${extras} × the drawcast's length — " +
        "and each translation spends a little Anthropic and TTS budget.",
    );
    expect(yt).toMatch(/ytCost\.hidden = extras === 0/);
  });

  it("says what a translation IS, in one line under Translate to", async () => {
    const yt = await ytRegion();
    expect(yt).toContain("Each translation is a full extra video: drawn labels, narration and subtitles.");
  });

  it("trims the warning paragraph to the one fact it carried", async () => {
    const yt = joined(await ytRegion());
    expect(yt).toContain(
      "The subtitle file downloads with each upload — attach it with one click afterwards, " +
        "and YouTube auto-translates captions for viewers.",
    );
    expect(yt).not.toContain("drag it in yourself in YouTube Studio");
  });
});

describe("the YouTube burn-in setting dies (ruling 4)", () => {
  it("is gone from the store, the panel and the upload", async () => {
    const store = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
    expect(store).not.toContain("burnCaptionsOnUpload");
    const src = await shareSrc();
    expect(src).not.toContain("burnCaptionsOnUpload");
    const yt = await ytRegion();
    expect(yt).toContain("deps.renderVideo(exportSequence(playlist), false, of)");
  });

  it("leaves the DOWNLOAD's burn checkbox alone — a file has no subtitle layer", async () => {
    const src = await shareSrc();
    expect(src).toContain("videoBurnCb");
    expect(src).toContain("deps.settings.burnCaptions = videoBurnCb.checked;");
  });

  it("stops Settings promising a YouTube burn-in setting that no longer exists", async () => {
    const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(main).toContain("Burn captions into the DOWNLOADED video");
    expect(main).not.toContain("YouTube uploads have their own setting");
  });
});

describe("every open starts from the document's own language", () => {
  it("resets the chips to the source alone and states what it publishes in", async () => {
    const src = await shareSrc();
    const prep = src.slice(src.indexOf("function prepPanels()"), src.indexOf("function refresh(deps"));
    expect(prep.length).toBeGreaterThan(400);
    expect(prep).toContain("ytChips.length = 0");
    expect(prep).toContain("ytChips.push(sourceLanguage(playlist))");
    expect(prep).toContain("ytTranslations.clear()");
    expect(prep).toContain("ytSourceLine.textContent = languageLabel(sourceLanguage(playlist))");
  });
});
