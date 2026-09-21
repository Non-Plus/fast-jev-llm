import { failureKey, isToolFailure, isToolSuccess } from "../classify.js";
import { makeDecision } from "../reasons.js";
import { isAck, isConstraintMessage } from "../signals.js";
import type {
  ContextDecision,
  ContextItem,
  EngineConfig,
  PruningRule,
} from "../types.js";

function protect(
  item: ContextItem,
  rule: string,
  reasonCode: ContextDecision["reasonCode"],
  reason: string,
  authority: ContextDecision["authority"],
): ContextDecision {
  return makeDecision({
    action: "PROTECT",
    itemId: item.id,
    rule,
    reasonCode,
    reason,
    authority,
  });
}

export function systemInstructions(items: readonly ContextItem[]): ContextDecision[] {
  return items
    .filter((item) => item.kind === "message" && item.role === "system")
    .map((item) =>
      protect(
        item,
        "system-instructions",
        "SYSTEM_INSTRUCTION",
        "System messages are standing instructions",
        "safety",
      ),
    );
}

export function explicitUserConstraints(items: readonly ContextItem[]): ContextDecision[] {
  return items
    .filter(isConstraintMessage)
    .map((item) =>
      protect(
        item,
        "explicit-user-constraint",
        "USER_CONSTRAINT",
        "User message states an explicit constraint or standing instruction",
        "safety",
      ),
    );
}

export function currentTask(items: readonly ContextItem[]): ContextDecision[] {
  const userMessages = items.filter(
    (item) => item.kind === "message" && item.role === "user",
  );
  const substantive =
    [...userMessages].reverse().find((item) => !isAck(item.content)) ??
    userMessages[userMessages.length - 1];
  if (!substantive) {
    return [];
  }
  return [
    protect(
      substantive,
      "current-task",
      "CURRENT_TASK",
      "Most recent substantive user message is the current task",
      "safety",
    ),
  ];
}

export function unresolvedErrors(items: readonly ContextItem[]): ContextDecision[] {
  const latestSuccess = new Map<string, number>();
  const latestFailure = new Map<string, { item: ContextItem; index: number }>();

  items.forEach((item, index) => {
    if (!item.tool) {
      return;
    }
    const key = failureKey(
      item.tool.kind,
      item.tool.path,
      item.tool.command,
      item.tool.testTarget,
    );
    if (isToolSuccess(item.tool)) {
      latestSuccess.set(key, index);
    }
    if (isToolFailure(item.tool)) {
      latestFailure.set(key, { item, index });
    }
  });

  const decisions: ContextDecision[] = [];
  for (const [key, failure] of latestFailure) {
    const successIndex = latestSuccess.get(key);
    if (successIndex !== undefined && successIndex > failure.index) {
      continue;
    }
    decisions.push(
      protect(
        failure.item,
        "unresolved-error",
        "UNRESOLVED_ERROR",
        `Current unresolved error for "${key}"`,
        "safety",
      ),
    );
  }
  return decisions;
}

export function recentItems(
  items: readonly ContextItem[],
  config: EngineConfig,
): ContextDecision[] {
  if (config.recentItemCount <= 0 || items.length === 0) {
    return [];
  }
  const start = Math.max(0, items.length - config.recentItemCount);
  return items.slice(start).map((item, offset) =>
    protect(
      item,
      "recent-items",
      "RECENT_CONTEXT",
      `Item is within the last ${config.recentItemCount} items (offset ${offset} from window start)`,
      "heuristic",
    ),
  );
}

export const protectRules: PruningRule[] = [
  {
    name: "system-instructions",
    evaluate: (items) => systemInstructions(items),
  },
  {
    name: "explicit-user-constraint",
    evaluate: (items) => explicitUserConstraints(items),
  },
  {
    name: "current-task",
    evaluate: (items) => currentTask(items),
  },
  {
    name: "unresolved-error",
    evaluate: (items) => unresolvedErrors(items),
  },
  {
    name: "recent-items",
    evaluate: (items, config) => recentItems(items, config),
  },
];

export function applyProtectRules(
  items: readonly ContextItem[],
  config: EngineConfig,
): ContextDecision[] {
  return protectRules.flatMap((rule) => rule.evaluate(items, config));
}
