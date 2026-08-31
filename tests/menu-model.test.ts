import { describe, expect, it } from "vitest";
import { visibleItems, type MenuItem } from "../src/ui/menu";

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
