import { describe, expect, it } from "vitest";
import { folderQuery, multipartBody } from "../src/google/drive";

describe("Drive folder (B10, §F.3.2)", () => {
  it("queries for the app's own folder by name, excluding trash", () => {
    expect(folderQuery("drawcast")).toBe("name = 'drawcast' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  });
  it("escapes quotes in the folder name", () => {
    expect(folderQuery("it's")).toContain("it\\'s");
  });
  it("the multipart metadata carries parents on create", () => {
    const body = multipartBody({ name: "n.yaml", mimeType: "text/yaml", parents: ["FOLDER1"] }, "x", "b");
    expect(body).toContain('"parents":["FOLDER1"]');
  });
  it("an update never re-parents", async () => {
    const src = await import("node:fs/promises").then((m) => m.readFile(new URL("../src/google/drive.ts", import.meta.url), "utf8"));
    const fn = /export async function saveSpec[^]*?\n\}/.exec(src)?.[0] ?? "";
    expect(fn).toMatch(/fileId \? \{ name, mimeType \}/); // adjust to the real ternary shape
  });
});
