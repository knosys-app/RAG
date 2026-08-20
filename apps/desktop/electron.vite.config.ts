import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "node:path";

import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const workspacePackages = [
  "@knosys-rag/contracts",
  "@knosys-rag/core",
  "@knosys-rag/engine",
  "@knosys-rag/ingestion",
  "@knosys-rag/storage-sqlite",
];

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: workspacePackages,
        include: ["@napi-rs/canvas", "pdfjs-dist", "sqlite-vec"],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "engine/index": resolve("src/engine/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({ exclude: [...workspacePackages, "zod"] }),
    ],
    build: {
      rollupOptions: {
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
      },
    },
  },
});
