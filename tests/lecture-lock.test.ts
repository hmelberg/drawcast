import { describe, expect, it } from "vitest";
import { envelopeOf, isLocked, lockText, unlockText } from "../src/crypto/lecture-lock";

const KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"; // 32 bytes 0..31
const OTHER = "Hx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA"; // 32 bytes 31..0 (different valid key)
const ITEM = "ann/casts/qalys";

describe("lecture-lock", () => {
  it("round-trips, header first", async () => {
    const env = await lockText("title: A\n# plain yaml æøå\n", KEY, ITEM);
    expect(env.startsWith("drawcast-encrypted: 1\n")).toBe(true);
    expect(isLocked(env)).toBe(true);
    expect(envelopeOf(env)).toMatchObject({ item: ITEM, enroll: "https://drawcast.anvil.app" });
    expect(await unlockText(env, KEY)).toBe("title: A\n# plain yaml æøå\n");
  });
  it("is deterministic: same text, same envelope; different text, different iv", async () => {
    const a = await lockText("one", KEY, ITEM);
    expect(await lockText("one", KEY, ITEM)).toBe(a);
    expect(envelopeOf(await lockText("two", KEY, ITEM))!.iv).not.toBe(envelopeOf(a)!.iv);
  });
  it("a wrong key or a moved envelope fails", async () => {
    const env = await lockText("secret", KEY, ITEM);
    await expect(unlockText(env, OTHER)).rejects.toThrow(/wrong-key/);
    await expect(unlockText(env.replace(`item: ${ITEM}`, "item: bob/x/y"), KEY)).rejects.toThrow(/wrong-key/);
  });
  it("plain YAML is not locked; the plaintext never appears in the envelope", async () => {
    expect(isLocked("title: A\n")).toBe(false);
    expect(await lockText("VERY-SECRET-LINE", KEY, ITEM)).not.toContain("VERY-SECRET-LINE");
  });
  it("handles a multi-megabyte file", async () => {
    const big = "x".repeat(3_000_000);
    expect(await unlockText(await lockText(big, KEY, ITEM), KEY)).toBe(big);
  });
  it("a tampered ciphertext char fails, not silently returns garbage", async () => {
    const env = await lockText("secret", KEY, ITEM);
    const e = envelopeOf(env)!;
    const flipped = e.data[0] === "A" ? "B" : "A";
    const tampered = env.replace(`data: ${e.data}`, `data: ${flipped}${e.data.slice(1)}`);
    await expect(unlockText(tampered, KEY)).rejects.toThrow(/wrong-key/);
  });
  it("a short (16-byte) key is rejected: bad-key at lock, wrong-key at unlock", async () => {
    const shortKey = "AAECAwQFBgcICQoLDA0ODw"; // 16 bytes, valid base64url, wrong length
    await expect(lockText("secret", shortKey, ITEM)).rejects.toThrow(/bad-key/);
    const env = await lockText("secret", KEY, ITEM);
    await expect(unlockText(env, shortKey)).rejects.toThrow(/wrong-key/);
  });
  it("rejects a malformed item", async () => {
    await expect(lockText("secret", KEY, "")).rejects.toThrow(/bad-item/);
    await expect(lockText("secret", KEY, "ann/casts\nqalys")).rejects.toThrow(/bad-item/);
    await expect(lockText("secret", KEY, "ann/casts/qalys ")).rejects.toThrow(/bad-item/);
    await expect(lockText("secret", KEY, " ann/casts/qalys")).rejects.toThrow(/bad-item/);
  });
  it("a CRLF envelope unlocks the same as an LF one", async () => {
    const env = await lockText("title: A\r\nline two\r\n", KEY, ITEM);
    const crlf = env.replace(/\n/g, "\r\n");
    expect(isLocked(crlf)).toBe(true);
    expect(await unlockText(crlf, KEY)).toBe("title: A\r\nline two\r\n");
  });
  it("round-trips every small size 0..5 bytes (every base64 padding branch)", async () => {
    for (let n = 0; n <= 5; n++) {
      const text = "y".repeat(n);
      expect(await unlockText(await lockText(text, KEY, ITEM), KEY)).toBe(text);
    }
  });
  it("the same plaintext under two different items gets two different ivs", async () => {
    const a = envelopeOf(await lockText("shared", KEY, "ann/casts/qalys"))!;
    const b = envelopeOf(await lockText("shared", KEY, "ann/casts/other"))!;
    expect(a.iv).not.toBe(b.iv);
  });
  it("rejects an envelope claiming a foreign alg", async () => {
    const env = await lockText("secret", KEY, ITEM);
    const tampered = env.replace("alg: AES-GCM-256", "alg: ROT13");
    await expect(unlockText(tampered, KEY)).rejects.toThrow(/wrong-key/);
  });
});
