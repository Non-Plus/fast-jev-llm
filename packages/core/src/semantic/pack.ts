import { redactForRemote } from "./redact.js";
import type {
  ContextItem,
  ContextRelation,
  EngineConfig,
  PackedCandidate,
  PackedSemanticState,
  SemanticClassificationRequest,
  SessionState,
} from "../types.js";

const PREVIEW_CHARS = 400;

export function packSessionState(session: SessionState): PackedSemanticState {
  const modified = [
    ...new Set(
      session.items
        .filter((item) => item.tool?.kind === "file_write")
        .map((item) => item.tool?.normalizedPath ?? item.tool?.path)
        .filter((path): path is string => typeof path === "string"),
    ),
  ];
  const currentErrors = session.items
    .filter((item) => item.tool?.isError === true || (item.tool?.exitCode !== undefined && item.tool.exitCode !== 0))
    .slice(-6)
    .map((item) => {
      const label = item.tool?.command ?? item.tool?.name ?? item.id;
      const kind = item.tool?.failureKind ?? "error";
      return `${label} (${kind})`;
    });
  const recentActivity = session.items.slice(-8).map((item) => {
    if (item.tool) {
      return `${item.tool.kind}${item.tool.command ? ` ${item.tool.command}` : ""}${item.tool.path ? ` ${item.tool.path}` : ""}`;
    }
    return `${item.role ?? item.kind}: ${item.content.slice(0, 80)}`;
  });
  const architecturalFacts = [
    ...session.task.constraints.slice(0, 8),
    ...modified.map((path) => `modified ${path}`),
  ];
  return {
    ...(session.task.currentTask !== undefined ? { currentTask: session.task.currentTask } : {}),
    userConstraints: [...session.task.constraints],
    currentErrors,
    modifiedFiles: modified,
    recentActivity,
    architecturalFacts,
  };
}

export function packCandidate(
  item: ContextItem,
  index: number,
  total: number,
  relations: readonly ContextRelation[],
  options?: { redact?: boolean },
): { candidate: PackedCandidate; redactionsApplied: number } {
  const raw = item.content.length > PREVIEW_CHARS ? `${item.content.slice(0, PREVIEW_CHARS)}…` : item.content;
  const redacted = options?.redact ? redactForRemote(raw) : { text: raw, redactionsApplied: 0 };
  return {
    candidate: {
      itemId: item.id,
      kind: item.kind,
      ...(item.origin !== undefined ? { origin: item.origin } : {}),
      ...(item.importance !== undefined ? { importance: item.importance } : {}),
      ...(item.tool?.kind !== undefined ? { toolKind: item.tool.kind } : {}),
      ...(item.tool?.command !== undefined ? { command: item.tool.command } : {}),
      ...(item.tool?.path !== undefined
        ? { path: item.tool.path }
        : item.tool?.normalizedPath !== undefined
          ? { path: item.tool.normalizedPath }
          : {}),
      order: index,
      ageFromEnd: total - 1 - index,
      tokenCount: item.tokenCount,
      relationships: relations.filter((relation) => relation.fromId === item.id || relation.toId === item.id),
      contentPreview: redacted.text,
      ...(item.normalizedContentHash !== undefined
        ? { normalizedContentHash: item.normalizedContentHash }
        : {}),
    },
    redactionsApplied: redacted.redactionsApplied,
  };
}

export function packClassificationRequest(
  session: SessionState,
  candidates: readonly ContextItem[],
  config: EngineConfig,
  itemIndex: ReadonlyMap<string, number>,
): { request: SemanticClassificationRequest; redactionsApplied: number } {
  const redact = config.semanticMode === "remote";
  let redactionsApplied = 0;
  const packedCandidates: PackedCandidate[] = [];
  for (const item of candidates) {
    const index = itemIndex.get(item.id) ?? 0;
    const packed = packCandidate(item, index, session.items.length, session.relations, { redact });
    redactionsApplied += packed.redactionsApplied;
    packedCandidates.push(packed.candidate);
  }
  const packedState = packSessionState(session);
  if (redact) {
    const task = packedState.currentTask ? redactForRemote(packedState.currentTask) : undefined;
    redactionsApplied += task?.redactionsApplied ?? 0;
    packedState.currentTask = task?.text ?? packedState.currentTask;
    packedState.userConstraints = packedState.userConstraints.map((entry) => {
      const result = redactForRemote(entry);
      redactionsApplied += result.redactionsApplied;
      return result.text;
    });
  }
  return {
    request: {
      sessionId: session.sessionId,
      packedState,
      candidates: packedCandidates,
      tokenBudget: packedCandidates.reduce((sum, candidate) => sum + candidate.tokenCount, 0),
      policyVersion: config.semanticPolicy.policyVersion,
    },
    redactionsApplied,
  };
}

export function semanticStateHashSource(state: PackedSemanticState, policyVersion: string): string {
  return JSON.stringify({
    policyVersion,
    currentTask: state.currentTask ?? "",
    userConstraints: state.userConstraints,
    currentErrors: state.currentErrors,
    modifiedFiles: state.modifiedFiles,
  });
}
