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
console.log("OK: dist-engine entries import cleanly and expose their contracts.");
