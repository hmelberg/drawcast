import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base so the build works on GitHub Pages subpaths and any static host.
  base: "./",
  build: {
    target: "es2022",
    rollupOptions: {
      // A second entry: the player drawcast pages load (src/play.ts,
      // standalone/page.ts), at the one name they link — drawcast.app/play.js.
      // It shares its chunks with the app, so a reader who has been on
      // drawcast.app has the player already. The relative base above is what
      // lets a page on another site load those chunks from here.
      input: { index: "index.html", play: "src/play.ts" },
      output: {
        entryFileNames: (chunk) => (chunk.name === "play" ? "play.js" : "assets/[name]-[hash].js"),
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The offline icon cache, as the app registers it (round 6 §8).
    setupFiles: ["tests/setup-icons.ts"],
    // A worker cap for CI stood here for an hour on 2026-09-11 and is gone
    // again: it was a wrong answer to the `onTaskUpdate` timeout described in
    // netlify.toml. Measured, capped at 2 — Netlify 114.17s against the
    // uncapped 112.33s, GitHub Actions 135.88s — and both still ended
    // "7217 passed, 1 error". Contention is not the cause; do not re-add it
    // without evidence that it changes something.
  },
});
