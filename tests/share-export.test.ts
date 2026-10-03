// ⤓ Export (2026-10-03): Share's other half. Publish makes the drawcast
// itself public; Export makes copies in another form — a web page, a video
// file, a YouTube upload — which do not follow later edits.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { migrateExportTo, migrateShareTo } from "../src/store";

const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");

describe("the remembered choice, one per button", () => {
  test("Export remembers its own three", () => {
    for (const v of ["page", "video", "youtube"] as const) expect(migrateExportTo(v, "link")).toBe(v);
  });
  test("a video or YouTube remembered before the split carries over to Export", () => {
    expect(migrateExportTo(undefined, "youtube")).toBe("youtube");
    expect(migrateExportTo(undefined, "video")).toBe("video");
  });
  test("anything else opens Export on the web page", () => {
    expect(migrateExportTo(undefined, "link")).toBe("page");
    expect(migrateExportTo("drive", "link")).toBe("page");
    expect(migrateExportTo("nonsense", "server")).toBe("page");
  });
  test("Publish never remembers the web page — it is not one of its rows", () => {
    expect(migrateShareTo("page")).toBe("link");
  });
  test("selecting a row writes the remembered choice of the button that opened the modal", () => {
    expect(share).toMatch(/if \(\(current\.group \?\? "publish"\) === "export"\) current\.settings\.exportTo = id;\s*else current\.settings\.shareTo = id;/);
    expect(share).toMatch(/const remembered = group === "export" \? deps\.settings\.exportTo : deps\.settings\.shareTo;/);
  });
});

describe("the modal", () => {
  test("is titled for the button that opened it", () => {
    expect(share).toMatch(/modalTitle\.textContent = group === "export" \? "⤓ Export" : "↗ Publish";/);
  });
  test("the web page panel downloads through exportPage with the shared embed choices and a slug name", () => {
    expect(share).toContain('const pageChoices = buildEmbedChoices("page");');
    expect(share).toMatch(/void deps\.exportPage\(choices\);/);
    expect(share).toMatch(/page: pagePanel/);
    expect(share).toMatch(/page: pageGo/);
  });
});

describe("the app", () => {
  test("has an Export button beside Publish, both opening the shared modal", () => {
    expect(main).toMatch(/reviewBtn, shareBtn, exportBtn, ratingBox/);
    expect(main).toContain('shareBtn.addEventListener("click", () => openShareFor("publish"));');
    expect(main).toContain('exportBtn.addEventListener("click", () => openShareFor("export"));');
  });
  test("freezes both buttons together while a job runs", () => {
    expect(main).not.toMatch(/shareBtn\.disabled = (true|false);/);
  });
  test("a web page export refuses a private drawcast — the page would carry it unlocked", () => {
    const fn = main.slice(main.indexOf("async function exportPageCast("), main.indexOf("// In-flight guards for the two Drive operations."));
    expect(fn).toContain("if (isPrivateDoc())");
    expect(fn.indexOf("isPrivateDoc()")).toBeLessThan(fn.indexOf("publishTextFor("));
    expect(fn).toContain("castPageHtml({ text, title:");
    expect(fn).toContain("downloadBlob(file,");
  });
  test("the course panel passes a stub: a page holds one drawcast", () => {
    expect(course).toMatch(/exportPage: async \(\) => shareStatus\(/);
  });
});
