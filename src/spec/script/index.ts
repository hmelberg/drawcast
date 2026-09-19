// The façade: what the rest of the app imports. Everything else in this
// folder is private to the format.
export { parseScriptPages, ScriptError, type ParsedScript, type ScriptPage } from "./parse";
export { printScriptPage, printScriptPages } from "./print";

import { parseScriptPages } from "./parse";
import { printScriptPages } from "./print";
import type { Spec } from "../types";

/** A single page, for the paths that hold one spec. */
export function parseScript(text: string): Spec {
  return parseScriptPages(text).pages[0].spec;
}

export function printScript(spec: Spec): string {
  return printScriptPages({}, [{ spec }]);
}
