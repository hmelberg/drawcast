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
});
