import type { AgentId, StoreReport } from "./types.js";
import type { AggregateStats } from "./aggregate.js";
import { formatCompactTokens, formatCount, formatPercent } from "./format.js";

export function sortReportsNewest(reports: readonly StoreReport[]): StoreReport[] {
  return [...reports].sort((a, b) => {
    const delta = Date.parse(b.timestamp) - Date.parse(a.timestamp);
    if (delta !== 0) {
      return delta;
    }
    return b.sessionId.localeCompare(a.sessionId);
  });
}

export function filterSessions(
  reports: readonly StoreReport[],
  options?: { agent?: AgentId; workspace?: string },
): StoreReport[] {
  return sortReportsNewest(reports).filter((report) => {
    if (options?.agent && report.agent !== options.agent) {
      return false;
    }
    if (options?.workspace) {
      const needle = options.workspace.toLowerCase();
      const display = report.workspaceDisplayName?.toLowerCase() ?? "";
      if (display !== needle && !display.includes(needle)) {
        return false;
      }
    }
    return true;
  });
}

export function findSession(reports: readonly StoreReport[], id: string): StoreReport | undefined {
  const exact = sortReportsNewest(reports).find((report) => report.sessionId === id);
  if (exact) {
    return exact;
  }
  const matches = sortReportsNewest(reports).filter((report) => report.sessionId.startsWith(id));
  return matches[0];
}

export function formatSessionsTable(reports: readonly StoreReport[]): string {
  const header = [
    "SESSION".padEnd(12),
    "AGENT".padEnd(9),
    "MODEL".padEnd(14),
    "ORIGINAL".padStart(10),
    "EFFECTIVE".padStart(11),
    "SAVED".padStart(8),
  ].join(" ");
  if (reports.length === 0) {
    return `${header}\n(no reports)`;
  }
  const rows = reports.map((report) => {
    const saved = formatPercent(report.potentialReductionPercent);
    return [
      report.sessionId.slice(0, 12).padEnd(12),
      displayAgent(report.agent).padEnd(9),
      (report.model ?? "—").slice(0, 14).padEnd(14),
      formatCompactTokens(report.originalTokens).padStart(10),
      formatCompactTokens(report.effectiveTokens).padStart(11),
      saved.padStart(8),
    ].join(" ");
  });
  return [header, ...rows].join("\n");
}

export function formatSessionDetail(report: StoreReport): string {
  const reasons = Object.entries(report.reasonCodeTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  return [
    `Session ${report.sessionId}`,
    "",
    `Agent                 ${displayAgent(report.agent)}`,
    `Model                 ${report.model ?? "unknown"}`,
    `Agent version         ${report.agentVersion ?? "unknown"}`,
    `Workspace             ${report.workspaceDisplayName ?? report.workspaceId}`,
    `Duration              ${Math.round(report.analysisDurationMs)}ms`,
    `Original              ${formatCount(report.originalTokens)}`,
    `Effective             ${formatCount(report.effectiveTokens)}`,
    `Potential saving      ${formatPercent(report.potentialReductionPercent)}`,
    `Completeness          ${report.dataCompleteness}`,
    "",
    "Savings",
    "────────────────────────",
    `Compression            ${formatCount(report.compressionSavings)}`,
    `Drop                   ${formatCount(report.dropSavings)}`,
    "",
    "Top reasons",
    "────────────────────────",
    ...(reasons.length > 0
      ? reasons.map(([code, tokens]) => `${code.padEnd(24)}${formatCount(tokens)}`)
      : ["(none)"]),
    "",
    "Safety",
    "────────────────────────",
    `Unsafe drops           ${formatCount(report.unsafeDropCount)}`,
    "",
    "Semantic",
    "────────────────────────",
    `Mode                   ${report.semanticMode.toUpperCase()}`,
    ...(report.semanticProvider ? [`Provider               ${report.semanticProvider}`] : []),
    "",
    "Engine",
    "────────────────────────",
    `engineVersion          ${report.engineVersion}`,
    `coreVersion            ${report.coreVersion}`,
    `adapterVersion         ${report.adapterVersion}`,
    `rulesetVersion         ${report.rulesetVersion}`,
    `semanticPolicyVersion  ${report.semanticPolicyVersion}`,
    "",
    "No raw transcript was stored.",
  ].join("\n");
}

export function formatStats(stats: AggregateStats): string {
  const completenessLines = Object.entries(stats.completeness)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind.padEnd(24)}${formatCount(count)}`);
  const mixed =
    (stats.completeness.full_tool_results ?? 0) > 0 && (stats.completeness.tool_calls_only ?? 0) > 0;
  return [
    "Context Engine — Local Shadow Statistics",
    "",
    `Period                 ${stats.periodLabel}`,
    `Sessions               ${formatCount(stats.sessionCount)}`,
    ...(stats.skippedReports > 0 ? [`Skipped reports        ${formatCount(stats.skippedReports)}`] : []),
    "",
    `Tokens observed        ${formatCompactTokens(stats.tokensObserved)}`,
    `Effective context      ${formatCompactTokens(stats.effectiveTokens)}`,
    "",
    `Potential savings      ${formatCompactTokens(stats.potentialSavings)}`,
    `Potential reduction    ${formatPercent(stats.potentialReductionPercent)}`,
    "",
    "Savings by mechanism",
    "────────────────────────",
    `Compression            ${formatCompactTokens(stats.compressionSavings)}`,
    `Deterministic drop     ${formatCompactTokens(stats.deterministicDropSavings)}`,
    `Semantic drop          ${formatCompactTokens(stats.semanticDropSavings)}`,
    "",
    "By agent",
    "────────────────────────",
    ...(["codex", "cursor", "claude"] as const).map((agent) => {
      const bucket = stats.byAgent[agent];
      return `${displayAgent(agent).padEnd(14)}${String(bucket.sessions).padStart(3)} sessions    ${formatCompactTokens(bucket.original)} → ${formatCompactTokens(bucket.effective)}`;
    }),
    "",
    "Safety",
    "────────────────────────",
    `Unsafe drops           ${formatCount(stats.unsafeDropCount)}`,
    "",
    "Top reasons",
    "────────────────────────",
    ...(stats.topReasons.length > 0
      ? stats.topReasons.map((entry) => `${entry.code.padEnd(24)}${formatCompactTokens(entry.tokens)}`)
      : ["(none)"]),
    "",
    "Data completeness",
    "────────────────────────",
    ...(completenessLines.length > 0 ? completenessLines : ["(none)"]),
    ...(mixed
      ? [
          "",
          "Cursor transcripts are often tool_calls_only. Do not compare reduction % with Codex/Claude as equivalent inputs.",
        ]
      : []),
  ].join("\n");
}

export function statsExportDocument(stats: AggregateStats): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "context-engine-local-stats",
    telemetry: false,
    includesSourcePreviews: false,
    includesTranscripts: false,
    ...stats,
    comparisonNote:
      "Sessions with dataCompleteness=tool_calls_only (typical of Cursor) are not equivalent to full_tool_results.",
  };
}

function displayAgent(agent: AgentId): string {
  if (agent === "codex") {
    return "Codex";
  }
  if (agent === "cursor") {
    return "Cursor";
  }
  return "Claude";
}
