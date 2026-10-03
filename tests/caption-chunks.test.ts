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

  test("an abbreviation or an initial is neither a sentence break nor a page turn", () => {
    const rex = chunkCaption("The T. rex had tiny arms, yet its bite was the strongest of any land animal. Nothing it caught got away.", 90);
    expect(rex[0]).toBe("The T. rex had tiny arms, yet its bite was the strongest of any land animal.");
    const school = chunkCaption("The pupils of St. Mark's School were measured each spring by Dr. Hall. Their heights rose every year.", 70);
    expect(school[0]).toBe("The pupils of St. Mark's School were measured each spring by Dr. Hall.");
    // nor a page turn: the page breaks before the initial, never after it
    expect(chunkCaption("Of all the hunters that ever lived, the best known is T. rex with its huge head and its tiny arms.", 60)[0]).toBe(
      "Of all the hunters that ever lived, the best known is T. rex",
    );
    expect(chunkCaption("For forty years the doctors weighed the children of St. Mark's School in Boston every spring.", 60)[0]).toBe(
      "For forty years the doctors weighed the children of",
    );
    const misc = chunkCaption("Prices rose approx. 3.5 percent in the U.S. economy, e.g. rents. Wages did not keep up at all.", 70);
    expect(misc[0]).toBe("Prices rose approx. 3.5 percent in the U.S. economy, e.g. rents.");
    // a real sentence end still breaks — also after a lower-case "no."
    expect(chunkCaption("The answer was no. The second trial said the same thing again.", 50)[0]).toBe("The answer was no.");
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
