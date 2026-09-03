// Authoring-time execution check: actually RUN each code element the model
// wrote — whatever its language — and turn failures into validation errors
// the existing repair round fixes, so AI-written code that errors gets
// repaired before the author ever sees it. The runner is injected (node tests use fakes); generation
// passes the real runCode, which also warms the IndexedDB result cache the
// first render will then hit.

import type { Spec } from "../spec/types";
import type { CodeRunRequest, CodeRunResult } from "./run";
import { pathsByCodeId, scanDataTokens, substituteDataTokens } from "./tokens";
import { RUNTIME_LABEL } from "./languages";

export interface CodeCheckOutcome {
  errors: string[];
  warnings: string[];
  /** spec.params with every harvested token substituted — what a render
   *  would lay out — so the caller can validate it against the template's
   *  schema. spec.params itself when nothing was referenced. */
  resolvedParams?: Record<string, unknown>;
  /** Count of tokens dropped from resolvedParams whose element never
   *  produced an envelope (runtime unavailable, a throwing runner, or a
   *  token naming an id with no code element) — never actually JUDGED, so a
   *  caller must not treat their absence from resolvedParams as evidence of
   *  a real params problem. 0 when nothing was referenced. */
  unresolvedTokens?: number;
}

export async function codeExecutionErrors(
  spec: Spec,
  run: (req: CodeRunRequest) => Promise<CodeRunResult>,
): Promise<CodeCheckOutcome> {
  const out: CodeCheckOutcome = { errors: [], warnings: [] };
  const byId = pathsByCodeId(scanDataTokens(spec.params));
  const envelopes = new Map<string, CodeRunResult>();
  for (const el of spec.elements ?? []) {
    if (el.type !== "code" || !el.language || !el.code) continue;
    const paths = byId[el.id] ?? [];
    let res: CodeRunResult;
    try {
      res = await run({ language: el.language, code: el.code, paths });
    } catch {
      // A throwing injected runner is still just this ONE element's runtime
      // being unavailable — the remaining code elements still get checked.
      continue;
    }
    if (res.runtimeUnavailable) {
      // The runtime never loaded (offline CDN, no browser) — the script was
      // never actually verified, so this is a WARNING, never an error: an
      // offline author must not burn a repair round on code that may be fine.
      out.warnings.push(`code "${el.id}" — the ${RUNTIME_LABEL[el.language]} runtime could not load — script not verified`);
      continue;
    }
    envelopes.set(el.id, res);
    if (!res.ok || res.error) {
      out.errors.push(
        `code element "${el.id}" fails when executed — fix the script:\n${(res.error ?? res.stderr).slice(0, 600)}`,
      );
      continue;
    }
    if (res.stderr.trim() !== "") {
      out.warnings.push(`code "${el.id}" writes to stderr (${res.stderr.trim().slice(0, 200)}) — silence it or fix the cause`);
    }
    // A referenced path the harvest could not serve: the model repairs the
    // script (assign the variable) or the token (name the right one).
    for (const [path, msg] of Object.entries(res.dataErrors ?? {})) {
      out.errors.push(`code "${el.id}": {${el.id}.${path}} — ${msg}`);
    }
  }
  if (Object.keys(byId).length === 0) {
    out.resolvedParams = spec.params;
    out.unresolvedTokens = 0;
    return out;
  }
  // Elements whose script actually produced an envelope — ok or not, a real
  // run happened and its outcome is a real judgment. A token naming any
  // OTHER id (runtime unavailable, a throwing runner, or an id with no code
  // element at all) never got that judgment, so its deletion below is not
  // evidence the spec's params are wrong.
  const verified = new Set(envelopes.keys());
  const { params, failures } = substituteDataTokens(spec.params, (codeId, path) => {
    const env = envelopes.get(codeId);
    if (!env || !env.ok) return { error: "not run" };
    if (env.dataErrors && path in env.dataErrors) return { error: env.dataErrors[path] };
    if (env.data && path in env.data) return { value: env.data[path] };
    return { error: "not harvested" };
  });
  out.resolvedParams = params;
  out.unresolvedTokens = failures.filter((f) => !verified.has(f.token.codeId)).length;
  return out;
}
