// entry.ts routes "#browse" to the catalogue (registry deliveries 3–4, task
// 9), before even the gh/gdoc/gdrive/anvil viewer test and isNameHash —
// "browse" is a reserved name prefix (names.ts RESERVED_PREFIXES) that could
// never resolve as a name anyway, but this pins that it lands on the
// catalogue rather than falling through to the full app. Source-pinned like
// tests/names-entry.test.ts's own ordering check — entry.ts's boot() is not
// unit-callable (top-level `void boot()`, real `location`/`document`).

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const entry = readFileSync(new URL("../src/entry.ts", import.meta.url), "utf8");

describe("entry routes #browse to the catalogue", () => {
  test("checked before gh/gdoc/gdrive/anvil, before isNameHash, before the app", () => {
    const browse = entry.indexOf('hash === "#browse"');
    const gh = entry.indexOf("(gdoc|gh|gdrive|anvil)[=-]");
    const named = entry.indexOf("isNameHash(hash)");
    const app = entry.indexOf('import("./main")');
    expect(browse).toBeGreaterThan(0);
    expect(browse).toBeLessThan(gh);
    expect(gh).toBeLessThan(named);
    expect(named).toBeLessThan(app);
  });

  test("matches a bare #browse and #browse&…, imports ./catalogue, and calls runCatalogue(hash)", () => {
    expect(entry).toContain('if (hash === "#browse" || hash.startsWith("#browse&")) {');
    expect(entry).toContain('const { runCatalogue } = await import("./catalogue");');
    expect(entry).toContain("await runCatalogue(hash);");
  });

  test("removes the boot loader before rendering, exactly like every other branch", () => {
    const fn = entry.slice(entry.indexOf('if (hash === "#browse"'), entry.indexOf("} else if (!remix"));
    expect(fn).toContain("doneBooting();");
  });

  test("never reaches runNamed — #browse must not be treated as a registered name", () => {
    const fn = entry.slice(entry.indexOf('if (hash === "#browse"'), entry.indexOf("} else if (!remix && isNameHash"));
    expect(fn).not.toContain("runNamed");
  });
});
