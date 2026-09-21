import { analyzeClaudeSession } from "@fast-jev/adapter-claude";
import { analyzeCodexSession } from "@fast-jev/adapter-codex";
import { analyzeCursorSession } from "@fast-jev/adapter-cursor";
import { jevProviderFromEnv } from "@fast-jev/provider-jev";
import type { SemanticMode, SemanticProvider } from "@fast-jev/core";
import type { AgentId, EnginePaths, LocalConfig, StoreReport } from "./types.js";
import { loadConfig } from "./config.js";
import { writeStoreReport } from "./store.js";
import { toStoreReport, type AnalysisSnapshot } from "./snapshot.js";

function effectiveTokens(original: number, savings: number, explicit?: number): number {
  if (explicit !== undefined) {
    return explicit;
  }
  return Math.max(0, original - savings);
}

function snapshotFromUnknown(
  agent: AgentId,
  result: {
    sessionId: string;
    timestamp?: string;
    model?: string;
    cwd?: string;
    cliVersion?: string;
    cursorVersion?: string;
    claudeVersion?: string;
    originalTokens: number;
    effectiveTokens?: number;
    totalPotentialSavings?: number;
    protectedVerbatimTokens: number;
    protectedCompressibleTokens: number;
    keptTokens: number;
    compressedRetainedTokens: number;
    droppedTokens: number;
    compressionSavings: number;
    dropSavings: number;
    potentialReductionPercent: number;
    reductionByReasonCode: Record<string, number>;
    items: ReadonlyArray<{
      kind: string;
      action: "PROTECT" | "KEEP" | "COMPRESS" | "DROP";
      reasonCode: string;
      retention?: string;
      savedTokens: number;
      semanticAction?: string;
    }>;
    semantic?: {
      mode: SemanticMode;
      provider?: string;
      candidateCount: number;
      tokensSentExternally: number;
      providerFailures: number;
    };
  },
  durationMs: number,
  config: LocalConfig,
): AnalysisSnapshot {
  const agentVersion = result.cliVersion ?? result.cursorVersion ?? result.claudeVersion;
  return {
    sessionId: result.sessionId,
    agent,
    ...(agentVersion !== undefined ? { agentVersion } : {}),
    ...(result.timestamp !== undefined ? { timestamp: result.timestamp } : {}),
    ...(result.model !== undefined ? { model: result.model } : {}),
    ...(result.cwd !== undefined ? { cwd: result.cwd } : {}),
    originalTokens: result.originalTokens,
    effectiveTokens: effectiveTokens(
      result.originalTokens,
      result.totalPotentialSavings ?? result.compressionSavings + result.dropSavings,
      result.effectiveTokens,
    ),
    protectedVerbatimTokens: result.protectedVerbatimTokens,
    protectedCompressibleTokens: result.protectedCompressibleTokens,
    keptTokens: result.keptTokens,
    compressedRetainedTokens: result.compressedRetainedTokens,
    droppedTokens: result.droppedTokens,
    compressionSavings: result.compressionSavings,
    dropSavings: result.dropSavings,
    potentialReductionPercent: result.potentialReductionPercent,
    reasonCodeTotals: { ...result.reductionByReasonCode },
    semanticMode: result.semantic?.mode ?? config.semanticMode,
    ...(result.semantic?.provider !== undefined ? { semanticProvider: result.semantic.provider } : {}),
    ...(result.semantic
      ? {
          semanticCandidateCount: result.semantic.candidateCount,
          semanticTokensSentExternally: result.semantic.tokensSentExternally,
          semanticProviderFailures: result.semantic.providerFailures,
        }
      : {}),
    items: result.items.map((item) => ({
      kind: item.kind,
      action: item.action,
      reasonCode: item.reasonCode,
      ...(item.retention !== undefined ? { retention: item.retention } : {}),
      savedTokens: item.savedTokens,
      ...(item.semanticAction !== undefined ? { semanticAction: item.semanticAction } : {}),
    })),
    durationMs,
  };
}

export async function analyzeAndStore(
  paths: EnginePaths,
  agent: AgentId,
  transcriptPath: string,
  extras?: { cwd?: string; agentVersion?: string; config?: LocalConfig },
): Promise<StoreReport> {
  const loaded = extras?.config ?? (await loadConfig(paths)).config;
  let provider: SemanticProvider | undefined;
  if (loaded.semanticMode === "remote" && loaded.semanticProvider === "jev") {
    provider = jevProviderFromEnv();
  }
  const started = performance.now();
  const compactOptions = {
    reportPreviews: false,
    config: {
      semanticMode: loaded.semanticMode,
      recentItemCount: loaded.engineBudgets.recentItemCount,
      largeOutputTokens: loaded.engineBudgets.largeOutputTokens,
      reportPreviews: false,
    },
    ...(provider ? { semanticProvider: provider } : {}),
  };
  let raw;
  if (agent === "codex") {
    raw = await analyzeCodexSession({ path: transcriptPath }, { sourcePath: transcriptPath, ...compactOptions });
  } else if (agent === "cursor") {
    raw = await analyzeCursorSession(
      { path: transcriptPath },
      {
        sourcePath: transcriptPath,
        ...(extras?.cwd !== undefined ? { cwd: extras.cwd } : {}),
        ...(extras?.agentVersion !== undefined ? { cursorVersion: extras.agentVersion } : {}),
        ...compactOptions,
      },
    );
  } else {
    raw = await analyzeClaudeSession(
      { path: transcriptPath },
      {
        sourcePath: transcriptPath,
        ...(extras?.cwd !== undefined ? { cwd: extras.cwd } : {}),
        ...(extras?.agentVersion !== undefined ? { claudeVersion: extras.agentVersion } : {}),
        ...compactOptions,
      },
    );
  }
  const snapshot = snapshotFromUnknown(agent, raw, performance.now() - started, loaded);
  if (extras?.agentVersion) {
    snapshot.agentVersion = extras.agentVersion;
  }
  const report = toStoreReport(snapshot);
  await writeStoreReport(paths, report);
  return report;
}
