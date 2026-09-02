// Pyodide runtime — implemented in Task 8. This placeholder keeps the module
// graph compiling; it must never be reached from node (tests inject runners).
import type { CodeRunRequest, CodeRunResult } from "./run";

export async function runPython(_req: CodeRunRequest): Promise<CodeRunResult> {
  return { ok: false, stdout: "", stderr: "", figures: [], error: "python runtime not implemented yet" };
}
