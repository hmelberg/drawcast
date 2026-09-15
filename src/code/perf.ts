// Where does the first knob's wait go? (spec 2026-09-15 §3.6: measure before
// warming anything.) `?perf` on the page turns these spans into console
// lines: runtime chunk import, interpreter boot, package installs, the run
// itself. Off, they cost one boolean.
export function perfEnabled(): boolean {
  return typeof location !== "undefined" && /[?&]perf(=|&|$)/.test(location.search);
}

/** Start a span; call the returned function to end it. `force` is for tests. */
export function perfSpan(label: string, force = false): () => void {
  if (!force && !perfEnabled()) return () => undefined;
  const t0 = performance.now();
  return () => console.info(`[perf] ${label} ${(performance.now() - t0).toFixed(1)} ms`);
}
