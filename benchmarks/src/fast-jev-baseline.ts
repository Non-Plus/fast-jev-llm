import {
  DEFAULT_CONFIG,
  applyProtectRules,
  estimateTokens,
  normalizeTranscript,
  type ContextAction,
  type ContextDecision,
  type ContextItem,
  type SemanticClassificationRequest,
  type SemanticProvider,
  type Transcript,
} from "@fast-jev/core";

/**
 * Independent comparison model of documented fast-jev-compaction behavior.
 *
 * This is not a port of https://github.com/tamaratran/fast-jev-compaction
 * and must not be treated as equivalent to that plugin or to Claude native
 * compaction.
 *
 * Documented algorithm (README / plugin docs — not source):
 * - pair tool_use with tool_result
 * - pin the first message and the last `preserveRecentMessages` (default 6)
 * - only historical tool calls/results are pruning candidates
 * - user/assistant text is never dropped
 * - Jev answers keepCall / keepResult with keepThreshold 0.5
 * - keep result → keep pair; keep call only → truncate result; else drop pair
 * - truncateHeadChars default 300
 *
 * Interpretation used here because we cannot reproduce two noul questions
 * without copying internals:
 * - Semantic KEEP → keepCall+keepResult
 * - Semantic COMPRESS → keepCall, truncate result
 * - Semantic DROP or relevanceScore < keepThreshold → drop pair
 *
 * Aspects we refuse to invent: Claude built-in summary fallback,
 * minReductionRatio 0.25 recovery, maxStateTokens packing, exact Jev prompts.
 */
export interface FastJevBaselineOptions {
  preserveRecentMessages?: number;
  keepThreshold?: number;
  truncateHeadChars?: number;
  pinFirstMessage?: boolean;
  semanticProvider?: SemanticProvider;
  semanticMode?: "off" | "local" | "remote";
}

export interface FastJevBaselineResult {
  strategy: "fast-jev-style-baseline";
  items: ContextItem[];
  decisions: ContextDecision[];
  originalTokens: number;
  effectiveTokens: number;
  tokensRetained: number;
  tokensRemoved: number;
  toolOutputsRemoved: number;
  toolOutputsCompressed: number;
  historicalToolTokens: number;
  historicalToolTokensRetained: number;
  semanticCalls: number;
  semanticCandidates: number;
  semanticCandidateTokens: number;
  externalTokensSent: number;
  latencyMs: number;
  scoringAvailable: boolean;
  unavailableReasons: string[];
  unsafeDropCount: number;
  unsafeDropItemIds: string[];
  protectedUserConstraintsRetained: boolean;
  currentTaskRetained: boolean;
  unresolvedErrorsRetained: boolean;
}

const SAFETY_CODES = new Set([
  "USER_CONSTRAINT",
  "CURRENT_TASK",
  "UNRESOLVED_ERROR",
  "SYSTEM_INSTRUCTION",
]);

function toolItem(item: ContextItem): boolean {
  return item.kind === "tool_pair" || item.kind === "unpaired_tool_call" || item.kind === "unpaired_tool_result";
}

function pinMessageIds(transcript: Transcript, preserveRecent: number, pinFirst: boolean): Set<string> {
  const ids = transcript.messages.map((message) => message.id);
  const pinned = new Set<string>();
  if (pinFirst && ids[0]) {
    pinned.add(ids[0]);
  }
  for (const id of ids.slice(-preserveRecent)) {
    pinned.add(id);
  }
  return pinned;
}

function decision(
  itemId: string,
  action: ContextAction,
  rule: string,
  reasonCode: ContextDecision["reasonCode"],
  reason: string,
): ContextDecision {
  return {
    itemId,
    action,
    rule,
    reasonCode,
    reason,
    authority: action === "DROP" || action === "COMPRESS" ? "semantic" : "heuristic",
    retention: "normal",
    compression: action === "COMPRESS" ? "allowed" : "allowed",
  };
}

function safetyOracle(items: readonly ContextItem[]): Map<string, ContextDecision> {
  const config = { ...DEFAULT_CONFIG, recentItemCount: 0 };
  const map = new Map<string, ContextDecision>();
  for (const evaluation of applyProtectRules(items, config)) {
    if (SAFETY_CODES.has(evaluation.reasonCode)) {
      map.set(evaluation.itemId, evaluation);
    }
  }
  return map;
}

function truncateToolContent(item: ContextItem, chars: number): ContextItem {
  const result = item.tool?.result ?? item.content;
  const truncated = result.length > chars ? `${result.slice(0, chars)}…` : result;
  const content = item.tool
    ? `${item.tool.name}\n${truncated}`
    : truncated;
  return {
    ...item,
    content,
    tokenCount: estimateTokens(content),
    ...(item.tool ? { tool: { ...item.tool, result: truncated } } : {}),
  };
}

export async function runFastJevBaseline(
  transcript: Transcript,
  options: FastJevBaselineOptions = {},
): Promise<FastJevBaselineResult> {
  const preserveRecent = options.preserveRecentMessages ?? 6;
  const keepThreshold = options.keepThreshold ?? 0.5;
  const truncateHeadChars = options.truncateHeadChars ?? 300;
  const pinFirst = options.pinFirstMessage ?? true;
  const started = performance.now();
  const unavailableReasons: string[] = [];

  const items = normalizeTranscript(transcript, DEFAULT_CONFIG);
  const pinnedMessages = pinMessageIds(transcript, preserveRecent, pinFirst);
  const pinned = new Set<string>();
  for (const item of items) {
    if (item.kind === "message") {
      pinned.add(item.id);
      continue;
    }
    if (item.messageIds.some((id) => pinnedMessages.has(id))) {
      pinned.add(item.id);
    }
  }

  const candidates = items.filter((item) => toolItem(item) && !pinned.has(item.id));
  const historicalToolTokens = candidates.reduce((sum, item) => sum + item.tokenCount, 0);
  const oracle = safetyOracle(items);

  const decisions = new Map<string, ContextDecision>();
  const materialized = new Map<string, ContextItem>();
  for (const item of items) {
    materialized.set(item.id, item);
    if (pinned.has(item.id)) {
      decisions.set(
        item.id,
        decision(
          item.id,
          "KEEP",
          "fast-jev-pin",
          "RECENT_CONTEXT",
          "Pinned by documented first-message / recent-message / never-drop-text rules",
        ),
      );
    }
  }

  let semanticCalls = 0;
  let externalTokensSent = 0;
  let scoringAvailable = false;

  const provider = options.semanticProvider;
  if (!provider || (options.semanticMode ?? "off") === "off") {
    unavailableReasons.push(
      "Semantic keepCall/keepResult scoring unavailable without an explicit provider; candidates kept rather than invented.",
    );
    for (const item of candidates) {
      decisions.set(
        item.id,
        decision(
          item.id,
          "KEEP",
          "fast-jev-unscored",
          "SEMANTIC_PROVIDER_FAILURE",
          "Baseline scoring unavailable; refusing to invent keep/drop scores",
        ),
      );
    }
  } else {
    scoringAvailable = true;
    const request: SemanticClassificationRequest = {
      sessionId: transcript.sessionId ?? "fast-jev-baseline",
      packedState: {
        userConstraints: [],
        currentErrors: [],
        modifiedFiles: [],
        recentActivity: [],
        architecturalFacts: [],
      },
      candidates: candidates.map((item, index) => ({
        itemId: item.id,
        kind: item.kind,
        ...(item.tool?.kind !== undefined ? { toolKind: item.tool.kind } : {}),
        ...(item.tool?.command !== undefined ? { command: item.tool.command } : {}),
        ...(item.tool?.path !== undefined ? { path: item.tool.path } : {}),
        order: index,
        ageFromEnd: candidates.length - 1 - index,
        tokenCount: item.tokenCount,
        relationships: [],
        contentPreview: item.content.slice(0, 400),
      })),
      tokenBudget: 30_000,
      policyVersion: "fast-jev-baseline-approx-1",
    };
    try {
      const classified = await provider.classify(request);
      semanticCalls = classified.usage?.requests ?? 1;
      externalTokensSent = estimateTokens(JSON.stringify(request));
      const byId = new Map(classified.decisions.map((entry) => [entry.itemId, entry]));
      for (const item of candidates) {
        const scored = byId.get(item.id);
        if (!scored) {
          decisions.set(
            item.id,
            decision(
              item.id,
              "KEEP",
              "fast-jev-missing-score",
              "SEMANTIC_PROVIDER_FAILURE",
              "Provider omitted this candidate; fail-open keep",
            ),
          );
          continue;
        }
        if (scored.action === "DROP" || scored.relevanceScore < keepThreshold) {
          decisions.set(
            item.id,
            decision(
              item.id,
              "DROP",
              "fast-jev-drop",
              "SEMANTIC_DROP",
              `Interpreted keepResult=false (score ${scored.relevanceScore.toFixed(2)} / action ${scored.action})`,
            ),
          );
          continue;
        }
        if (scored.action === "COMPRESS") {
          const truncated = truncateToolContent(item, truncateHeadChars);
          materialized.set(item.id, truncated);
          decisions.set(
            item.id,
            decision(
              item.id,
              "COMPRESS",
              "fast-jev-truncate",
              "SEMANTIC_COMPRESS",
              `Interpreted keepCall=true keepResult=false; truncated to ${truncateHeadChars} chars`,
            ),
          );
          continue;
        }
        decisions.set(
          item.id,
          decision(
            item.id,
            "KEEP",
            "fast-jev-keep",
            "SEMANTIC_KEEP",
            "Interpreted keepCall=true keepResult=true",
          ),
        );
      }
    } catch (error) {
      scoringAvailable = false;
      unavailableReasons.push(
        `Provider failed (${error instanceof Error ? error.message : "unknown"}); Claude built-in summary fallback is not reproduced.`,
      );
      for (const item of candidates) {
        decisions.set(
          item.id,
          decision(
            item.id,
            "KEEP",
            "fast-jev-fallback-unavailable",
            "SEMANTIC_PROVIDER_FAILURE",
            "Failure fallback to Claude native compact is unavailable in this harness",
          ),
        );
      }
    }
  }

  const decisionList = items.map((item) => decisions.get(item.id) ?? decision(item.id, "KEEP", "fast-jev-keep", "DEFAULT_KEEP", "Default keep"));
  const originalTokens = items.reduce((sum, item) => sum + item.tokenCount, 0);
  let effectiveTokens = 0;
  let tokensRemoved = 0;
  let toolOutputsRemoved = 0;
  let toolOutputsCompressed = 0;
  let historicalToolTokensRetained = 0;
  const unsafeDropItemIds: string[] = [];

  for (const item of items) {
    const chosen = decisions.get(item.id);
    const action = chosen?.action ?? "KEEP";
    if (action === "DROP") {
      tokensRemoved += item.tokenCount;
      if (toolItem(item)) {
        toolOutputsRemoved += item.tokenCount;
      }
      if (oracle.has(item.id)) {
        unsafeDropItemIds.push(item.id);
      }
      continue;
    }
    const kept = materialized.get(item.id) ?? item;
    effectiveTokens += kept.tokenCount;
    if (action === "COMPRESS") {
      tokensRemoved += Math.max(0, item.tokenCount - kept.tokenCount);
      if (toolItem(item)) {
        toolOutputsCompressed += Math.max(0, item.tokenCount - kept.tokenCount);
      }
    }
    if (candidates.some((candidate) => candidate.id === item.id)) {
      historicalToolTokensRetained += kept.tokenCount;
    }
  }

  const constraintIds = [...oracle.entries()]
    .filter(([, evaluation]) => evaluation.reasonCode === "USER_CONSTRAINT")
    .map(([id]) => id);
  const taskIds = [...oracle.entries()]
    .filter(([, evaluation]) => evaluation.reasonCode === "CURRENT_TASK")
    .map(([id]) => id);
  const errorIds = [...oracle.entries()]
    .filter(([, evaluation]) => evaluation.reasonCode === "UNRESOLVED_ERROR")
    .map(([id]) => id);

  const retained = (ids: string[]) =>
    ids.length === 0 || ids.every((id) => (decisions.get(id)?.action ?? "KEEP") !== "DROP");

  return {
    strategy: "fast-jev-style-baseline",
    items,
    decisions: decisionList,
    originalTokens,
    effectiveTokens,
    tokensRetained: effectiveTokens,
    tokensRemoved,
    toolOutputsRemoved,
    toolOutputsCompressed,
    historicalToolTokens,
    historicalToolTokensRetained,
    semanticCalls,
    semanticCandidates: candidates.length,
    semanticCandidateTokens: historicalToolTokens,
    externalTokensSent,
    latencyMs: performance.now() - started,
    scoringAvailable,
    unavailableReasons,
    unsafeDropCount: unsafeDropItemIds.length,
    unsafeDropItemIds,
    protectedUserConstraintsRetained: retained(constraintIds),
    currentTaskRetained: retained(taskIds),
    unresolvedErrorsRetained: retained(errorIds),
  };
}
