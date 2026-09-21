import { describe, expect, it } from "vitest";
import {
  compressItem,
  errorExtractStrategy,
  selectCompressionStrategy,
  testSummaryStrategy,
} from "../src/compress.js";
import { DEFAULT_CONFIG } from "../src/pipeline.js";
import { ApproximateTokenEstimator } from "../src/tokens.js";
import { makeToolItem } from "./helpers.js";

const estimator = new ApproximateTokenEstimator(4);

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
    expect(compressed.content).toContain("error TS2304");
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
