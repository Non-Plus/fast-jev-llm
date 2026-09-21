import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@fast-jev/core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
      "@fast-jev/adapter-claude": fileURLToPath(
        new URL("../packages/adapter-claude/src/index.ts", import.meta.url),
      ),
    },
  },
});
