// Authoring-time execution check: actually RUN each python code element the
// model wrote and turn failures into validation errors the existing repair
// round fixes — AI-written code that errors gets repaired before the author
// ever sees it. The runner is injected (node tests use fakes); generation
// passes the real runCode, which also warms the IndexedDB result cache the
// first render will then hit.

import type { Spec } from "../spec/types";
import type { CodeRunRequest, CodeRunResult } from "./run";

export interface CodeCheckOutcome {
  errors: string[];
  warnings: string[];
}

export async function codeExecutionErrors(
  spec: Spec,
  run: (req: CodeRunRequest) => Promise<CodeRunResult>,
): Promise<CodeCheckOutcome> {
  const out: CodeCheckOutcome = { errors: [], warnings: [] };
  for (const el of spec.elements ?? []) {
    if (el.type !== "code" || el.language !== "python" || !el.code) continue;
    let res: CodeRunResult;
    try {
      res = await run({ language: "python", code: el.code });
    } catch {
      return out; // runtime unavailable (offline, node) — never block generation
    }
    if (!res.ok || res.error) {
      out.errors.push(
        `code element "${el.id}" fails when executed — fix the script:\n${(res.error ?? res.stderr).slice(0, 600)}`,
      );
    } else if (res.stderr.trim() !== "") {
      out.warnings.push(`code "${el.id}" writes to stderr (${res.stderr.trim().slice(0, 200)}) — silence it or fix the cause`);
    }
  }
  return out;
}
