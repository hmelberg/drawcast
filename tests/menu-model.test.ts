import { describe, expect, it } from "vitest";
import { visibleItems, soloLabel, type MenuItem } from "../src/ui/menu";

const item = (label: string, hidden = false): MenuItem => ({ label, hidden, onSelect: () => {} });

describe("visibleItems", () => {
  it("drops hidden items — a capability without its credential does not advertise itself", () => {
    expect(visibleItems([item("From disk"), item("From Google Drive", true)]).map((i) => i.label))
      .toEqual(["From disk"]);
  });

  it("keeps order", () => {
    expect(visibleItems([item("a"), item("b"), item("c")]).map((i) => i.label)).toEqual(["a", "b", "c"]);
  });

  it("can end up empty", () => {
    expect(visibleItems([item("a", true)])).toEqual([]);
  });
});

describe("soloLabel", () => {
  it("lowercases the item label's first character so the verb + item reads as one phrase", () => {
    expect(soloLabel("Open", item("From disk"))).toBe("Open from disk");
  });

  it("composes 'Open From Google Drive' as 'Open from Google Drive' (capital G preserved)", () => {
    expect(soloLabel("Open", item("From Google Drive"))).toBe("Open from Google Drive");
  });

  it("handles already-lowercase labels unchanged", () => {
    expect(soloLabel("Save", item("to disk"))).toBe("Save to disk");
  });

  it("strips trailing ▾ from the verb before composing", () => {
    expect(soloLabel("Save ▾", item("As copy"))).toBe("Save as copy");
  });

  it("trims spaces in the result", () => {
    expect(soloLabel("Open  ", item("From disk"))).toBe("Open from disk");
  });
});
