// Ensure-phase execution for CODE elements — the source/portrait contract:
// runs BEFORE layout on render's clone (B11), stamps el.code_result, degrades
// to an error envelope the layout draws as an error panel, never throws. The
// heavy runtime loads lazily inside code/run.ts, so a spec without a code
// element costs nothing.
//
// The data bridge lives here too: params may name script variables with
// "{id.var}" tokens. This resolver (1) scans them, (2) runs each script with
// exactly its referenced paths, (3) substitutes the harvested values into the
// clone's params — and applies the skip rule: a script whose output pane is
// hidden and whose id no token names is never executed (its lines are text).

import { decodeCodeResult, runCode, type CodeRunDeps, type CodeRunResult } from "../code/run";
import { pathsByCodeId, scanDataTokens, substituteDataTokens } from "../code/tokens";
import type { Spec, SpecElement } from "../spec/types";

export interface CodeResolution {
  id: string;
  ok: boolean;
  error?: string;
  /** The skip rule applied: hidden pane, no token names this element. */
  skipped?: boolean;
}

/** A stamped envelope serves a request only when it answers every path —
 *  with a value or with a recorded per-path error (re-running would just
 *  replay the same envelope from the run cache). */
function covers(env: CodeRunResult | null, paths: string[]): env is CodeRunResult {
  if (!env || !env.ok) return false;
  return paths.every((p) => (env.data !== undefined && p in env.data) || (env.dataErrors !== undefined && p in env.dataErrors));
}

function paneHidden(el: SpecElement): boolean {
  return el.show === "code" || el.show === "none";
}

export async function resolveCode(spec: Spec, deps: CodeRunDeps = {}): Promise<CodeResolution[]> {
  const results: CodeResolution[] = [];
  const byId = pathsByCodeId(scanDataTokens(spec.params));
  const codeEls = new Map<string, SpecElement>();

  for (const el of spec.elements ?? []) {
    if (el.type !== "code") continue;
    codeEls.set(el.id, el);
    const paths = byId[el.id] ?? [];
    if (paneHidden(el) && paths.length === 0) {
      results.push({ id: el.id, ok: true, skipped: true });
      continue;
    }
    if (el.code_result) {
      // Only a successful stamp that covers the request is trustworthy cache:
      // a stamped FAILURE (a transient boot/timeout envelope from an earlier
      // pass, say) must re-run rather than freeze that error onto the element.
      if (covers(decodeCodeResult(el.code_result), paths)) {
        results.push({ id: el.id, ok: true });
        continue;
      }
      delete el.code_result;
    }
    if (!el.language || !el.code) {
      results.push({ id: el.id, ok: false, error: "code element needs language and code" });
      continue;
    }
    const result = await runCode({ language: el.language, code: el.code, paths }, deps);
    el.code_result = JSON.stringify(result);
    results.push({ id: el.id, ok: result.ok, error: result.error });
  }

  if (Object.keys(byId).length > 0) {
    const { params, failures } = substituteDataTokens(spec.params, (codeId, path) => {
      const el = codeEls.get(codeId);
      if (!el) return { error: `"${codeId}" is not a code element in this drawcast` };
      const env = decodeCodeResult(el.code_result);
      if (!env || !env.ok) return { error: env?.error ?? "the script did not run" };
      if (env.dataErrors && path in env.dataErrors) return { error: env.dataErrors[path] };
      if (env.data && path in env.data) return { value: env.data[path] };
      return { error: "not harvested" };
    });
    spec.params = params;

    // A wholly failed run's envelope carries no dataErrors (the harvest only
    // runs when the script itself succeeded) — but a hidden pane's error
    // panel is never drawn (layout returns before it), so without stamping
    // each failed token here, the layout warning that names it would never
    // fire either: the params would just quietly lose their values.
    for (const { token, error } of failures) {
      const el = codeEls.get(token.codeId);
      if (!el) continue; // not a code element in this spec: the static lint already reports it
      const env = decodeCodeResult(el.code_result) ?? { ok: false, stdout: "", stderr: "", figures: [], error };
      env.dataErrors ??= {};
      if (!(token.path in env.dataErrors)) env.dataErrors[token.path] = error;
      el.code_result = JSON.stringify(env);
    }
  }
  return results;
}
