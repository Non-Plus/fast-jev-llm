import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { MockSemanticProvider } from "@fast-jev/core";
import { analyzeClaudeSession, parseClaudeJsonl } from "@fast-jev/adapter-claude";
import { analyzeCodexSession } from "@fast-jev/adapter-codex";
import { analyzeCursorSession } from "@fast-jev/adapter-cursor";
import { compareStrategies, formatComparisonReport } from "./compare-strategies.js";

async function* walkJsonl(dir: string, depth = 0): AsyncGenerator<string> {
  if (depth > 4 || !existsSync(dir)) {
    return;
  }
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let info;
    try {
      info = await stat(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      yield* walkJsonl(full, depth + 1);
    } else if (entry.endsWith(".jsonl") && !entry.startsWith("agent-")) {
      yield full;
    }
  }
}

async function pickSession(
  roots: string[],
  maxBytes: number,
  minBytes: number,
): Promise<{ path: string; bytes: number } | undefined> {
  let best: { path: string; bytes: number } | undefined;
  for (const root of roots) {
    for await (const path of walkJsonl(root)) {
      try {
        const bytes = (await stat(path)).size;
        if (bytes < minBytes || bytes > maxBytes) {
          continue;
        }
        if (!best || bytes > best.bytes) {
          best = { path, bytes };
        }
      } catch {
        continue;
      }
    }
  }
  return best;
}

function completeness(agent: string): string {
  if (agent === "Codex") {
    return "full tool results";
  }
  if (agent === "Cursor") {
    return "tool calls only (observed local transcripts)";
  }
  return "full tool results";
}

async function analyzeIfPresent(
  label: string,
  path: string | undefined,
  run: (path: string) => Promise<{
    originalTokens: number;
    effectiveTokens?: number;
    totalPotentialSavings?: number;
    potentialReductionPercent: number;
  }>,
): Promise<void> {
  if (!path || !existsSync(path)) {
    console.log(`${label.padEnd(8)}  (no local session found)`);
    return;
  }
  const result = await run(path);
  const effective =
    result.effectiveTokens ??
    Math.max(0, result.originalTokens - (result.totalPotentialSavings ?? 0));
  console.log(
    `${label.padEnd(8)}  ${String(Math.round(result.originalTokens)).padStart(10)}  ${String(Math.round(effective)).padStart(10)}  ${result.potentialReductionPercent.toFixed(1).padStart(8)}%  ${completeness(label)}`,
  );
}

const fixture = new URL("../fixtures/adversarial/all-cases.claude.jsonl", import.meta.url);
const authFixture = new URL(
  "../../packages/adapter-claude/fixtures/cross-agent/auth.claude.jsonl",
  import.meta.url,
);

console.log("Task 7 — Claude shadow + Fast-Jev-style comparison");
console.log("SHADOW MODE. No Claude/Codex/Cursor context was modified.\n");

const provider = new MockSemanticProvider({
  defaultResponse: { action: "COMPRESS", relevanceScore: 0.45 },
});

for (const [label, url] of [
  ["adversarial", fixture],
  ["auth fixture", authFixture],
] as const) {
  const parsed = await parseClaudeJsonl(url);
  const report = await compareStrategies(parsed.transcript, {
    semanticProvider: provider,
    sessionId: parsed.meta.sessionId,
    observedClaudeCompaction: parsed.meta.observedClaudeCompaction,
  });
  console.log(`\n=== ${label} ===`);
  console.log(formatComparisonReport(report));
}

const claudeHome = join(homedir(), ".claude", "projects");
const chosen = await pickSession([claudeHome], 8_000_000, 400_000);
if (chosen) {
  const before = await readFile(chosen.path);
  console.log(`\n=== real Claude session ===`);
  console.log(`path: ${chosen.path}`);
  console.log(`bytes: ${chosen.bytes}`);
  const parsed = await parseClaudeJsonl({ path: chosen.path });
  const result = await analyzeClaudeSession(
    { path: chosen.path },
    { sourcePath: chosen.path, previewLength: 160 },
  );
  const after = await readFile(chosen.path);
  if (!before.equals(after)) {
    throw new Error("Claude transcript was modified");
  }
  console.log(`Claude version: ${result.claudeVersion ?? parsed.meta.claudeVersion ?? "unknown"}`);
  console.log(`session: ${result.sessionId}`);
  console.log(`model: ${result.model ?? "unknown"}`);
  console.log(`original tokens: ${result.originalTokens}`);
  console.log(`effective tokens: ${result.effectiveTokens}`);
  console.log(`compression savings: ${result.compressionSavings}`);
  console.log(`drop savings: ${result.dropSavings}`);
  console.log(`potential reduction: ${result.potentialReductionPercent.toFixed(1)}%`);
  console.log("top reason codes:");
  for (const [code, tokens] of Object.entries(result.reductionByReasonCode).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${code.padEnd(28)} ${Math.round(tokens)}`);
  }
  console.log("largest 10 savings:");
  for (const [index, item] of [...result.items].sort((a, b) => b.savedTokens - a.savedTokens).slice(0, 10).entries()) {
    console.log(
      `  #${index + 1} ${item.itemId} ${item.action} ${item.reasonCode} saved=${item.savedTokens} ${item.toolName ?? item.kind}`,
    );
    if (item.preview) {
      console.log(`     preview: ${item.preview.slice(0, 180)}`);
    }
  }
  const compare = await compareStrategies(parsed.transcript, {
    semanticProvider: provider,
    sessionId: result.sessionId,
    observedClaudeCompaction: parsed.meta.observedClaudeCompaction,
  });
  console.log(`\n${formatComparisonReport(compare)}`);
} else {
  console.log("\nNo safe-size real Claude session found under ~/.claude/projects (skipped 400MB+ files).");
}

console.log("\n=== three-agent summary ===");
console.log("Agent     Original    Effective  Reduce%  Data completeness");
const codexCandidate =
  process.env.CODEX_SESSION ??
  join(
    homedir(),
    ".codex/sessions/2026/09/21/rollout-2026-09-21T12-00-00-demo00000000-0000-4000-8000-000000000001.jsonl",
  );
const cursorRoot = join(homedir(), ".cursor", "projects");
const cursorChosen = await pickSession([cursorRoot], 8_000_000, 50_000);
await analyzeIfPresent("Codex", existsSync(codexCandidate) ? codexCandidate : undefined, (path) =>
  analyzeCodexSession({ path }),
);
await analyzeIfPresent("Cursor", cursorChosen?.path, (path) => analyzeCursorSession({ path }));
await analyzeIfPresent("Claude", chosen?.path, (path) => analyzeClaudeSession({ path }));
console.log("\nReduction percentages are not comparable without the completeness column.");
console.log(`File walked for discovery: ${basename(import.meta.url)}`);
