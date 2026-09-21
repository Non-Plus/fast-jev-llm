import { describe, expect, it } from "vitest";
import {
  compressItem,
  directoryListStrategy,
  errorExtractStrategy,
  gitDiffStrategy,
  selectCompressionStrategy,
  testSummaryStrategy,
} from "../src/compress.js";
import { DEFAULT_CONFIG } from "../src/pipeline.js";
import { ApproximateTokenEstimator } from "../src/tokens.js";
import { makeToolItem } from "./helpers.js";

const estimator = new ApproximateTokenEstimator(4);

function hugeBuild(status: "fail" | "ok"): string {
  const chatter = Array.from({ length: 2000 }, (_, index) => `webpack: compiled module ${index}`);
  if (status === "ok") {
    return ["npm run build", ...chatter, "compiled successfully", "built in 12.4s", "Warnings: 12"].join(
      "\n",
    );
  }
  return [
    "npm run build",
    ...chatter,
    "src/auth.ts:128:4 - error TS2322: Type 'X' is not assignable to type 'Y'.",
    "src/auth.ts:128:4 - error TS2322: Type 'X' is not assignable to type 'Y'.",
    "src/user.ts:44:8 - error TS2345: Argument of type 'A' is not assignable to parameter of type 'B'.",
    "src/session.ts:9:1 - error TS2304: Cannot find name 'windowMs'.",
    "Found 3 errors.",
    "Failed to compile.",
  ].join("\n");
}

describe("compression strategies", () => {
  it("uses error_extract for compiler diagnostics", () => {
    const item = makeToolItem(
      "tsc",
      {
        name: "Shell",
        kind: "command",
        callId: "tsc",
        args: { command: "tsc" },
        command: "tsc",
        isError: true,
        exitCode: 1,
        failureKind: "compile",
        result: [
          "src/a.ts:1:1 - error TS2304: Cannot find name 'foo'.",
          "src/a.ts:2:1 - error TS2322: Type 'string' is not assignable to type 'number'.",
          "Found 2 errors.",
        ].join("\n"),
      },
      "padding\n".repeat(50) + "error TS2304: Cannot find name 'foo'.",
      400,
    );
    expect(selectCompressionStrategy(item).name).toBe("error_extract");
    const compressed = errorExtractStrategy.compress(item, DEFAULT_CONFIG, estimator);
    expect(compressed.strategy).toBe("error_extract");
    expect(compressed.originalTokens).toBe(400);
    expect(compressed.retainedTokens).toBeLessThan(compressed.originalTokens);
    expect(compressed.content).toContain("TS2304");
  });

  it("summarizes a huge build failure without inventing errors", () => {
    const log = hugeBuild("fail");
    const item = makeToolItem(
      "build",
      {
        name: "Shell",
        kind: "build_run",
        callId: "build",
        args: { command: "npm run build" },
        command: "npm run build",
        exitCode: 1,
        isError: true,
        result: log,
      },
      log,
      Math.ceil(log.length / 4),
    );
    const compressed = compressItem(item, DEFAULT_CONFIG, estimator);
    expect(compressed.strategy).toBe("error_extract");
    expect(compressed.content).toContain("BUILD FAILED");
    expect(compressed.content).toContain("npm run build");
    expect(compressed.content).toContain("Exit code:");
    expect(compressed.content).toContain("1");
    expect(compressed.content).toContain("src/auth.ts:128:4");
    expect(compressed.content).toContain("TS2322");
    expect(compressed.content).toContain("src/user.ts:44:8");
    expect(compressed.retainedTokens).toBeLessThan(compressed.originalTokens / 5);
    expect(compressed.content).not.toContain("webpack: compiled module 1500");
    expect(compressed.content.match(/TS2322/g)?.length).toBeLessThanOrEqual(2);
  });

  it("summarizes a huge successful build", () => {
    const log = hugeBuild("ok");
    const item = makeToolItem(
      "build-ok",
      {
        name: "Shell",
        kind: "build_run",
        callId: "build-ok",
        args: { command: "npm run build" },
        command: "npm run build",
        exitCode: 0,
        result: log,
      },
      log,
      Math.ceil(log.length / 4),
    );
    const compressed = compressItem(item, DEFAULT_CONFIG, estimator);
    expect(compressed.content).toContain("BUILD SUCCEEDED");
    expect(compressed.content).toContain("Warnings: 12");
    expect(compressed.retainedTokens).toBeLessThan(compressed.originalTokens / 5);
  });

  it("uses test_summary for test output", () => {
    const item = makeToolItem(
      "test",
      {
        name: "Shell",
        kind: "test_run",
        callId: "test",
        args: {},
        command: "pnpm test",
        testTarget: "pnpm test",
        result: "PASS src/a.test.ts\nFAIL src/b.test.ts\nAssertionError: expected 429\n3 passed, 1 failed",
      },
      "PASS src/a.test.ts\nFAIL src/b.test.ts\nAssertionError: expected 429",
    );
    expect(selectCompressionStrategy(item).name).toBe("test_summary");
    const compressed = testSummaryStrategy.compress(item, DEFAULT_CONFIG, estimator);
    expect(compressed.strategy).toBe("test_summary");
    expect(compressed.content).toContain("FAIL");
  });

  it("summarizes a huge test suite without keeping passing lines", () => {
    const passes = Array.from({ length: 418 }, (_, index) => `PASS src/ok${index}.test.ts`);
    const log = [
      ...passes,
      "FAIL src/auth.test.ts",
      "  × should reject expired token",
      "    Expected: 401",
      "    Received: 200",
      "FAIL src/payment.test.ts",
      "  × charges the card",
      "Tests: 3 failed, 418 passed, 4 skipped",
    ].join("\n");
    const item = makeToolItem(
      "suite",
      {
        name: "Shell",
        kind: "test_run",
        callId: "suite",
        args: { command: "pnpm test" },
        command: "pnpm test",
        testTarget: "pnpm test",
        exitCode: 1,
        isError: true,
        result: log,
      },
      log,
      Math.ceil(log.length / 4),
    );
    const compressed = compressItem(item, DEFAULT_CONFIG, estimator);
    expect(compressed.strategy).toBe("test_summary");
    expect(compressed.content).toContain("418 passed");
    expect(compressed.content).toContain("3 failed");
    expect(compressed.content).toContain("auth.test.ts");
    expect(compressed.content).toContain("should reject expired token");
    expect(compressed.content).not.toContain("PASS src/ok100.test.ts");
    expect(compressed.retainedTokens).toBeLessThan(compressed.originalTokens / 5);
  });

  it("compresses git diffs to files and compact hunks", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 111..222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,4 @@",
      " export const a = 1;",
      "+export const b = 2;",
      "diff --git a/src/b.ts b/src/b.ts",
      "index 333..444 100644",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      " 3 files changed, 10 insertions(+), 2 deletions(-)",
      ...Array.from({ length: 800 }, (_, index) => `+padding ${index}`),
    ].join("\n");
    const item = makeToolItem(
      "diff",
      {
        name: "Shell",
        kind: "git_diff",
        callId: "diff",
        args: { command: "git diff" },
        command: "git diff",
        result: diff,
      },
      diff,
      Math.ceil(diff.length / 4),
    );
    const compressed = compressItem(item, DEFAULT_CONFIG, estimator);
    expect(compressed.strategy).toBe("git_diff");
    expect(compressed.content).toContain("src/a.ts");
    expect(compressed.content).toContain("Files changed");
    expect(compressed.content).toContain("diff --git");
    expect(compressed.retainedTokens).toBeLessThan(compressed.originalTokens);
  });

  it("falls back to head_tail when a git_diff has no parseable structure", () => {
    const blob = "not a real diff\n" + "x".repeat(5000);
    const item = makeToolItem(
      "diff-bad",
      {
        name: "Shell",
        kind: "git_diff",
        callId: "diff-bad",
        args: { command: "git diff" },
        command: "git diff",
        result: blob,
      },
      blob,
      Math.ceil(blob.length / 4),
    );
    const compressed = compressItem(item, DEFAULT_CONFIG, estimator);
    expect(compressed.strategy).toBe("head_tail");
  });

  it("compresses directory listings and skips noisy dependency trees", () => {
    const listing = [
      "src",
      "src/auth.ts",
      "README.md",
      ...Array.from({ length: 400 }, (_, index) => `node_modules/lodash/file${index}.js`),
      ...Array.from({ length: 80 }, (_, index) => `dist/chunk${index}.js`),
      ".git/HEAD",
    ].join("\n");
    const item = makeToolItem(
      "ls",
      {
        name: "Shell",
        kind: "directory_list",
        callId: "ls",
        args: { command: "find ." },
        command: "find .",
        path: ".",
        result: listing,
      },
      listing,
      Math.ceil(listing.length / 4),
    );
    expect(selectCompressionStrategy(item).name).toBe("directory_list");
    const compressed = directoryListStrategy.compress(item, DEFAULT_CONFIG, estimator);
    expect(compressed.content).toContain("DIRECTORY LISTING");
    expect(compressed.content).toContain("src");
    expect(compressed.content).toContain("node_modules/");
    expect(compressed.content).not.toContain("lodash/file100.js");
    expect(compressed.content).toContain("Truncated: true");
  });

  it("falls back to head_tail", () => {
    const item = makeToolItem(
      "lock",
      {
        name: "Read",
        kind: "file_read",
        callId: "lock",
        args: { path: "lock" },
        path: "lock",
        result: "x".repeat(5000),
      },
      "x".repeat(5000),
      2000,
    );
    const compressed = compressItem(item, DEFAULT_CONFIG, estimator);
    expect(compressed.strategy).toBe("head_tail");
    expect(compressed.content).toContain("[compressed head_tail");
    expect(compressed.retainedTokens).toBeLessThan(compressed.originalTokens);
  });
});
