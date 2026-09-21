import {
  compact,
  type CompactOptions,
  type CompactionResult,
  type ContextAction,
  type ContextDecision,
  type ContextItem,
  type ContextRelation,
  type ItemDecisionRecord,
} from "@fast-jev/core";
import { parseCursorJsonl } from "./parser.js";
import type {
  AnalyzeCursorSessionOptions,
  CursorParseResult,
  CursorTranscriptInput,
  ShadowAnalysisResult,
  ShadowItemSummary,
  ShadowJsonDocument,
  ShadowStatistics,
} from "./types.js";

const DEFAULT_PREVIEW_LENGTH = 200;

export function previewText(text: string, maxLength = DEFAULT_PREVIEW_LENGTH): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function countBy(keys: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of keys) {
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function supersededByMap(relations: readonly ContextRelation[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const relation of relations) {
    if (relation.type === "supersedes" || relation.type === "invalidates") {
      if (!map.has(relation.toId)) {
        map.set(relation.toId, relation.fromId);
      }
    }
  }
  return map;
}

function supersedesMap(relations: readonly ContextRelation[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const relation of relations) {
    if (relation.type === "supersedes" || relation.type === "invalidates") {
      if (!map.has(relation.fromId)) {
        map.set(relation.fromId, relation.toId);
      }
    }
  }
  return map;
}

function relationshipLines(itemId: string, relations: readonly ContextRelation[]): string[] {
  return relations
    .filter((relation) => relation.fromId === itemId || relation.toId === itemId)
    .map((relation) => {
      if (relation.fromId === itemId) {
        return `${relation.type} ${relation.toId} (${relation.rule})`;
      }
      return `${relation.fromId} ${relation.type} this (${relation.rule})`;
    });
}

function explainNarrative(decision: ContextDecision, record: ItemDecisionRecord | undefined): string {
  const evaluations = record?.evaluations ?? [];
  const parts: string[] = [];
  const recent = evaluations.some((evaluation) => evaluation.reasonCode === "RECENT_CONTEXT");
  if (decision.retention === "protected" && decision.action === "COMPRESS") {
    if (recent) {
      parts.push("This item was recent, so it could not be dropped.");
    } else {
      parts.push("This item is retention-protected, so it could not be dropped.");
    }
    if (decision.reasonCode === "LARGE_BUILD_OUTPUT") {
      parts.push("Structured build compression was still permitted.");
    } else if (decision.reasonCode === "LARGE_TEST_OUTPUT") {
      parts.push("Structured test compression was still permitted.");
    } else if (decision.reasonCode === "LARGE_GIT_DIFF") {
      parts.push("Structured git-diff compression was still permitted.");
    } else if (decision.reasonCode === "LARGE_DIRECTORY_LISTING") {
      parts.push("Structured directory-listing compression was still permitted.");
    } else {
      parts.push("Deterministic compression was still permitted.");
    }
  } else if (decision.retention === "protected" && decision.compression === "forbidden") {
    parts.push("Retention is protected and compression is forbidden, so the item is kept verbatim.");
  } else if (decision.action === "DROP") {
    parts.push("A later equivalent item superseded this output.");
  }
  return parts.join(" ");
}

function summarizeItem(
  item: ContextItem,
  decision: ContextDecision,
  compactedById: Map<string, ContextItem>,
  supersededBy: Map<string, string>,
  supersedes: Map<string, string>,
  relations: readonly ContextRelation[],
  record: ItemDecisionRecord | undefined,
  options: { reportPreviews: boolean; previewLength: number },
  deterministic?: ContextDecision,
): ShadowItemSummary {
  const superseded = supersededBy.get(item.id);
  const newer = supersedes.get(item.id);
  const compacted = compactedById.get(item.id);
  const originalTokens = item.tokenCount;
  const retainedTokens =
    decision.action === "DROP" ? 0 : (compacted?.tokenCount ?? originalTokens);
  const savedTokens = Math.max(0, originalTokens - retainedTokens);
  const summary: ShadowItemSummary = {
    itemId: item.id,
    kind: item.kind,
    action: decision.action,
    reasonCode: decision.reasonCode,
    reason: decision.reason,
    rule: decision.rule,
    authority: decision.authority,
    retention: decision.retention,
    compression: decision.compression,
    tokens: originalTokens,
    originalTokens,
    retainedTokens,
    savedTokens,
    relationships: relationshipLines(item.id, relations),
    messageIds: item.messageIds,
  };
  const importance = decision.importance ?? item.importance;
  if (importance) {
    summary.importance = importance;
  }
  if (item.origin) {
    summary.origin = item.origin;
  }
  if (item.tool?.name !== undefined) {
    summary.toolName = item.tool.name;
  }
  if (item.tool?.command !== undefined) {
    summary.command = item.tool.command;
  }
  if (item.tool?.callId !== undefined) {
    summary.callId = item.tool.callId;
  }
  if (options.reportPreviews) {
    summary.preview = previewText(item.content, options.previewLength);
  }
  if (superseded !== undefined) {
    summary.supersededBy = superseded;
  }
  if (newer !== undefined) {
    summary.supersedes = newer;
  }
  const narrative = explainNarrative(decision, record);
  if (narrative.length > 0) {
    summary.narrative = narrative;
  }
  const eligibility = decision.semanticEligibility ?? item.semanticEligibility;
  if (eligibility) {
    summary.semanticEligibility = eligibility;
  }
  if (deterministic) {
    summary.deterministicAction = deterministic.action;
  }
  if (decision.relevanceScore !== undefined) {
    summary.relevanceScore = decision.relevanceScore;
  }
  if (decision.confidence !== undefined) {
    summary.confidence = decision.confidence;
  }
  if (decision.provider) {
    summary.provider = decision.provider;
  }
  const semanticEval = record?.evaluations.find((evaluation) => evaluation.authority === "semantic");
  if (
    semanticEval &&
    (semanticEval.action === "KEEP" || semanticEval.action === "COMPRESS" || semanticEval.action === "DROP")
  ) {
    summary.semanticAction = semanticEval.action;
  }
  return summary;
}

function originalTokensForAction(
  items: readonly ContextItem[],
  decisions: readonly ContextDecision[],
  action: ContextAction,
): number {
  const byId = new Map(items.map((item) => [item.id, item]));
  let total = 0;
  for (const decision of decisions) {
    if (decision.action !== action) {
      continue;
    }
    total += byId.get(decision.itemId)?.tokenCount ?? 0;
  }
  return total;
}

export function toShadowStatistics(result: CompactionResult): ShadowStatistics {
  return toShadowStatisticsFrom(result.items, result.decisions, result.stats);
}

function toShadowStatisticsFrom(
  items: readonly ContextItem[],
  decisions: readonly ContextDecision[],
  stats: CompactionResult["stats"],
): ShadowStatistics {
  return {
    originalTokens: stats.originalTokens,
    effectiveTokens: stats.compactTokens,
    protectedTokens: stats.protectedTokens,
    protectedVerbatimTokens: stats.protectedVerbatimTokens,
    protectedCompressibleTokens: stats.protectedCompressibleTokens,
    retentionProtectedTokens: stats.retentionProtectedTokens,
    keptTokens: stats.keptTokens,
    compressedTokens: originalTokensForAction(items, decisions, "COMPRESS"),
    compressedRetainedTokens: stats.compressedTokens,
    droppedTokens: stats.droppedTokens,
    compressionSavings: stats.compressionSavings,
    dropSavings: stats.dropSavings,
    totalPotentialSavings: stats.totalPotentialSavings,
    potentialReductionPercent: stats.reductionPercent,
    itemCount: stats.originalItems,
    protectedItems: stats.protectedCount,
    keptItems: stats.keptCount,
    compressedItems: stats.compressedCount,
    droppedItems: stats.droppedCount,
  };
}

function previewOptions(options?: AnalyzeCursorSessionOptions): {
  reportPreviews: boolean;
  previewLength: number;
} {
  const reportPreviews = options?.reportPreviews ?? options?.config?.reportPreviews ?? true;
  const previewLength =
    options?.previewLength ??
    options?.previewMaxChars ??
    options?.config?.previewMaxChars ??
    DEFAULT_PREVIEW_LENGTH;
  return { reportPreviews, previewLength };
}

export function toShadowResult(
  parsed: CursorParseResult,
  compacted: CompactionResult,
  options?: AnalyzeCursorSessionOptions,
): ShadowAnalysisResult {
  const preview = previewOptions(options);
  const superseded = supersededByMap(compacted.relations);
  const supersedes = supersedesMap(compacted.relations);
  const decisionById = new Map(compacted.decisions.map((decision) => [decision.itemId, decision]));
  const compactedById = new Map(compacted.compacted.map((item) => [item.id, item]));
  const recordsById = new Map(compacted.decisionRecords.map((record) => [record.itemId, record]));
  const deterministicById = new Map(
    compacted.deterministicDecisions.map((decision) => [decision.itemId, decision]),
  );
  const statistics = toShadowStatistics(compacted);
  const deterministicStats = toShadowStatisticsFrom(
    compacted.items,
    compacted.deterministicDecisions,
    compacted.deterministicStats,
  );
  const items = compacted.items.flatMap((item) => {
    const decision = decisionById.get(item.id);
    if (!decision) {
      return [];
    }
    return [
      summarizeItem(
        item,
        decision,
        compactedById,
        superseded,
        supersedes,
        compacted.relations,
        recordsById.get(item.id),
        preview,
        deterministicById.get(item.id),
      ),
    ];
  });

  return {
    sessionId: compacted.sessionId,
    source: "cursor",
    ...(parsed.meta.timestamp !== undefined ? { timestamp: parsed.meta.timestamp } : {}),
    ...(parsed.meta.model !== undefined ? { model: parsed.meta.model } : {}),
    ...(parsed.meta.cwd !== undefined ? { cwd: parsed.meta.cwd } : {}),
    ...(parsed.meta.cursorVersion !== undefined ? { cursorVersion: parsed.meta.cursorVersion } : {}),
    originalTokens: statistics.originalTokens,
    effectiveTokens: statistics.effectiveTokens,
    protectedTokens: statistics.protectedTokens,
    protectedVerbatimTokens: statistics.protectedVerbatimTokens,
    protectedCompressibleTokens: statistics.protectedCompressibleTokens,
    retentionProtectedTokens: statistics.retentionProtectedTokens,
    keptTokens: statistics.keptTokens,
    compressedTokens: statistics.compressedTokens,
    compressedRetainedTokens: statistics.compressedRetainedTokens,
    droppedTokens: statistics.droppedTokens,
    compressionSavings: statistics.compressionSavings,
    dropSavings: statistics.dropSavings,
    totalPotentialSavings: statistics.totalPotentialSavings,
    potentialReductionPercent: statistics.potentialReductionPercent,
    itemCount: statistics.itemCount,
    protectedItems: statistics.protectedItems,
    keptItems: statistics.keptItems,
    compressedItems: statistics.compressedItems,
    droppedItems: statistics.droppedItems,
    reductionByReasonCode: { ...compacted.stats.reductionByReasonCode },
    ruleEvaluationCounts: countBy(compacted.evaluations.map((evaluation) => evaluation.rule)),
    decisions: compacted.decisions,
    decisionTrace: compacted.decisionRecords,
    relationships: compacted.relations,
    items,
    parserWarnings: parsed.warnings,
    unknownEvents: parsed.unknownEvents,
    reportPreviews: preview.reportPreviews,
    previewMaxChars: preview.previewLength,
    deterministicStats,
    ...(compacted.semantic ? { semantic: compacted.semantic } : {}),
  };
}

export function toShadowJsonDocument(
  result: ShadowAnalysisResult,
  sourcePath?: string,
): ShadowJsonDocument {
  const items = result.reportPreviews
    ? result.items
    : result.items.map((item) => {
        const { preview: _preview, ...rest } = item;
        return rest;
      });
  return {
    metadata: {
      sessionId: result.sessionId,
      source: "cursor",
      mode: "shadow",
      localOnly: !(result.semantic && result.semantic.mode === "remote" && result.semantic.charactersSentExternally > 0),
      ...(result.timestamp !== undefined ? { timestamp: result.timestamp } : {}),
      ...(result.model !== undefined ? { model: result.model } : {}),
      ...(result.cwd !== undefined ? { cwd: result.cwd } : {}),
      ...(result.cursorVersion !== undefined ? { cursorVersion: result.cursorVersion } : {}),
      ...(sourcePath !== undefined ? { sourcePath } : {}),
      reportPreviews: result.reportPreviews,
      previewMaxChars: result.previewMaxChars,
      ...(result.semantic ? { semanticMode: result.semantic.mode } : {}),
    },
    statistics: {
      originalTokens: result.originalTokens,
      effectiveTokens: result.effectiveTokens,
      protectedTokens: result.protectedTokens,
      protectedVerbatimTokens: result.protectedVerbatimTokens,
      protectedCompressibleTokens: result.protectedCompressibleTokens,
      retentionProtectedTokens: result.retentionProtectedTokens,
      keptTokens: result.keptTokens,
      compressedTokens: result.compressedTokens,
      compressedRetainedTokens: result.compressedRetainedTokens,
      droppedTokens: result.droppedTokens,
      compressionSavings: result.compressionSavings,
      dropSavings: result.dropSavings,
      totalPotentialSavings: result.totalPotentialSavings,
      potentialReductionPercent: result.potentialReductionPercent,
      itemCount: result.itemCount,
      protectedItems: result.protectedItems,
      keptItems: result.keptItems,
      compressedItems: result.compressedItems,
      droppedItems: result.droppedItems,
    },
    ...(result.deterministicStats ? { deterministicStatistics: result.deterministicStats } : {}),
    ...(result.semantic ? { semantic: result.semantic } : {}),
    decisions: result.decisions,
    decisionTrace: result.decisionTrace,
    relationships: result.relationships,
    items,
    parser: {
      warnings: result.parserWarnings,
      unknownEvents: result.unknownEvents,
    },
  };
}

/**
 * Observe a Cursor transcript and run the provider-independent engine against
 * a canonical copy. The source transcript is never written, patched, or mutated.
 */
export async function analyzeCursorSession(
  input: CursorTranscriptInput,
  options?: AnalyzeCursorSessionOptions,
): Promise<ShadowAnalysisResult> {
  const compactOptions: CompactOptions = {};
  if (options?.config) {
    compactOptions.config = options.config;
  }
  if (options?.semanticProvider) {
    compactOptions.semanticProvider = options.semanticProvider;
  }
  if (options?.reportPreviews !== undefined || options?.previewMaxChars !== undefined) {
    compactOptions.config = {
      ...compactOptions.config,
      ...(options.reportPreviews !== undefined ? { reportPreviews: options.reportPreviews } : {}),
      ...(options.previewMaxChars !== undefined ? { previewMaxChars: options.previewMaxChars } : {}),
      ...(options.previewLength !== undefined ? { previewMaxChars: options.previewLength } : {}),
    };
  }
  const parsed = await parseCursorJsonl(input, {
    ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options?.cursorVersion !== undefined ? { cursorVersion: options.cursorVersion } : {}),
    ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    ...(options?.sourcePath !== undefined ? { sourcePath: options.sourcePath } : {}),
  });
  const compacted = await compact(parsed.transcript, compactOptions);
  return toShadowResult(parsed, compacted, options);
}
