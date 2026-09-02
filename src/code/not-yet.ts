// Placeholder runtime for languages whose module has not landed yet: an
// unavailable envelope, so the authoring-time check warns instead of
// erroring and the element draws its error panel. Deleted when the last
// runtime lands (the M4 plan).
import type { CodeRunRequest, CodeRunResult } from "./run";
import { RUNTIME_LABEL } from "./languages";

export async function run(req: CodeRunRequest): Promise<CodeRunResult> {
  return {
    ok: false,
    stdout: "",
    stderr: "",
    figures: [],
    error: `the ${RUNTIME_LABEL[req.language]} runtime is not available yet`,
    runtimeUnavailable: true,
  };
}
