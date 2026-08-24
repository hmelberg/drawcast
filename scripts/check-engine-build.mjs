// Post-build smoke: both entries must import cleanly in Node (all DOM paths
// are guarded) and expose their contracts. Run by `npm run build:engine`.
const need = async (rel, keys) => {
  const mod = await import(new URL(`../dist-engine/${rel}`, import.meta.url));
  for (const k of keys) {
    if (typeof mod[k] === "undefined") {
      console.error(`FAIL: dist-engine/${rel} is missing export "${k}"`);
      process.exit(1);
    }
  }
};
await need("engine.js", ["render", "loadSpecText", "parseSpecText", "formatSpec", "validateSpec", "DrawcastFigure", "defineDrawcastFigure"]);
await need("compiler.js", ["compileFigure", "generateSpec", "MODELS", "DEFAULT_MODEL", "describeApiError"]);

// Prompt-assembly smoke: compileFigure must get as far as building the
// request (exemplar pool, prompt variant, pack loading) before it ever
// touches the network. A shape bug there (e.g. mapping bundled examples to
// the wrong exemplar fields) throws a TypeError synchronously; a real API
// call failing on the fake key does not. No network access is assumed to
// succeed or even happen — both a resolved outcome and a rejected fetch
// count as PASS, only a prompt-assembly-shaped error counts as FAIL.
const compiler = await import(new URL("../dist-engine/compiler.js", import.meta.url));
const REGRESSION = /toLowerCase|is not a function|Cannot read properties/i;
try {
  const result = await compiler.compileFigure("smoke: a supply and demand diagram", { apiKey: "sk-ant-fake-key" });
  if (result && typeof result.error === "string" && REGRESSION.test(result.error)) {
    console.error(`FAIL: dist-engine/compiler.js compileFigure regressed on prompt assembly: ${result.error}`);
    process.exit(1);
  }
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  if (REGRESSION.test(message)) {
    console.error(`FAIL: dist-engine/compiler.js compileFigure regressed on prompt assembly: ${message}`);
    process.exit(1);
  }
}

console.log("OK: dist-engine entries import cleanly and expose their contracts.");
