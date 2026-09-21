import { isAck, isConstraintMessage } from "./signals.js";
import type { ContextItem, TaskState } from "./types.js";

const ACCEPTANCE_LINE_RE =
  /^\s*(acceptance(?:\s*criteria)?\s*:|(?:-\s*)?\[\s*\]\s+|must:)/i;

export function inferTaskState(items: readonly ContextItem[]): TaskState {
  const userMessages = items.filter(
    (item) => item.kind === "message" && item.role === "user",
  );
  const substantive = userMessages.filter((item) => !isAck(item.content));
  const root = substantive[0];
  const current = substantive[substantive.length - 1];
  const constraints = userMessages
    .filter(isConstraintMessage)
    .map((item) => item.content.trim());
  const acceptanceCriteria: string[] = [];
  for (const item of userMessages) {
    const fromMeta = item.metadata?.["acceptanceCriteria"];
    if (Array.isArray(fromMeta)) {
      for (const entry of fromMeta) {
        if (typeof entry === "string" && entry.trim().length > 0) {
          acceptanceCriteria.push(entry.trim());
        }
      }
    }
    for (const line of item.content.split(/\r?\n/)) {
      if (ACCEPTANCE_LINE_RE.test(line)) {
        acceptanceCriteria.push(line.trim());
      }
    }
  }

  const task: TaskState = {
    constraints,
    acceptanceCriteria,
  };
  if (root) {
    task.rootTask = root.content.trim();
  }
  if (current) {
    task.currentTask = current.content.trim();
  }
  return task;
}
