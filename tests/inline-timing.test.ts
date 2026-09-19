import { describe, expect, test } from "vitest";
import { scanLines } from "../src/spec/script/lines";

const speech = (text: string) => scanLines(text)[0] as { text: string; actions?: { head: string; rest: string; offset: number }[] };

describe("lifting an action out of a line", () => {
  test("the spoken text is the line without the span", () => {
    const l = speech("Pengene går rundt (@arrow a -> b@) og tilbake.\n");
    expect(l.text).toBe("Pengene går rundt og tilbake.");
    expect(l.actions).toEqual([{ head: "arrow", rest: "a -> b", offset: "Pengene går rundt".length }]);
  });

  test("several actions keep their order and their places", () => {
    const l = speech("Først (@draw a@) så (@draw b@) ferdig.\n");
    expect(l.text).toBe("Først så ferdig.");
    expect(l.actions!.map((a) => a.rest)).toEqual(["a", "b"]);
    expect(l.actions![0].offset).toBeLessThan(l.actions![1].offset);
  });

  test("an action at the very start has offset 0", () => {
    const l = speech("(@camera zoom 2@) Se her.\n");
    expect(l.text).toBe("Se her.");
    expect(l.actions![0].offset).toBe(0);
  });

  test("a line with no action is untouched", () => {
    expect(speech("Helt vanlig prosa.\n").actions).toBeUndefined();
  });

  test("a parenthesis followed by an at-sign in prose is prose", () => {
    const l = speech("Skriv (@ hvis du vil) videre.\n");
    expect(l.text).toBe("Skriv (@ hvis du vil) videre.");
    expect(l.actions).toBeUndefined();
  });

  test("an unclosed span names its line", () => {
    expect(() => scanLines("Pengene (@arrow a -> b går rundt.\n")).toThrow(/line 1/);
  });
});
