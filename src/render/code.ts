// Ensure-phase execution for CODE elements — the source/portrait contract:
// runs BEFORE layout on render's clone (B11), stamps el.code_result, degrades
// to an error envelope the layout draws as an error panel, never throws. The
// heavy runtime loads lazily inside code/run.ts, so a spec without a code
// element costs nothing.

import { runCode, type CodeRunDeps } from "../code/run";
import type { Spec } from "../spec/types";

export interface CodeResolution {
  id: string;
  ok: boolean;
  error?: string;
}

export async function resolveCode(spec: Spec, deps: CodeRunDeps = {}): Promise<CodeResolution[]> {
  const results: CodeResolution[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type !== "code") continue;
    if (el.code_result) {
      results.push({ id: el.id, ok: true });
      continue;
    }
    if (!el.language || !el.code) {
      results.push({ id: el.id, ok: false, error: "code element needs language and code" });
      continue;
    }
    const result = await runCode({ language: el.language, code: el.code }, deps);
    el.code_result = JSON.stringify(result);
    results.push({ id: el.id, ok: result.ok, error: result.error });
  }
  return results;
}
