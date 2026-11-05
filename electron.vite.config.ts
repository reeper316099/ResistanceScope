import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

// Builds three bundles: main process, sandboxed preload (must be ONE CommonJS file), and renderer.
export default defineConfig({
  main: { build: { rollupOptions: { input: { index: resolve("electron/main.ts") } } } },
  preload: { build: { rollupOptions: { input: { index: resolve("electron/preload.ts") } } } },
  renderer: {
    root: "src",
    build: { rollupOptions: { input: { index: resolve("src/index.html") } } },
  },
});
