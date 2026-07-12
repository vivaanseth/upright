import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const repositoryUrl =
  process.env.POSTURE_REPOSITORY_URL ?? "https://github.com";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __POSTURE_REPOSITORY_URL__: JSON.stringify(repositoryUrl),
    },
    build: { sourcemap: true },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
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
    build: { sourcemap: true },
  },
});
