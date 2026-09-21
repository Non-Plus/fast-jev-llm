import type {
  CompactionStats,
  ContextDecision,
  ContextItem,
  RuleStat,
} from "./types.js";

function bump(bucket: Record<string, RuleStat>, key: string, tokens: number): void {
  const current = bucket[key] ?? { count: 0, tokens: 0 };
  current.count += 1;
  current.tokens += tokens;
  bucket[key] = current;
}

export function computeStats(
  items: readonly ContextItem[],
  compacted: readonly ContextItem[],
  decisions: readonly ContextDecision[],
): CompactionStats {
  const byId = new Map(items.map((item) => [item.id, item]));
  const byRule: Record<string, RuleStat> = {};
  const byReasonCode: Record<string, RuleStat> = {};
  const reductionByReasonCode: Record<string, number> = {};

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
    reductionPercent: 0,
    byRule,
    byReasonCode,
    reductionByReasonCode,
  };

  for (const decision of decisions) {
    const item = byId.get(decision.itemId);
    const tokens = item?.tokenCount ?? 0;
    bump(byRule, decision.rule, tokens);
    bump(byReasonCode, decision.reasonCode, tokens);

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
        reductionByReasonCode[decision.reasonCode] =
          (reductionByReasonCode[decision.reasonCode] ?? 0) +
          (tokens - (compactedItem?.tokenCount ?? tokens));
        break;
      }
      case "DROP":
        stats.droppedCount += 1;
        stats.droppedTokens += tokens;
        reductionByReasonCode[decision.reasonCode] =
          (reductionByReasonCode[decision.reasonCode] ?? 0) + tokens;
        break;
    }
  }

  stats.reductionPercent =
    stats.originalTokens === 0
      ? 0
      : ((stats.originalTokens - stats.compactTokens) / stats.originalTokens) * 100;

  return stats;
}

function pad(value: string, width: number): string {
  return value.padEnd(width, " ");
}

function padNum(value: number, width: number): string {
  return String(value).padStart(width, " ");
}

export function formatStats(stats: CompactionStats, sessionId: string): string {
  const lines = [
    `Session: ${sessionId}`,
    `Original tokens:   ${stats.originalTokens} (${stats.originalItems} items)`,
    `Protected tokens:  ${stats.protectedTokens} (${stats.protectedCount} items)`,
    `Kept tokens:       ${stats.keptTokens} (${stats.keptCount} items)`,
    `Compressed tokens: ${stats.compressedTokens} (${stats.compressedCount} items after stub)`,
    `Dropped tokens:    ${stats.droppedTokens} (${stats.droppedCount} items)`,
    `Compact tokens:    ${stats.compactTokens} (${stats.compactItems} items)`,
    `Reduction:         ${stats.reductionPercent.toFixed(1)}%`,
    "",
    "By reason code (token reduction):",
  ];

  const reductions = Object.entries(stats.reductionByReasonCode).sort(
    (a, b) => b[1] - a[1],
  );
  const reasonWidth = Math.max(
    12,
    ...reductions.map(([name]) => name.length),
    ...Object.keys(stats.byReasonCode).map((name) => name.length),
  );
  if (reductions.length === 0) {
    lines.push("  (none)");
  } else {
    for (const [code, tokens] of reductions) {
      const stat = stats.byReasonCode[code];
      lines.push(
        `  ${pad(code, reasonWidth)}  ${padNum(stat?.count ?? 0, 4)} items  ${padNum(tokens, 7)} tokens saved`,
      );
    }
  }

  lines.push("", "By winning rule:");
  const rules = Object.entries(stats.byRule).sort((a, b) => b[1].tokens - a[1].tokens);
  const nameWidth = Math.max(12, ...rules.map(([name]) => name.length));
  for (const [name, rule] of rules) {
    lines.push(
      `  ${pad(name, nameWidth)}  ${padNum(rule.count, 4)} items  ${padNum(rule.tokens, 7)} tokens`,
    );
  }
  return lines.join("\n");
}
