export {
  JevSemanticProvider,
  jevProviderFromEnv,
  type JevSemanticProviderOptions,
} from "./client.js";
export { JEV_SCORE_CRITERIA, relevanceFromScore, toJevRequest, toSemanticResults } from "./map.js";
export { JEV_INPUT_USD_PER_MILLION, estimateJevCostUsd } from "./pricing.js";

/**
 * What Jev receives (packed copy only; never the canonical transcript):
 *
 * - sessionId, current task, user constraints, current errors
 * - modified files, recent activity labels, architectural facts
 * - per-candidate: id, kind, tool kind, command/path, age, token size,
 *   relationship summaries, and a short already-redacted content preview
 *
 * What is never sent:
 *
 * - API keys / credentials (the Authorization header uses the local key
 *   for TypeSafe, not user-session secrets)
 * - items marked semanticEligibility=forbidden
 * - recognized secret material (blocked or redacted before classify)
 * - full tool dumps, Codex JSONL, prompts, or compaction internals
 */
