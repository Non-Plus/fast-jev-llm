import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@fast-jev/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
});
