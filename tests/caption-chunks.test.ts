// A caption is at most two lines: a long line is shown page by page as it
// is said (render/caption-chunks.ts; Hans agreed 2026-09-26).
import { describe, expect, test } from "vitest";
import { chunkCaption, pageTimes } from "../src/render/caption-chunks";

describe("chunkCaption", () => {
  test("a line that fits is one page, untouched", () => {
    expect(chunkCaption("Thirty percent of the sick recover.", 90)).toEqual(["Thirty percent of the sick recover."]);
  });

  test("every page fits, no word is lost, and the order is kept", () => {
    const line =
      "Keep going for a lifetime, count later years for less, 3.5 percent a year as in England, and add it all up: about 15,400 QALYs and 35.5 million pounds. Divide by the thousand people to get the average.";
    const pages = chunkCaption(line, 80);
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(80);
    expect(pages.join(" ")).toBe(line);
  });

  test("sentences break before clauses, clauses before words", () => {
    const pages = chunkCaption("That leaves 890 well, 100 sick and 10 dead. Weight them by quality and you get 851 QALYs.", 60);
    expect(pages[0]).toBe("That leaves 890 well, 100 sick and 10 dead.");
    const clauses = chunkCaption("Across 138 state rises, low-wage jobs barely changed in number, because jobs below the floor vanished", 60);
    expect(clauses[0].endsWith(",")).toBe(true);
  });

  test("the last page is never a lone word or two", () => {
    const pages = chunkCaption("one two three four five six seven eight nine ten eleven twelve thirteen", 60);
    expect(pages[pages.length - 1].split(" ").length).toBeGreaterThan(2);
  });

  test("pages come up by their share of the characters", () => {
    expect(pageTimes(["aaaa", "bbbbbb"], 1000)).toEqual([400]);
    expect(pageTimes(["one"], 1000)).toEqual([]);
  });
});
