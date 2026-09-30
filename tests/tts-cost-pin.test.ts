// Narration price pin (registry deliveries 3-4, task 1): the app's own
// TTS_PRICE_PER_MILLION (src/export/tts-cost.ts) must never drift from
// drawcast-anvil's server_code/credit.py PRICE_PER_MILLION — the server
// charges narration credit against the very estimate a user was shown.
//
// Mirrors the SERVER_NAMES_PY pin in tests/names.test.ts (read the server
// file from disk, skip when it is not there), but locates it by walking up
// from this file rather than a single fixed number of "..": this test's own
// directory sits at a different depth from the drawcast-anvil checkout
// depending on whether it runs from the main checkout (tests/ is a direct
// child of the repo root) or a worktree (tests/ is several levels deeper,
// under .claude/worktrees/<name>/) — a fixed offset that works in one place
// breaks silently (skips) in the other.
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TTS_PRICE_PER_MILLION } from "../src/export/tts-cost";

/** Walk up from this test file looking for `drawcast-anvil/<relPath>` as a
 *  sibling of some ancestor directory — the repo root, whichever depth it is
 *  found at. Null when no such file exists within a reasonable number of
 *  levels (the server repo not checked out beside this one). */
function findServerFile(relPath: string): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "..", "drawcast-anvil", relPath);
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const SERVER_CREDIT_PY = findServerFile("server_code/credit.py");
const SERVER_CREDIT_PY_TEXT = SERVER_CREDIT_PY ? readFileSync(SERVER_CREDIT_PY, "utf8") : null;
const HAS_MARKUP = SERVER_CREDIT_PY_TEXT !== null && /^MARKUP\s*=\s*\d+/m.test(SERVER_CREDIT_PY_TEXT);

describe("TTS_PRICE_PER_MILLION mirrors the server's credit.py", () => {
  test.skipIf(SERVER_CREDIT_PY_TEXT === null)("PRICE_PER_MILLION matches TTS_PRICE_PER_MILLION exactly", () => {
    const dictMatch = /PRICE_PER_MILLION\s*=\s*\{([^}]*)\}/.exec(SERVER_CREDIT_PY_TEXT!);
    expect(dictMatch).not.toBeNull();
    const dict: Record<string, number> = {};
    const entryRe = /"([a-z0-9]+)"\s*:\s*(\d+)/g;
    let entry: RegExpExecArray | null;
    while ((entry = entryRe.exec(dictMatch![1]))) dict[entry[1]] = Number(entry[2]);
    expect(dict).toEqual(TTS_PRICE_PER_MILLION);
  });

  // "if present": credit.py's MARKUP is the server's own constant (the app
  // never applies the markup itself, so nothing here mirrors it) — absence
  // is not a failure, a mismatch is.
  test.skipIf(!HAS_MARKUP)("MARKUP is pinned to 3", () => {
    const markupMatch = /^MARKUP\s*=\s*(\d+)/m.exec(SERVER_CREDIT_PY_TEXT!);
    expect(Number(markupMatch![1])).toBe(3);
  });
});
