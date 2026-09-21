export type { ClaudeAdapter } from "./types.js";
export type {
  AnalyzeClaudeSessionOptions,
  ClaudeParseResult,
  ClaudeParseWarning,
  ClaudeSessionMeta,
  ClaudeTranscriptInput,
  ClaudeUnknownEvent,
  ParseClaudeOptions,
  ShadowAnalysisResult,
  ShadowItemSummary,
  ShadowJsonDocument,
  ShadowStatistics,
} from "./types.js";
export { SHADOW_MODE_DISCLAIMER } from "./types.js";
export { defaultClaudeAdapter, parseClaudeJsonl, parseTranscript, sessionIdFromSourcePath } from "./parser.js";
export { analyzeClaudeSession, toShadowJsonDocument, previewText } from "./analyze.js";
export { formatShadowAnalysis, formatShadowExplain } from "./format.js";
export { writeShadowReport, shadowReportPath, DEFAULT_SHADOW_DIR } from "./report.js";
export { normalizeProjectPath } from "./path-normalize.js";
export { normalizeClaudeTool, unwrapCommand } from "./tool-normalize.js";
export { runClaudeHookCli } from "./hook.js";
