import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src/renderer/src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/renderer/src/test/setup.ts"],
  },
});
