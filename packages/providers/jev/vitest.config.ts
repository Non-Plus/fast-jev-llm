import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@fast-jev/core": fileURLToPath(new URL("../../core/src/index.ts", import.meta.url)),
    },
  },
});
