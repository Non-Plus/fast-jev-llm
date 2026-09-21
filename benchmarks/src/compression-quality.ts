import {
  ApproximateTokenEstimator,
  compressItem,
  DEFAULT_CONFIG,
  normalizeTranscript,
  selectCompressionStrategy,
} from "@fast-jev/core";
import type { ContextMessage, Transcript } from "@fast-jev/core";

function toolExchange(
  name: string,
  args: Record<string, unknown>,
  result: string,
  extra?: { exitCode?: number; isError?: boolean },
): ContextMessage[] {
  return [
    {
      id: `a-${name}`,
      role: "assistant",
      content: "",
      toolCalls: [{ id: `c-${name}`, name, arguments: args }],
    },
    {
      id: `t-${name}`,
      role: "tool",
      toolCallId: `c-${name}`,
      name,
      content: result,
      metadata: {
        ...(extra?.exitCode !== undefined ? { exitCode: extra.exitCode } : {}),
        ...(extra?.isError ? { isError: true } : {}),
      },
    },
  ];
}

function transcriptFor(label: string, messages: ContextMessage[]): Transcript {
  return { sessionId: `quality-${label}`, messages };
}

function hugeBuild(failed: boolean): string {
  const chatter = Array.from({ length: 2000 }, (_, i) => `webpack: compiled module ${i}`);
  if (!failed) {
    return ["npm run build", ...chatter, "compiled successfully", "Warnings: 12"].join("\n");
  }
  return [
    "npm run build",
    ...chatter,
    "src/auth.ts:128:4 - error TS2322: Type 'X' is not assignable to type 'Y'.",
    "src/user.ts:44:8 - error TS2345: Argument of type 'A' is not assignable to parameter of type 'B'.",
    "src/session.ts:9:1 - error TS2304: Cannot find name 'windowMs'.",
    "Found 3 errors.",
    "Failed to compile.",
  ].join("\n");
}

function hugeTests(): string {
  return [
    ...Array.from({ length: 418 }, (_, i) => `PASS src/ok${i}.test.ts`),
    "FAIL src/auth.test.ts",
    "  × should reject expired token",
    "    Expected: 401",
    "    Received: 200",
    "FAIL src/payment.test.ts",
    "  × charges the card",
    "FAIL src/session.test.ts",
    "  × stores the cookie",
    "Tests: 3 failed, 418 passed, 4 skipped",
  ].join("\n");
}

function hugeDiff(): string {
  return [
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
    " 2 files changed, 400 insertions(+), 20 deletions(-)",
    ...Array.from({ length: 1600 }, (_, i) => `+padding ${i}`),
  ].join("\n");
}

function hugeTree(): string {
  return [
    "src",
    "README.md",
    ...Array.from({ length: 400 }, (_, i) => `node_modules/pkg/file${i}.js`),
    ...Array.from({ length: 80 }, (_, i) => `dist/chunk${i}.js`),
  ].join("\n");
}

function extrasFrom(content: string): Record<string, string | number> {
  const errors = [...content.matchAll(/\bTS\d+\b/g)].map((match) => match[0]);
  const files = [...content.matchAll(/src\/\S+\.\w+/g)].map((match) => match[0]);
  const failures = [...content.matchAll(/FAIL\s+\S+|\s{2}.+/g)].length;
  return {
    errors: new Set(errors).size,
    files: new Set(files).size,
    failureHints: failures,
  };
}

function report(
  label: string,
  original: number,
  retained: number,
  extras: Record<string, string | number>,
): void {
  const reduction = original === 0 ? 0 : ((original - retained) / original) * 100;
  console.log(`\n${label}`);
  console.log(`  original tokens:  ${original}`);
  console.log(`  retained tokens:  ${retained}`);
  console.log(`  reduction:        ${reduction.toFixed(1)}%`);
  for (const [key, value] of Object.entries(extras)) {
    console.log(`  ${key.padEnd(18)} ${value}`);
  }
}

function runCase(
  label: string,
  command: string,
  output: string,
  extra?: { exitCode?: number; isError?: boolean },
): void {
  const items = normalizeTranscript(
    transcriptFor(label, [
      { id: "u", role: "user", content: `Run ${command}` },
      ...toolExchange("Shell", { command }, output, extra),
    ]),
    DEFAULT_CONFIG,
  );
  const item = items.find((entry) => entry.tool?.command === command);
  if (!item) {
    throw new Error(`No tool item for ${label}`);
  }
  const estimator = new ApproximateTokenEstimator(DEFAULT_CONFIG.charsPerToken);
  const compressed = compressItem(item, DEFAULT_CONFIG, estimator);
  const strategy = selectCompressionStrategy(item).name;
  report(label, compressed.originalTokens, compressed.retainedTokens, {
    strategy,
    ...extrasFrom(compressed.content),
  });
}

console.log("Context Engine — deterministic compression quality");
console.log("Runs structured compressors directly (not gated on prune budgets).");
runCase("build failure", "npm run build", hugeBuild(true), { exitCode: 1, isError: true });
runCase("build success", "npm run build", hugeBuild(false), { exitCode: 0 });
runCase("test suite", "pnpm test", hugeTests(), { exitCode: 1, isError: true });
runCase("git diff", "git diff", hugeDiff());
runCase("directory listing", "find .", hugeTree());
