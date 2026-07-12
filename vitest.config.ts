import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@renderer": resolve("src/renderer/src"),
      "@shared": resolve("src/shared"),
    },
  },
  test: {
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: { reporter: ["text", "html"] },
  },
});
