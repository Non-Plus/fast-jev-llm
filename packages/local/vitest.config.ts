import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@fast-jev/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@fast-jev/adapter-codex": fileURLToPath(new URL("../adapter-codex/src/index.ts", import.meta.url)),
      "@fast-jev/adapter-cursor": fileURLToPath(new URL("../adapter-cursor/src/index.ts", import.meta.url)),
      "@fast-jev/adapter-claude": fileURLToPath(new URL("../adapter-claude/src/index.ts", import.meta.url)),
      "@fast-jev/provider-jev": fileURLToPath(new URL("../providers/jev/src/index.ts", import.meta.url)),
    },
  },
});
