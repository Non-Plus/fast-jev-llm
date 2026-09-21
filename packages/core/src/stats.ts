import type {
  CompactionStats,
  ContextDecision,
  ContextItem,
  RuleStat,
} from "./types.js";

export function computeStats(
  items: readonly ContextItem[],
  compacted: readonly ContextItem[],
  decisions: readonly ContextDecision[],
): CompactionStats {
  const byId = new Map(items.map((item) => [item.id, item]));
  const byRule: Record<string, RuleStat> = {};

  const stats: CompactionStats = {
    originalItems: items.length,
    compactItems: compacted.length,
    originalTokens: items.reduce((sum, item) => sum + item.tokenCount, 0),
    compactTokens: compacted.reduce((sum, item) => sum + item.tokenCount, 0),
    keptCount: 0,
    keptTokens: 0,
    protectedCount: 0,
    protectedTokens: 0,
    compressedCount: 0,
    compressedTokens: 0,
    droppedCount: 0,
    droppedTokens: 0,
    byRule,
  };

  for (const decision of decisions) {
    const item = byId.get(decision.itemId);
    const tokens = item?.tokenCount ?? 0;
    const bucket = byRule[decision.rule] ?? { count: 0, tokens: 0 };
    bucket.count += 1;
    bucket.tokens += tokens;
    byRule[decision.rule] = bucket;

    switch (decision.action) {
      case "PROTECT":
        stats.protectedCount += 1;
        stats.protectedTokens += tokens;
        break;
      case "KEEP":
        stats.keptCount += 1;
        stats.keptTokens += tokens;
        break;
      case "COMPRESS": {
        stats.compressedCount += 1;
        const compactedItem = compacted.find((entry) => entry.id === decision.itemId);
        stats.compressedTokens += compactedItem?.tokenCount ?? tokens;
        break;
      }
      case "DROP":
        stats.droppedCount += 1;
        stats.droppedTokens += tokens;
        break;
    }
  }

  return stats;
}

function pad(value: string, width: number): string {
  return value.padEnd(width, " ");
}

function padNum(value: number, width: number): string {
  return String(value).padStart(width, " ");
}

export function formatStats(stats: CompactionStats, sessionId: string): string {
  const saved =
    stats.originalTokens === 0
      ? 0
      : ((stats.originalTokens - stats.compactTokens) / stats.originalTokens) * 100;

  const lines = [
    `Session: ${sessionId}`,
    `Original:  ${stats.originalItems} items / ${stats.originalTokens} tokens`,
    `Compact:   ${stats.compactItems} items / ${stats.compactTokens} tokens`,
    `Saved:     ${saved.toFixed(1)}% tokens`,
    "",
    `Protected: ${stats.protectedCount} items / ${stats.protectedTokens} tokens`,
    `Kept:      ${stats.keptCount} items / ${stats.keptTokens} tokens`,
    `Compressed:${stats.compressedCount} items / ${stats.compressedTokens} tokens (after stub)`,
    `Dropped:   ${stats.droppedCount} items / ${stats.droppedTokens} tokens`,
    "",
    "By winning rule:",
  ];

  const rules = Object.entries(stats.byRule).sort((a, b) => b[1].tokens - a[1].tokens);
  const nameWidth = Math.max(12, ...rules.map(([name]) => name.length));
  for (const [name, rule] of rules) {
    lines.push(
      `  ${pad(name, nameWidth)}  ${padNum(rule.count, 4)} items  ${padNum(rule.tokens, 7)} tokens`,
    );
  }
  return lines.join("\n");
}
