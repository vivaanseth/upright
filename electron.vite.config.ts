import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const repositoryUrl =
  process.env.UPRIGHT_REPOSITORY_URL ?? "https://github.com/vivaanseth/upright";
const sourceMaps = process.env.UPRIGHT_SOURCE_MAPS === "true";
const e2eFixture = process.env.UPRIGHT_E2E_FIXTURE === "true";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["zod"] })],
    define: {
      __UPRIGHT_REPOSITORY_URL__: JSON.stringify(repositoryUrl),
      __UPRIGHT_E2E_FIXTURE__: JSON.stringify(e2eFixture),
    },
    build: { sourcemap: sourceMaps },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["zod"] })],
    build: {
      sourcemap: sourceMaps,
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          nudge: resolve("src/preload/nudge.ts"),
        },
        output: { format: "cjs", entryFileNames: "[name].js" },
      },
    },
  },
  renderer: {
    define: {
      __UPRIGHT_E2E_FIXTURE__: JSON.stringify(e2eFixture),
    },
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
