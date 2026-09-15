import { describe, expect, test, vi } from "vitest";
import { perfEnabled, perfSpan } from "../src/code/perf";

describe("perf spans", () => {
  test("off outside a ?perf page: no log", () => {
    expect(perfEnabled()).toBe(false); // node: no location
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    perfSpan("x")();
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
  test("on: one line per span with the label and a millisecond count", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const end = perfSpan("pyodide boot", true);
    end();
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toMatch(/^\[perf\] pyodide boot \d+(\.\d+)? ms$/);
    info.mockRestore();
  });
});
