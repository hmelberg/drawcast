// The key a stamped code result is stored under (tests/fixtures/code-results.json):
// a hash of everything a run depends on — each code element's language,
// script, controls, chart style and pane, and the params (where the
// "{id.path}" data tokens live). Change any of it and the stamp is stale:
// the examples gate says so, and `node scripts/stamp-code-results.mjs`
// re-records it. Plain JS so the gate (TS) and the recorder (.mjs) share it.
import { createHash } from "node:crypto";

export function codeKey(spec) {
  const code = (spec.elements ?? [])
    .filter((e) => e.type === "code")
    .map((e) => ({ id: e.id, language: e.language, code: e.code, controls: e.controls ?? null, chart: e.chart ?? null, show: e.show ?? null, game: e.game ?? null }));
  return createHash("sha1").update(JSON.stringify({ code, params: spec.params ?? null })).digest("hex").slice(0, 16);
}

export function hasCode(spec) {
  return (spec?.elements ?? []).some((e) => e.type === "code");
}
