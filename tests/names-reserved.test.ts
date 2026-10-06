// Reserved names (credit plan delivery 3, 2026-10-06) — mirrors
// drawcast-anvil's RESERVED_NAMES, pinned when that repo sits beside this one.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { isPayable, isReservedName, normalizeName, RESERVED_NAMES } from "../src/names";

const SERVER = resolve(__dirname, "../../drawcast-anvil/server_code/names.py");

describe("reserved names", () => {
  test("subjects and the app's own words can't be bought; reading is unaffected", () => {
    for (const n of ["math", "physics", "economics", "quiz", "help", "statistics"]) {
      expect(isPayable(n), n).toBe(false);
      expect(isReservedName(n)).toBe(true);
      expect(normalizeName(n)).toBe(n);
    }
    expect(isPayable("math-for-nurses")).toBe(true);
  });

  test.skipIf(!existsSync(SERVER))("matches the server's list exactly", () => {
    const py = readFileSync(SERVER, "utf8");
    const block = py.slice(py.indexOf("RESERVED_NAMES = frozenset(("), py.indexOf("))", py.indexOf("RESERVED_NAMES = frozenset((")));
    const server = [...block.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect([...RESERVED_NAMES].sort()).toEqual(server.sort());
  });
});
