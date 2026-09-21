import { failureKey, isToolFailure, isToolSuccess } from "./classify.js";
import { itemLooksLikeSafetyInstruction } from "./origin.js";
import { isAck, isConstraintMessage } from "./signals.js";
import type { ContextItem, Importance } from "./types.js";

const IMPORTANCE_RANK: Record<Importance, number> = {
  EPHEMERAL: 0,
  NORMAL: 1,
  IMPORTANT: 2,
  CRITICAL: 3,
};

export function maxImportance(a?: Importance, b?: Importance): Importance | undefined {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return IMPORTANCE_RANK[a] >= IMPORTANCE_RANK[b] ? a : b;
}

export function classifyItemImportance(
  item: ContextItem,
  options?: { currentTaskId?: string; unresolvedErrorIds?: ReadonlySet<string> },
): Importance {
  if (isConstraintMessage(item) || options?.currentTaskId === item.id) {
    return "CRITICAL";
  }
  if (itemLooksLikeSafetyInstruction(item)) {
    return "CRITICAL";
  }
  if (item.origin === "unknown" && item.kind === "message") {
    return "IMPORTANT";
  }
  if (options?.unresolvedErrorIds?.has(item.id)) {
    return "IMPORTANT";
  }
  if (item.tool?.kind === "directory_list" || item.tool?.kind === "git_status") {
    return "EPHEMERAL";
  }
  if (item.tool?.kind === "git_diff") {
    return "EPHEMERAL";
  }
  return "NORMAL";
}

function currentTaskId(items: readonly ContextItem[]): string | undefined {
  const userMessages = items.filter((item) => item.kind === "message" && item.role === "user");
  const substantive =
    [...userMessages].reverse().find((item) => !isAck(item.content)) ??
    userMessages[userMessages.length - 1];
  return substantive?.id;
}

function unresolvedErrorIds(items: readonly ContextItem[]): Set<string> {
  const latestSuccess = new Map<string, number>();
  const latestFailure = new Map<string, { id: string; index: number }>();
  items.forEach((item, index) => {
    if (!item.tool) {
      return;
    }
    const key = failureKey(item.tool.kind, item.tool.path, item.tool.command, item.tool.testTarget);
    if (isToolSuccess(item.tool)) {
      latestSuccess.set(key, index);
    }
    if (isToolFailure(item.tool)) {
      latestFailure.set(key, { id: item.id, index });
    }
  });
  const ids = new Set<string>();
  for (const [key, failure] of latestFailure) {
    const successIndex = latestSuccess.get(key);
    if (successIndex !== undefined && successIndex > failure.index) {
      continue;
    }
    ids.add(failure.id);
  }
  return ids;
}

/**
 * Annotate deterministic importance. Importance influences rule reporting
 * and later heuristic weighting; it never itself deletes an item.
 */
export function annotateImportance(items: ContextItem[]): void {
  const taskId = currentTaskId(items);
  const unresolved = unresolvedErrorIds(items);
  for (const item of items) {
    item.importance = classifyItemImportance(item, {
      ...(taskId !== undefined ? { currentTaskId: taskId } : {}),
      unresolvedErrorIds: unresolved,
    });
  }
  const latestGitDiff = [...items].reverse().find((item) => item.tool?.kind === "git_diff");
  if (latestGitDiff) {
    latestGitDiff.importance = maxImportance(latestGitDiff.importance, "IMPORTANT") ?? "IMPORTANT";
  }
}
