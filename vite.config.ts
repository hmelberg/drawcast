import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base so the build works on GitHub Pages subpaths and any static host.
  base: "./",
  build: {
    target: "es2022",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // A worker cap for CI stood here for an hour on 2026-09-11 and is gone
    // again: it was a wrong answer to the `onTaskUpdate` timeout described in
    // netlify.toml. Measured, capped at 2 — Netlify 114.17s against the
    // uncapped 112.33s, GitHub Actions 135.88s — and both still ended
    // "7217 passed, 1 error". Contention is not the cause; do not re-add it
    // without evidence that it changes something.
  },
});
