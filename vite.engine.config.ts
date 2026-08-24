import { defineConfig } from "vite";

// The embeddable engine build (engine.js + compiler.js) → dist-engine/.
// base "./" keeps chunk imports relative so the directory can be vendored
// wholesale into any host (xplainer copies it to vendor/drawcast/).
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist-engine",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        engine: "src/engine.ts",
        compiler: "src/compiler.ts",
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
      preserveEntrySignatures: "strict",
    },
  },
});
