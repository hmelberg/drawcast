import { describe, expect, test } from "vitest";
import { decodePhoto, decodePicture, encodeLinkedPhoto, encodePhoto, isLinkedPhoto } from "../src/spec/trace";

describe("linked pictures", () => {
  const url = "https://microdata.no/manual/assets/images/image79.png";
  test("round-trip, aspect to 3 decimals", () => {
    const s = encodeLinkedPhoto(1041 / 1920, url);
    expect(s.startsWith("lnk1:")).toBe(true);
    const d = decodePicture(s)!;
    expect(d.href).toBe(url);
    expect(d.linked).toBe(true);
    expect(d.aspect).toBeCloseTo(1041 / 1920, 2);
    expect(isLinkedPhoto(s)).toBe(true);
  });
  test("an embedded photo decodes through decodePicture unchanged", () => {
    const s = encodePhoto(0.5, "data:image/png;base64,AAAA");
    expect(decodePicture(s)).toEqual({ ...decodePhoto(s)!, linked: false });
    expect(isLinkedPhoto(s)).toBe(false);
  });
  test("decodePhoto still refuses a link; decodePicture refuses non-https", () => {
    expect(decodePhoto(encodeLinkedPhoto(0.5, url))).toBeNull();
    expect(decodePicture(encodeLinkedPhoto(0.5, "javascript:alert(1)"))).toBeNull();
    expect(decodePicture(encodeLinkedPhoto(0.5, "http://x.org/a.png"))).toBeNull();
  });
});
