import { failureKey, isToolFailure, isToolSuccess } from "../classify.js";
import type {
  ContextDecision,
  ContextItem,
  EngineConfig,
  PruningRule,
} from "../types.js";

const CONSTRAINT_RE =
  /\b(always|never|must not|must\b|do not|don't|dont\b|constraint|under no circumstances|requirement:|important:)\b/i;

const ACK_RE =
  /^(ok(ay)?|k|thanks|thank you|yes|yep|yeah|continue|go ahead|please continue|got it|cool|sure|sounds good)[.!\s]*$/i;

function protect(
  item: ContextItem,
  rule: string,
  reason: string,
): ContextDecision {
  return {
    action: "PROTECT",
    itemId: item.id,
    rule,
    reason,
  };
}

export function systemInstructions(items: readonly ContextItem[]): ContextDecision[] {
  return items
    .filter((item) => item.kind === "message" && item.role === "system")
    .map((item) =>
      protect(item, "system-instructions", "System messages are standing instructions"),
    );
}

function isConstraintMessage(item: ContextItem): boolean {
  if (item.kind !== "message" || item.role !== "user") {
    return false;
  }
  if (item.metadata?.["constraint"] === true || item.metadata?.["protect"] === true) {
    return true;
  }
  return CONSTRAINT_RE.test(item.content);
}

export function explicitUserConstraints(items: readonly ContextItem[]): ContextDecision[] {
  return items
    .filter(isConstraintMessage)
    .map((item) =>
      protect(
        item,
        "explicit-user-constraint",
        "User message states an explicit constraint or standing instruction",
      ),
    );
}

function isAck(content: string): boolean {
  return ACK_RE.test(content.trim());
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
      "Most recent substantive user message is the current task",
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
        `Current unresolved error for "${key}"`,
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
      `Item is within the last ${config.recentItemCount} items (offset ${offset} from window start)`,
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
