import type { CompressionStrategy, EngineConfig, TokenEstimator } from "../types.js";
import { budgetForKind } from "../budgets.js";
import { commandOf, exitCodeOf, fitToTokenBudget, toolText, wrapStructured } from "./shared.js";

const FRAMEWORKS: Array<{ name: string; pattern: RegExp }> = [
  { name: "vitest", pattern: /\bvitest\b/i },
  { name: "jest", pattern: /\bjest\b/i },
  { name: "pytest", pattern: /\bpytest\b/i },
  { name: "mocha", pattern: /\bmocha\b/i },
  { name: "playwright", pattern: /\bplaywright\b/i },
  { name: "go test", pattern: /\bgo test\b/i },
  { name: "cargo test", pattern: /\bcargo test\b/i },
];

export interface TestCounts {
  passed?: number;
  failed?: number;
  skipped?: number;
}

export function parseTestCounts(text: string): TestCounts {
  const testsLine =
    /Tests:\s*(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed)(?:,\s*(\d+)\s+skipped)?/i.exec(text);
  if (testsLine) {
    return {
      ...(testsLine[2] !== undefined ? { passed: Number(testsLine[2]) } : {}),
      ...(testsLine[1] !== undefined ? { failed: Number(testsLine[1]) } : {}),
      ...(testsLine[3] !== undefined ? { skipped: Number(testsLine[3]) } : {}),
    };
  }
  const vitestPipe =
    /Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?/i.exec(text);
  if (vitestPipe) {
    return {
      failed: Number(vitestPipe[1]),
      passed: Number(vitestPipe[2]),
      ...(vitestPipe[3] !== undefined ? { skipped: Number(vitestPipe[3]) } : {}),
    };
  }
  const pytest =
    /(\d+)\s+failed,\s*(\d+)\s+passed(?:,\s*(\d+)\s+skipped)?/i.exec(text);
  if (pytest) {
    return {
      failed: Number(pytest[1]),
      passed: Number(pytest[2]),
      ...(pytest[3] !== undefined ? { skipped: Number(pytest[3]) } : {}),
    };
  }
  const compact = /(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+skipped)?/i.exec(text);
  if (compact) {
    return {
      passed: Number(compact[1]),
      ...(compact[2] !== undefined ? { failed: Number(compact[2]) } : {}),
      ...(compact[3] !== undefined ? { skipped: Number(compact[3]) } : {}),
    };
  }
  return {};
}

export function parseFailedTests(text: string): { file?: string; name?: string; message?: string }[] {
  const failures: { file?: string; name?: string; message?: string }[] = [];
  const failFiles = [...text.matchAll(/^FAIL\s+(\S+)/gm)].map((match) => match[1]);
  const named = [...text.matchAll(/^\s*(?:✕|×|❌|●)\s+(.+)$/gm)].map((match) => match[1]?.trim());
  const expected = [...text.matchAll(/Expected[:\s]+(.+)\n(?:Received|received)[:\s]+(.+)/g)];

  const max = Math.max(failFiles.length, named.length, 1);
  for (let i = 0; i < max; i += 1) {
    const file = failFiles[i];
    const name = named[i];
    const message = expected[i]
      ? `Expected ${expected[i]?.[1]?.trim()}, received ${expected[i]?.[2]?.trim()}`
      : undefined;
    if (!file && !name && !message) {
      continue;
    }
    failures.push({
      ...(file !== undefined ? { file } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(message !== undefined ? { message } : {}),
    });
  }
  return failures;
}

function frameworkOf(item: { tool?: { command?: string } }, text: string): string | undefined {
  const blob = `${item.tool?.command ?? ""} ${text}`;
  return FRAMEWORKS.find((entry) => entry.pattern.test(blob))?.name;
}

export function formatTestSummary(
  item: Parameters<CompressionStrategy["compress"]>[0],
  config: EngineConfig,
  estimator: TokenEstimator,
): string {
  const text = toolText(item);
  const counts = parseTestCounts(text);
  const failures = parseFailedTests(text);
  const failed = counts.failed ?? failures.length;
  const passed = counts.passed;
  const skipped = counts.skipped;
  const status =
    (item.tool?.exitCode !== undefined && item.tool.exitCode !== 0) || failed > 0
      ? "TESTS FAILED"
      : "TESTS PASSED";
  const countParts = [
    passed !== undefined ? `${passed} passed` : undefined,
    `${failed} failed`,
    skipped !== undefined ? `${skipped} skipped` : undefined,
  ].filter((part): part is string => part !== undefined);

  const lines = [
    status,
    "",
    "Command:",
    commandOf(item) ?? item.tool?.name ?? "unknown",
  ];
  const framework = frameworkOf(item, text);
  if (framework) {
    lines.push("", "Framework:", framework);
  }
  const exit = exitCodeOf(item);
  if (exit !== undefined) {
    lines.push("", "Exit code:", String(exit));
  }
  lines.push("", `Tests: ${countParts.join(", ")}`);
  if (failures.length > 0) {
    lines.push("", "Failures:");
    for (const failure of failures) {
      if (failure.file) {
        lines.push(failure.file);
      }
      if (failure.name) {
        lines.push(`  ${failure.name}`);
      }
      if (failure.message) {
        lines.push(`  ${failure.message}`);
      }
    }
  }
  const paths = [...text.matchAll(/(\S+\.(?:test|spec)\.\w+)/g)]
    .map((match) => match[1])
    .filter((path): path is string => typeof path === "string");
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length > 0 && failures.every((failure) => !failure.file)) {
    lines.push("", "Relevant files:", ...uniquePaths.slice(0, 12));
  }
  lines.push("", "Original:", `${item.tokenCount} tokens`);
  return fitToTokenBudget(lines.join("\n"), budgetForKind("test_run", config), estimator);
}

export const testSummaryStrategy: CompressionStrategy = {
  name: "test_summary",
  supports(item) {
    return item.tool?.kind === "test_run" || item.tool?.failureKind === "test";
  },
  compress(item, config, estimator) {
    return wrapStructured("test_summary", item, formatTestSummary(item, config, estimator), estimator);
  },
};
