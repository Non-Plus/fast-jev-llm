import { budgetForKind } from "../budgets.js";
import { looksSensitive } from "./sensitive.js";
import type {
  ContextDecision,
  ContextItem,
  EngineConfig,
  ReasonCode,
  SemanticEligibility,
  SessionState,
} from "../types.js";

const EXPLORATORY_RE =
  /\b(web__run|curl |wget |http:\/\/|https:\/\/|search_query|grep |rg |find \.)\b/i;
const DEBUG_RE = /\b(debug|stack trace|console\.log|traceback|panic:|exception)\b/i;

export interface EligibilityInput {
  item: ContextItem;
  index: number;
  total: number;
  deterministic?: ContextDecision;
  evaluations: readonly ContextDecision[];
  config: EngineConfig;
  session?: SessionState;
}

export function classifySemanticEligibility(input: EligibilityInput): {
  eligibility: SemanticEligibility;
  reasonCode?: ReasonCode;
} {
  const { item, deterministic, evaluations, config, index, total, session } = input;
  const remote = config.semanticMode === "remote";
  if (remote && looksSensitive(item.content, item.tool?.path ?? item.tool?.normalizedPath)) {
    return { eligibility: "forbidden", reasonCode: "SENSITIVE_CONTENT_REMOTE_BLOCK" };
  }

  if (deterministic?.retention === "protected" || deterministic?.action === "PROTECT") {
    return { eligibility: "forbidden" };
  }

  const safetyProtect = evaluations.some(
    (evaluation) =>
      evaluation.authority === "safety" &&
      (evaluation.reasonCode === "USER_CONSTRAINT" ||
        evaluation.reasonCode === "CURRENT_TASK" ||
        evaluation.reasonCode === "SYSTEM_INSTRUCTION" ||
        evaluation.reasonCode === "UNRESOLVED_ERROR"),
  );
  if (safetyProtect) {
    return { eligibility: "forbidden" };
  }

  if (item.kind === "message" && item.role === "user") {
    const recentStart = Math.max(0, total - config.recentItemCount);
    if (index >= recentStart) {
      return { eligibility: "forbidden" };
    }
  }

  if (deterministic?.action === "DROP") {
    return { eligibility: "forbidden" };
  }

  const historical = index < Math.max(0, total - config.recentItemCount);
  const large = item.tokenCount > budgetForKind(item.tool?.kind, config);
  const toolResult = item.kind === "tool_pair" || item.kind === "unpaired_tool_result";
  const structurallySuperseded = evaluations.some(
    (evaluation) =>
      evaluation.reasonCode === "SUPERSEDED_FILE_READ" ||
      evaluation.reasonCode === "WRITE_INVALIDATED_READ",
  );
  const modified = new Set(
    (session?.items ?? [])
      .filter((entry) => entry.tool?.kind === "file_write")
      .map((entry) => entry.tool?.normalizedPath ?? entry.tool?.path)
      .filter((path): path is string => typeof path === "string"),
  );
  const currentFile =
    item.tool?.kind === "file_read" &&
    Boolean(item.tool.normalizedPath ?? item.tool.path) &&
    modified.has(item.tool.normalizedPath ?? item.tool.path ?? "");
  const text = `${item.tool?.command ?? ""} ${item.content}`;
  const exploratory = EXPLORATORY_RE.test(text);
  const debugging = DEBUG_RE.test(text);

  if (
    historical &&
    !structurallySuperseded &&
    !currentFile &&
    (large || exploratory || debugging || item.tool?.kind === "file_read")
  ) {
    return { eligibility: "recommended" };
  }

  if (historical || toolResult || item.role === "assistant") {
    return { eligibility: "eligible" };
  }

  return { eligibility: "eligible" };
}
