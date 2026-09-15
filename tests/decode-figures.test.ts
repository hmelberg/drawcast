// decodeFigures is a browser-only side effect (there is no DOM harness in
// this repo), so what a node test can pin is the contract that matters for
// every caller: it never throws and never hangs. A player mid-sweep and a
// tray mid-run both AWAIT it — a rejection there would abandon the step and
// leave the figure on the previous value.
import { describe, expect, test } from "vitest";
import { decodeFigures } from "../src/render/decode-figures";

const envelope = (n: number) =>
  JSON.stringify({
    ok: true,
    stdout: "",
    stderr: "",
    figures: Array.from({ length: n }, (_, i) => ({ href: `data:image/png;base64,AAAA${i}`, w: 640, h: 480 })),
  });

describe("decodeFigures", () => {
  test("in node (no Image) it resolves for an envelope, a non-envelope and nothing at all", async () => {
    expect(typeof Image).toBe("undefined");
    await expect(decodeFigures(envelope(2))).resolves.toBeUndefined();
    await expect(decodeFigures("not json at all")).resolves.toBeUndefined();
    await expect(decodeFigures(JSON.stringify({ nope: true }))).resolves.toBeUndefined();
    await expect(decodeFigures(undefined)).resolves.toBeUndefined();
    await expect(decodeFigures("")).resolves.toBeUndefined();
  });
  test("an envelope with no figures is a no-op too", async () => {
    await expect(decodeFigures(envelope(0))).resolves.toBeUndefined();
  });
});
