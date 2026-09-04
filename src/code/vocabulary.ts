// What the loaded runtimes know, published for the editors' word list.
//
// Dependency-free ON PURPOSE, exactly like languages.ts: the UI imports this,
// and code/microdata.ts (which pulls pyodide) fills it in after a boot. A
// direct import from ui/ to that module would drag the whole runtime into the
// main bundle, which the house rule forbids — so this tiny module is the seam.
//
// Nothing here ever triggers a load: the names appear once a script of that
// language has actually run, which in a lesson is before the viewer can click
// the panel anyway. Empty until then, and the completion falls back to the
// language's own vocabulary.

let microdataVariables: string[] = [];

/** The catalogue's variable names, from the emulator's own boot. */
export function publishMicrodataVariables(names: Iterable<string>): void {
  microdataVariables = [...names];
}

/** Every FDB variable the shipped catalogue knows, or [] before a boot. */
export function knownMicrodataVariables(): string[] {
  return microdataVariables;
}
