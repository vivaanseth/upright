import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const repositoryUrl =
  process.env.POSTURE_REPOSITORY_URL ?? "https://github.com";
const sourceMaps = process.env.POSTURE_SOURCE_MAPS === "true";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["zod"] })],
    define: {
      __POSTURE_REPOSITORY_URL__: JSON.stringify(repositoryUrl),
    },
    build: { sourcemap: sourceMaps },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: sourceMaps,
      rollupOptions: { output: { format: "cjs", entryFileNames: "index.js" } },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react()],
    build: { sourcemap: sourceMaps },
  },
});
