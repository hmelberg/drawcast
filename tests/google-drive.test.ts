import { describe, expect, test } from "vitest";
import { multipartBody } from "../src/google/drive";

describe("multipartBody", () => {
  test("carries the metadata part, the content part, and a closing boundary", () => {
    const body = multipartBody({ name: "supply.yaml", mimeType: "text/yaml" }, "title: A line\n", "BOUND");
    expect(body).toContain("--BOUND\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n");
    expect(body).toContain('"name":"supply.yaml"');
    expect(body).toContain("--BOUND\r\nContent-Type: text/yaml\r\n\r\ntitle: A line\n");
    expect(body.endsWith("\r\n--BOUND--")).toBe(true);
  });

  test("spec text containing the boundary word is still delimited correctly", () => {
    // The boundary is random per call, but a spec could legitimately contain any
    // word. Guard that the CLOSING delimiter is the last thing in the body.
    const body = multipartBody({ name: "x.yaml", mimeType: "text/yaml" }, "text: BOUND is a word\n", "BOUND");
    expect(body.lastIndexOf("--BOUND--")).toBe(body.length - "--BOUND--".length);
  });

  test("a spec with no trailing newline still closes cleanly", () => {
    const body = multipartBody({ name: "x.yaml", mimeType: "text/yaml" }, "title: X", "B");
    expect(body.endsWith("\r\n--B--")).toBe(true);
  });
});
