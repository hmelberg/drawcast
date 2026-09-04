import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const entry = readFileSync(new URL("../src/entry.ts", import.meta.url), "utf8");
const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("entry routes names", () => {
  test("gh/gdoc/gdrive first, then names, then the app", () => {
    const gh = entry.indexOf("(gdoc|gh|gdrive)[=-]");
    const named = entry.indexOf("isNameHash(hash)");
    const app = entry.indexOf('import("./main")');
    expect(gh).toBeGreaterThan(0);
    expect(named).toBeGreaterThan(gh);
    expect(app).toBeGreaterThan(named);
    expect(entry).toMatch(/runNamed\(hash\)/);
  });
});

describe("runNamed", () => {
  test("resolves against the registry, redirects courses, plays casts through parseViewerHash", () => {
    expect(viewer).toMatch(/export async function runNamed\(hash: string\)/);
    expect(viewer).toMatch(/resolveName\(DEFAULT_ENROLL_API, name\)/);
    expect(viewer).toMatch(/kind === "course"/);
    expect(viewer).toMatch(/location\.replace\(/);
    expect(viewer).toMatch(/parseViewerHash\(ghHashFor\(hash, resolved\.target\)\)/);
    expect(viewer).toMatch(/No drawcast called/);
  });

  test("parses the resolved target before clearing the lookup status, so a bad target still shows a message", () => {
    const parseCall = viewer.indexOf("parseViewerHash(ghHashFor(");
    const statusRemove = viewer.indexOf("status.remove()");
    expect(parseCall).toBeGreaterThan(0);
    expect(statusRemove).toBeGreaterThan(parseCall);
    expect(viewer).toMatch(/points at something this viewer cannot play/);
  });
});
