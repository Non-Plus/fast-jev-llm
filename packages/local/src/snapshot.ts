import type { ContextAction, SemanticMode } from "@fast-jev/core";
import type { AgentId, DataCompleteness, StoreReport } from "./types.js";
import { REPORT_SCHEMA_VERSION, RULESET_VERSION } from "./types.js";
import { ADAPTER_VERSIONS, CORE_VERSION, ENGINE_VERSION, semanticPolicyVersion } from "./versions.js";
import { isUnsafeDropReason, reportIdentity } from "./report-schema.js";
import { workspaceDisplayName, workspaceId } from "./workspace.js";

export interface AnalysisSnapshot {
  sessionId: string;
  agent: AgentId;
  agentVersion?: string;
  timestamp?: string;
  model?: string;
  cwd?: string;
  originalTokens: number;
  effectiveTokens: number;
  protectedVerbatimTokens: number;
  protectedCompressibleTokens: number;
  keptTokens: number;
  compressedRetainedTokens: number;
  droppedTokens: number;
  compressionSavings: number;
  dropSavings: number;
  potentialReductionPercent: number;
  reasonCodeTotals: Record<string, number>;
  semanticMode: SemanticMode;
  semanticProvider?: string;
  semanticCandidateCount?: number;
  semanticTokensSentExternally?: number;
  semanticProviderFailures?: number;
  items: ReadonlyArray<{
    kind: string;
    action: ContextAction;
    reasonCode: string;
    retention?: string;
    savedTokens: number;
    semanticAction?: string;
  }>;
  durationMs: number;
}

export function dataCompleteness(items: AnalysisSnapshot["items"]): DataCompleteness {
  const pairs = items.filter((item) => item.kind === "tool_pair").length;
  const calls = items.filter((item) => item.kind === "unpaired_tool_call").length;
  const results = items.filter((item) => item.kind === "unpaired_tool_result").length;
  if (pairs === 0 && calls === 0 && results === 0) {
    return "unknown";
  }
  if (pairs > 0 && calls === 0) {
    return "full_tool_results";
  }
  if (calls > 0 && pairs === 0 && results === 0) {
    return "tool_calls_only";
  }
  return "partial";
}

export function unsafeDropCount(items: AnalysisSnapshot["items"]): number {
  return items.filter(
    (item) => item.action === "DROP" && isUnsafeDropReason(item.reasonCode, item.retention),
  ).length;
}

export function semanticDropSavings(items: AnalysisSnapshot["items"]): number {
  return items
    .filter(
      (item) =>
        item.action === "DROP" &&
        (item.semanticAction === "DROP" || item.reasonCode === "SEMANTIC_DROP"),
    )
    .reduce((sum, item) => sum + item.savedTokens, 0);
}

export function toStoreReport(snapshot: AnalysisSnapshot): StoreReport {
  const completeness = dataCompleteness(snapshot.items);
  const semanticMode = snapshot.semanticMode;
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reportId: reportIdentity({
      agent: snapshot.agent,
      sessionId: snapshot.sessionId,
      engineVersion: ENGINE_VERSION,
      semanticMode,
    }),
    sessionId: snapshot.sessionId,
    agent: snapshot.agent,
    ...(snapshot.agentVersion !== undefined ? { agentVersion: snapshot.agentVersion } : {}),
    timestamp: snapshot.timestamp ?? new Date().toISOString(),
    workspaceId: workspaceId(snapshot.cwd),
    ...(workspaceDisplayName(snapshot.cwd)
      ? { workspaceDisplayName: workspaceDisplayName(snapshot.cwd) }
      : {}),
    ...(snapshot.model !== undefined ? { model: snapshot.model } : {}),
    dataCompleteness: completeness,
    originalTokens: snapshot.originalTokens,
    effectiveTokens: snapshot.effectiveTokens,
    protectedVerbatimTokens: snapshot.protectedVerbatimTokens,
    protectedCompressibleTokens: snapshot.protectedCompressibleTokens,
    keptTokens: snapshot.keptTokens,
    compressedRetainedTokens: snapshot.compressedRetainedTokens,
    droppedTokens: snapshot.droppedTokens,
    compressionSavings: snapshot.compressionSavings,
    dropSavings: snapshot.dropSavings,
    semanticDropSavings: semanticDropSavings(snapshot.items),
    potentialReductionPercent: snapshot.potentialReductionPercent,
    reasonCodeTotals: { ...snapshot.reasonCodeTotals },
    unsafeDropCount: unsafeDropCount(snapshot.items),
    semanticMode,
    ...(snapshot.semanticProvider !== undefined ? { semanticProvider: snapshot.semanticProvider } : {}),
    ...(snapshot.semanticCandidateCount !== undefined
      ? {
          semanticUsage: {
            candidateCount: snapshot.semanticCandidateCount,
            tokensSentExternally: snapshot.semanticTokensSentExternally ?? 0,
            providerFailures: snapshot.semanticProviderFailures ?? 0,
          },
        }
      : {}),
    analysisDurationMs: snapshot.durationMs,
    engineVersion: ENGINE_VERSION,
    coreVersion: CORE_VERSION,
    adapterVersion: ADAPTER_VERSIONS[snapshot.agent],
    rulesetVersion: RULESET_VERSION,
    semanticPolicyVersion: semanticPolicyVersion(),
  };
}
