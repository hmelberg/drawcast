// #cast=<data> links (src/links/inline-cast.ts): the format the portable
// drawcast skill's link builder writes. The fixed vector below was produced
// ONCE by Python's own zlib, not by this module:
//
//   python3 -c 'import zlib,base64
//   t="title: Ohm’s law — V = I·R\nelements:\n  - {id: v, type: text, text: \"V = IR\"}\n"
//   c=zlib.compressobj(9,zlib.DEFLATED,-15); d=c.compress(t.encode())+c.flush()
//   print(base64.urlsafe_b64encode(d).decode().rstrip("="))'
//
// If it ever stops decoding, a Python-built link stopped playing.

import { readFileSync } from "node:fs";
import { deflateRawSync, deflateSync, inflateRawSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { castLinkFor, CastLinkError, decodeCast, encodeCast, MAX_CAST_BYTES } from "../src/links/inline-cast";
import { unwrapCastText } from "../src/playlist/cast-file";
import { parsePlaylistText, itemsOf } from "../src/playlist/playlist";
import { validateSpec } from "../src/spec/schema";

const PY_TEXT = 'title: Ohm’s law — V = I·R\nelements:\n  - {id: v, type: text, text: "V = IR"}\n';
const PY_DATA = "K8ksyUm1UvDPyH3UMLNYISexXOFRwxSFMAVbBc9D24O4UnNSc1PzSoqtuBQUdBWqM1OsFMp0FEoqC4CaSlIrSnTApJWCElhHkFItFwA";

const examples = JSON.parse(readFileSync(new URL("../src/examples.json", import.meta.url), "utf8")) as { request: string; spec?: unknown }[];

const b64url = (b: Buffer): string => b.toString("base64url").replace(/=+$/, "");

async function problemOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(CastLinkError);
    return (err as CastLinkError).problem;
  }
  throw new Error("expected a CastLinkError");
}

describe("the fixed vector (Python zlib, raw deflate, base64url without padding)", () => {
  test("decodes to the exact text, non-ASCII included", async () => {
    expect(await decodeCast(PY_DATA)).toBe(PY_TEXT);
  });
  test("the same text encoded here inflates back with Node's zlib (header-less)", async () => {
    const data = await encodeCast(PY_TEXT);
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(inflateRawSync(Buffer.from(data, "base64url")).toString("utf8")).toBe(PY_TEXT);
  });
  test("padding is tolerated, whitespace around the data too", async () => {
    const padded = PY_DATA + "=".repeat((4 - (PY_DATA.length % 4)) % 4);
    expect(await decodeCast(` ${padded}\n`)).toBe(PY_TEXT);
  });
});

describe("a realistic cast from src/examples.json", () => {
  const entry = examples.find((e) => e.spec && e.request.startsWith("What does 'QALYs gained'")) ?? examples.find((e) => e.spec)!;
  const text = JSON.stringify(entry, null, 2);

  test("round-trips through encodeCast/decodeCast", async () => {
    const data = await encodeCast(text);
    expect(await decodeCast(data)).toBe(text);
    // A typical cast makes a link of a couple of thousand characters.
    expect(castLinkFor(data).length).toBeLessThan(4000);
  });

  test("a Node zlib.deflateRawSync link decodes, and the viewer can play what comes out", async () => {
    const data = b64url(deflateRawSync(Buffer.from(text, "utf8"), { level: 9 }));
    const decoded = await decodeCast(data);
    expect(decoded).toBe(text);
    const playlist = parsePlaylistText(unwrapCastText(decoded).text);
    const items = itemsOf(playlist);
    expect(items.length).toBe(1);
    expect(validateSpec(items[0].spec).ok).toBe(true);
  });
});

describe("clear errors", () => {
  test("empty", async () => {
    expect(await problemOf(decodeCast(""))).toBe("empty");
  });
  test("not base64url", async () => {
    expect(await problemOf(decodeCast("abc+def/"))).toBe("base64");
    expect(await problemOf(decodeCast("abcde"))).toBe("base64"); // length ≡ 1 (mod 4)
  });
  test("not raw deflate: a zlib (headered) stream, or a truncated one", async () => {
    expect(await problemOf(decodeCast(b64url(deflateSync(Buffer.from(PY_TEXT)))))).toBe("deflate");
    expect(await problemOf(decodeCast(PY_DATA.slice(0, 40)))).toBe("deflate");
    expect(await problemOf(decodeCast("AAAA"))).toBe("deflate");
  });
  test("a deflate bomb stops at the cap instead of filling memory", async () => {
    const bomb = b64url(deflateRawSync(Buffer.alloc(MAX_CAST_BYTES + 1024, 0x61), { level: 9 }));
    expect(bomb.length).toBeLessThan(10_000);
    expect(await problemOf(decodeCast(bomb))).toBe("too-large");
  });
  test("bytes that are not UTF-8", async () => {
    expect(await problemOf(decodeCast(b64url(deflateRawSync(Buffer.from([0xff, 0xfe, 0x41])))))).toBe("utf8");
  });
});

describe("the paths that carry it", () => {
  test("Edit a copy: fetchPublicCastText decodes and unwraps an inline cast, no network", async () => {
    const { fetchPublicCastText, parseViewerHash } = await import("../src/viewer");
    const wrapped = JSON.stringify({ request: "Ohm", spec: { title: "Ohm", elements: [], commands: [] } });
    const req = parseViewerHash(`#cast=${await encodeCast(wrapped)}&mode=silent`)!;
    expect(JSON.parse((await fetchPublicCastText(req))!)).toEqual({ title: "Ohm", elements: [], commands: [] });
  });
  test("the paste page's Play goes to the #cast= hash of exactly what was pasted", async () => {
    const { pasteHash } = await import("../src/paste");
    const hash = await pasteHash(PY_TEXT);
    expect(hash.startsWith("#cast=")).toBe(true);
    expect(await decodeCast(hash.slice("#cast=".length))).toBe(PY_TEXT);
  });
});

test("castLinkFor builds the one fixed shape", () => {
  expect(castLinkFor("abc")).toBe("https://www.drawcast.app/#cast=abc");
  expect(castLinkFor("abc", "http://localhost:5221/#paste")).toBe("http://localhost:5221/#cast=abc");
});
