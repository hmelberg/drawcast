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
    // Netlify's build container advertises many CPUs and hands out about one.
    // Vitest sizes its worker pool from the advertised number, so the pool
    // starves vitest's OWN main thread: a worker's `onTaskUpdate` RPC waits
    // past its 60-second ceiling, and the run ends "7217 passed, 1 error".
    // Passing tests plus an unhandled error is exit code 2, so `npm test`
    // fails and `npm test && npm run build` never reaches the build — two
    // deploys died that way on 2026-09-11 with nothing wrong in the code.
    // Two workers keep the main thread scheduled; wall time is unchanged
    // because the container was serialising the run anyway (112 s wall
    // against 121 s of summed test time). Local runs keep the full pool.
    ...(process.env.CI ? { maxWorkers: 2, minWorkers: 1 } : {}),
  },
});
