import {
  compact,
  applyProtectRules,
  DEFAULT_CONFIG,
  normalizeTranscript,
  type ContextDecision,
  type SemanticProvider,
  type Transcript,
} from "@fast-jev/core";
import { runFastJevBaseline, type FastJevBaselineResult } from "./fast-jev-baseline.js";

const SAFETY_CODES = new Set([
  "USER_CONSTRAINT",
  "CURRENT_TASK",
  "UNRESOLVED_ERROR",
  "SYSTEM_INSTRUCTION",
]);

export type ComparisonStrategyId =
  | "native-transcript"
  | "deterministic"
  | "deterministic-semantic"
  | "fast-jev-style-baseline"
  | "observed-claude-compaction";

export interface StrategyMetrics {
  strategy: ComparisonStrategyId;
  available: boolean;
  unavailableReason?: string;
  originalTokens: number;
  effectiveTokens: number;
  reductionPercent: number;
  tokensRetained: number;
  tokensRemoved: number;
  protectedUserConstraintsRetained: boolean;
  currentTaskRetained: boolean;
  unresolvedErrorsRetained: boolean;
  historicalToolTokensRetained: number;
  toolOutputsRemoved: number;
  toolOutputsCompressed: number;
  unsafeDropCount: number;
  unsafeDropItemIds: string[];
  semanticCalls: number;
  semanticCandidates: number;
  semanticCandidateTokens: number;
  externalTokensSent: number;
  latencyMs: number;
  processingCostNote: string;
}

export interface ComparisonReport {
  sessionId?: string;
  strategies: StrategyMetrics[];
  semanticCandidateReduction?: {
    rawHistoricalCandidateTokens: number;
    tokensRequiringSemanticAfterDeterministic: number;
    reductionPercent: number;
    semanticCallsAvoided?: number;
    externalTokensAvoided?: number;
  };
  notes: string[];
}

function oracle(transcript: Transcript): Map<string, ContextDecision> {
  const items = normalizeTranscript(transcript, DEFAULT_CONFIG);
  const map = new Map<string, ContextDecision>();
  for (const evaluation of applyProtectRules(items, { ...DEFAULT_CONFIG, recentItemCount: 0 })) {
    if (SAFETY_CODES.has(evaluation.reasonCode)) {
      map.set(evaluation.itemId, evaluation);
    }
  }
  return map;
}

function retained(ids: string[], dropped: Set<string>): boolean {
  return ids.length === 0 || ids.every((id) => !dropped.has(id));
}

function idsFor(map: Map<string, ContextDecision>, code: string): string[] {
  return [...map.entries()].filter(([, evaluation]) => evaluation.reasonCode === code).map(([id]) => id);
}

async function metricsFromCompact(
  strategy: ComparisonStrategyId,
  transcript: Transcript,
  semanticProvider: SemanticProvider | undefined,
  semanticMode: "off" | "local" | "remote",
): Promise<StrategyMetrics> {
  const started = performance.now();
  const result = await compact(transcript, {
    config: { semanticMode, recentItemCount: DEFAULT_CONFIG.recentItemCount },
    ...(semanticProvider ? { semanticProvider } : {}),
  });
  const safety = oracle(transcript);
  const dropped = new Set(
    result.decisions.filter((decision) => decision.action === "DROP").map((decision) => decision.itemId),
  );
  const unsafeDropItemIds = [...safety.keys()].filter((id) => dropped.has(id));
  const historical = result.items.filter(
    (item) =>
      Boolean(item.tool) &&
      result.items.indexOf(item) < Math.max(0, result.items.length - 6),
  );
  const historicalRetained = historical
    .filter((item) => !dropped.has(item.id))
    .reduce((sum, item) => {
      const kept = result.compacted.find((entry) => entry.id === item.id);
      return sum + (kept?.tokenCount ?? item.tokenCount);
    }, 0);
  const toolRemoved = result.items
    .filter((item) => item.tool && dropped.has(item.id))
    .reduce((sum, item) => sum + item.tokenCount, 0);
  const toolCompressed = result.decisions
    .filter((decision) => decision.action === "COMPRESS")
    .reduce((sum, decision) => {
      const original = result.items.find((item) => item.id === decision.itemId);
      const kept = result.compacted.find((item) => item.id === decision.itemId);
      if (!original?.tool) {
        return sum;
      }
      return sum + Math.max(0, original.tokenCount - (kept?.tokenCount ?? 0));
    }, 0);
  const semanticCandidates = result.semantic?.candidateCount ?? 0;
  const semanticCandidateTokens =
    result.items
      .filter((item) => item.semanticEligibility === "eligible" || item.semanticEligibility === "recommended")
      .reduce((sum, item) => sum + item.tokenCount, 0) ||
    (result.semantic?.tokensSentExternally ?? 0);

  return {
    strategy,
    available: true,
    originalTokens: result.stats.originalTokens,
    effectiveTokens: result.stats.compactTokens,
    reductionPercent: result.stats.reductionPercent,
    tokensRetained: result.stats.compactTokens,
    tokensRemoved: result.stats.originalTokens - result.stats.compactTokens,
    protectedUserConstraintsRetained: retained(idsFor(safety, "USER_CONSTRAINT"), dropped),
    currentTaskRetained: retained(idsFor(safety, "CURRENT_TASK"), dropped),
    unresolvedErrorsRetained: retained(idsFor(safety, "UNRESOLVED_ERROR"), dropped),
    historicalToolTokensRetained: historicalRetained,
    toolOutputsRemoved: toolRemoved,
    toolOutputsCompressed: toolCompressed,
    unsafeDropCount: unsafeDropItemIds.length,
    unsafeDropItemIds,
    semanticCalls: result.semantic?.batchCount ?? 0,
    semanticCandidates,
    semanticCandidateTokens,
    externalTokensSent: result.semantic?.tokensSentExternally ?? 0,
    latencyMs: performance.now() - started,
    processingCostNote:
      strategy === "deterministic"
        ? "Local CPU only; no model calls."
        : "Local deterministic pass plus optional semantic provider latency/tokens.",
  };
}

function metricsFromBaseline(baseline: FastJevBaselineResult): StrategyMetrics {
  return {
    strategy: "fast-jev-style-baseline",
    available: true,
    originalTokens: baseline.originalTokens,
    effectiveTokens: baseline.effectiveTokens,
    reductionPercent:
      baseline.originalTokens === 0
        ? 0
        : ((baseline.originalTokens - baseline.effectiveTokens) / baseline.originalTokens) * 100,
    tokensRetained: baseline.tokensRetained,
    tokensRemoved: baseline.tokensRemoved,
    protectedUserConstraintsRetained: baseline.protectedUserConstraintsRetained,
    currentTaskRetained: baseline.currentTaskRetained,
    unresolvedErrorsRetained: baseline.unresolvedErrorsRetained,
    historicalToolTokensRetained: baseline.historicalToolTokensRetained,
    toolOutputsRemoved: baseline.toolOutputsRemoved,
    toolOutputsCompressed: baseline.toolOutputsCompressed,
    unsafeDropCount: baseline.unsafeDropCount,
    unsafeDropItemIds: baseline.unsafeDropItemIds,
    semanticCalls: baseline.semanticCalls,
    semanticCandidates: baseline.semanticCandidates,
    semanticCandidateTokens: baseline.semanticCandidateTokens,
    externalTokensSent: baseline.externalTokensSent,
    latencyMs: baseline.latencyMs,
    processingCostNote: baseline.scoringAvailable
      ? "Semantic scoring of all historical tool candidates (documented Fast-Jev candidate set)."
      : baseline.unavailableReasons.join(" "),
  };
}

export async function compareStrategies(
  transcript: Transcript,
  options: {
    semanticProvider?: SemanticProvider;
    observedClaudeCompaction?: boolean;
    sessionId?: string;
  } = {},
): Promise<ComparisonReport> {
  const notes: string[] = [
    "Native transcript is unmodified source context, not Claude native compaction.",
    "Fast-Jev-style baseline approximates documented behavior; it is not the upstream plugin.",
    "Do not rank strategies by reduction percent alone. unsafeDropCount is the primary safety metric.",
  ];

  const nativeStarted = performance.now();
  const items = normalizeTranscript(transcript, DEFAULT_CONFIG);
  const originalTokens = items.reduce((sum, item) => sum + item.tokenCount, 0);
  const safety = oracle(transcript);
  const native: StrategyMetrics = {
    strategy: "native-transcript",
    available: true,
    originalTokens,
    effectiveTokens: originalTokens,
    reductionPercent: 0,
    tokensRetained: originalTokens,
    tokensRemoved: 0,
    protectedUserConstraintsRetained: true,
    currentTaskRetained: true,
    unresolvedErrorsRetained: true,
    historicalToolTokensRetained: items.filter((item) => item.tool).reduce((sum, item) => sum + item.tokenCount, 0),
    toolOutputsRemoved: 0,
    toolOutputsCompressed: 0,
    unsafeDropCount: 0,
    unsafeDropItemIds: [],
    semanticCalls: 0,
    semanticCandidates: 0,
    semanticCandidateTokens: 0,
    externalTokensSent: 0,
    latencyMs: performance.now() - nativeStarted,
    processingCostNote: "No processing.",
  };

  const deterministic = await metricsFromCompact("deterministic", transcript, undefined, "off");
  const semantic = options.semanticProvider
    ? await metricsFromCompact("deterministic-semantic", transcript, options.semanticProvider, "local")
    : {
        strategy: "deterministic-semantic" as const,
        available: false,
        unavailableReason: "No semantic provider supplied; comparison marked unavailable rather than inventing scores.",
        originalTokens,
        effectiveTokens: originalTokens,
        reductionPercent: 0,
        tokensRetained: originalTokens,
        tokensRemoved: 0,
        protectedUserConstraintsRetained: retained(idsFor(safety, "USER_CONSTRAINT"), new Set()),
        currentTaskRetained: true,
        unresolvedErrorsRetained: true,
        historicalToolTokensRetained: native.historicalToolTokensRetained,
        toolOutputsRemoved: 0,
        toolOutputsCompressed: 0,
        unsafeDropCount: 0,
        unsafeDropItemIds: [],
        semanticCalls: 0,
        semanticCandidates: 0,
        semanticCandidateTokens: 0,
        externalTokensSent: 0,
        latencyMs: 0,
        processingCostNote: "Unavailable.",
      };

  const baseline = metricsFromBaseline(
    await runFastJevBaseline(transcript, {
      semanticProvider: options.semanticProvider,
      semanticMode: options.semanticProvider ? "local" : "off",
    }),
  );

  const observed: StrategyMetrics = {
    strategy: "observed-claude-compaction",
    available: options.observedClaudeCompaction === true,
    ...(options.observedClaudeCompaction
      ? {}
      : {
          unavailableReason:
            "No compact_boundary (or equivalent) observed on this transcript; not conflated with native source context.",
        }),
    originalTokens,
    effectiveTokens: originalTokens,
    reductionPercent: 0,
    tokensRetained: originalTokens,
    tokensRemoved: 0,
    protectedUserConstraintsRetained: true,
    currentTaskRetained: true,
    unresolvedErrorsRetained: true,
    historicalToolTokensRetained: native.historicalToolTokensRetained,
    toolOutputsRemoved: 0,
    toolOutputsCompressed: 0,
    unsafeDropCount: 0,
    unsafeDropItemIds: [],
    semanticCalls: 0,
    semanticCandidates: 0,
    semanticCandidateTokens: 0,
    externalTokensSent: 0,
    latencyMs: 0,
    processingCostNote: "Observation only when a compact boundary is present.",
  };

  const rawHistorical = baseline.semanticCandidateTokens;
  const afterDeterministic = semantic.available
    ? semantic.semanticCandidateTokens
    : deterministic.semanticCandidateTokens;
  const report: ComparisonReport = {
    ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    strategies: [native, deterministic, semantic, baseline, observed],
    notes,
  };
  if (rawHistorical > 0) {
    report.semanticCandidateReduction = {
      rawHistoricalCandidateTokens: rawHistorical,
      tokensRequiringSemanticAfterDeterministic: afterDeterministic,
      reductionPercent: ((rawHistorical - afterDeterministic) / rawHistorical) * 100,
      semanticCallsAvoided: Math.max(0, baseline.semanticCalls - (semantic.semanticCalls || 0)),
      externalTokensAvoided: Math.max(0, baseline.externalTokensSent - (semantic.externalTokensSent || 0)),
    };
  }
  return report;
}

export function formatComparisonReport(report: ComparisonReport): string {
  const lines = [
    "Context Engine — strategy comparison",
    "",
    "SHADOW MODE. No Claude context was modified.",
    "No winner label. unsafeDropCount is the primary metric.",
    "",
  ];
  if (report.sessionId) {
    lines.push(`Session: ${report.sessionId}`, "");
  }
  lines.push(
    [
      "Strategy".padEnd(28),
      "Original".padStart(10),
      "Effective".padStart(10),
      "Reduce%".padStart(9),
      "Unsafe".padStart(8),
      "Constraints".padStart(12),
      "Task".padStart(6),
      "Errors".padStart(8),
      "SemCand".padStart(8),
      "ExtTok".padStart(8),
    ].join(" "),
  );
  for (const row of report.strategies) {
    if (!row.available) {
      lines.push(`${row.strategy.padEnd(28)} unavailable — ${row.unavailableReason ?? ""}`);
      continue;
    }
    lines.push(
      [
        row.strategy.padEnd(28),
        String(Math.round(row.originalTokens)).padStart(10),
        String(Math.round(row.effectiveTokens)).padStart(10),
        row.reductionPercent.toFixed(1).padStart(9),
        String(row.unsafeDropCount).padStart(8),
        (row.protectedUserConstraintsRetained ? "retained" : "LOST").padStart(12),
        (row.currentTaskRetained ? "yes" : "NO").padStart(6),
        (row.unresolvedErrorsRetained ? "yes" : "NO").padStart(8),
        String(row.semanticCandidates).padStart(8),
        String(Math.round(row.externalTokensSent)).padStart(8),
      ].join(" "),
    );
  }
  if (report.semanticCandidateReduction) {
    const reduction = report.semanticCandidateReduction;
    lines.push(
      "",
      "semanticCandidateReduction",
      `  raw historical candidates: ${Math.round(reduction.rawHistoricalCandidateTokens)} tokens`,
      `  after deterministic:       ${Math.round(reduction.tokensRequiringSemanticAfterDeterministic)} tokens`,
      `  workload reduction:        ${reduction.reductionPercent.toFixed(1)}%`,
      `  semantic calls avoided:    ${reduction.semanticCallsAvoided ?? 0}`,
      `  external tokens avoided:   ${Math.round(reduction.externalTokensAvoided ?? 0)}`,
    );
  }
  lines.push("", "Notes:");
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  return lines.join("\n");
}
