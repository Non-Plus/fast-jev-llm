import type { AgentId, DataCompleteness, StoreReport } from "./types.js";

export interface AggregateStats {
  periodLabel: string;
  sessionCount: number;
  skippedReports: number;
  tokensObserved: number;
  effectiveTokens: number;
  potentialSavings: number;
  potentialReductionPercent: number;
  compressionSavings: number;
  deterministicDropSavings: number;
  semanticDropSavings: number;
  unsafeDropCount: number;
  byAgent: Record<
    AgentId,
    { sessions: number; original: number; effective: number; completeness: Record<string, number> }
  >;
  topReasons: Array<{ code: string; tokens: number }>;
  completeness: Record<DataCompleteness, number>;
}

export function aggregateReports(
  reports: readonly StoreReport[],
  options?: { days?: number; agent?: AgentId; now?: Date },
): AggregateStats {
  const now = options?.now ?? new Date();
  const cutoff =
    options?.days !== undefined ? now.getTime() - options.days * 24 * 60 * 60 * 1000 : undefined;
  const filtered = reports.filter((report) => {
    if (options?.agent && report.agent !== options.agent) {
      return false;
    }
    if (cutoff !== undefined) {
      const ts = Date.parse(report.timestamp);
      if (!Number.isFinite(ts) || ts < cutoff) {
        return false;
      }
    }
    return true;
  });

  const byAgent: AggregateStats["byAgent"] = {
    codex: { sessions: 0, original: 0, effective: 0, completeness: {} },
    cursor: { sessions: 0, original: 0, effective: 0, completeness: {} },
    claude: { sessions: 0, original: 0, effective: 0, completeness: {} },
  };
  const completeness: Record<DataCompleteness, number> = {
    full_tool_results: 0,
    tool_calls_only: 0,
    partial: 0,
    unknown: 0,
  };
  const reasons: Record<string, number> = {};
  let tokensObserved = 0;
  let effectiveTokens = 0;
  let compressionSavings = 0;
  let dropSavings = 0;
  let semanticDropSavings = 0;
  let unsafeDropCount = 0;

  for (const report of filtered) {
    const bucket = byAgent[report.agent];
    bucket.sessions += 1;
    bucket.original += report.originalTokens;
    bucket.effective += report.effectiveTokens;
    bucket.completeness[report.dataCompleteness] =
      (bucket.completeness[report.dataCompleteness] ?? 0) + 1;
    completeness[report.dataCompleteness] += 1;
    tokensObserved += report.originalTokens;
    effectiveTokens += report.effectiveTokens;
    compressionSavings += report.compressionSavings;
    dropSavings += report.dropSavings;
    semanticDropSavings += report.semanticDropSavings;
    unsafeDropCount += report.unsafeDropCount;
    for (const [code, tokens] of Object.entries(report.reasonCodeTotals)) {
      reasons[code] = (reasons[code] ?? 0) + tokens;
    }
  }

  const potentialSavings = Math.max(0, tokensObserved - effectiveTokens);
  return {
    periodLabel: options?.days !== undefined ? `${options.days} day${options.days === 1 ? "" : "s"}` : "All time",
    sessionCount: filtered.length,
    skippedReports: 0,
    tokensObserved,
    effectiveTokens,
    potentialSavings,
    potentialReductionPercent: tokensObserved === 0 ? 0 : (potentialSavings / tokensObserved) * 100,
    compressionSavings,
    deterministicDropSavings: Math.max(0, dropSavings - semanticDropSavings),
    semanticDropSavings,
    unsafeDropCount,
    byAgent,
    topReasons: Object.entries(reasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([code, tokens]) => ({ code, tokens })),
    completeness,
  };
}
