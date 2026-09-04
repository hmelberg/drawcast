// The vendored microdata snapshot: what the runtime is allowed to install
// from a fetched manifest, and the guard that the snapshot on disk actually
// matches the version the code pins.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { MDLIB_VERSION } from "../src/code/languages";
import { parseMdlibManifest } from "../src/code/mdlib";

describe("parseMdlibManifest", () => {
  test("lists the files the snapshot holds", () => {
    const files = parseMdlibManifest('{"version":"x","files":{"m2py.py":"a","codelists/NUDB_BU.json":"b"}}');
    expect(files).toEqual(["m2py.py", "codelists/NUDB_BU.json"]);
  });

  test("a name that climbs out of the snapshot directory is refused", () => {
    // The manifest arrives over the network; a "../" name would have the
    // runner write outside its own folder in the pyodide filesystem.
    expect(() => parseMdlibManifest('{"files":{"../../etc/passwd":"a"}}')).toThrow(/name/i);
    expect(() => parseMdlibManifest('{"files":{"/abs.py":"a"}}')).toThrow(/name/i);
  });

  test("anything that is not a manifest is refused, not silently empty", () => {
    expect(() => parseMdlibManifest("not json")).toThrow();
    expect(() => parseMdlibManifest("{}")).toThrow();
    expect(() => parseMdlibManifest('{"files":{}}')).toThrow();
  });
});

describe("the pinned snapshot exists on disk", () => {
  const dir = new URL(`../public/mdlib/${MDLIB_VERSION}/`, import.meta.url);

  test("MDLIB_VERSION points at a synced snapshot — bump it and you must re-run sync-mdlib", () => {
    expect(existsSync(new URL("manifest.json", dir))).toBe(true);
    const files = parseMdlibManifest(readFileSync(new URL("manifest.json", dir), "utf8"));
    expect(files).toContain("m2py.py");
    expect(files).toContain("variable_metadata.json");
    for (const f of files) expect(existsSync(new URL(f, dir))).toBe(true);
  });

  test("the snapshot ships no build junk — it is copied verbatim into dist/", () => {
    // Running scripts/mdlib-sanity.py imports the emulator, and CPython would
    // drop a __pycache__ into the snapshot that vite then publishes.
    expect(readdirSync(dir)).not.toContain("__pycache__");
  });

  test("drawcast's own runner sits beside the vendored files and is not overwritten by the sync", () => {
    const runner = readFileSync(new URL("drawcast_microdata_runner.py", dir), "utf8");
    expect(runner).toContain("def _md_run(");
    const manifest = readFileSync(new URL("manifest.json", dir), "utf8");
    expect(manifest).not.toContain("drawcast_microdata_runner.py");
  });
});
