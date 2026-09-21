import type {
  CompactOptions,
  CompressionEligibility,
  ContextAction,
  ContextDecision,
  ContextItemKind,
  ContextRelation,
  DecisionAuthority,
  Importance,
  ItemDecisionRecord,
  MessageOrigin,
  ReasonCode,
  Retention,
  SemanticAction,
  SemanticAudit,
  SemanticEligibility,
  Transcript,
} from "@fast-jev/core";
import type { Readable } from "node:stream";

export type CodexTranscriptInput =
  | string
  | URL
  | { readonly path: string }
  | { readonly text: string }
  | { readonly stream: Readable }
  | { readonly events: readonly unknown[] };

export interface CodexAdapter {
  parseTranscript(input: CodexTranscriptInput): Promise<Transcript>;
}

export interface CodexSessionMeta {
  sessionId: string;
  timestamp?: string;
  model?: string;
  cwd?: string;
  cliVersion?: string;
  originator?: string;
  sourcePath?: string;
}

export interface CodexParseWarning {
  lineNumber: number;
  kind: "malformed_line" | "unknown_event" | "skipped";
  message: string;
  eventType?: string;
  payloadType?: string;
}

export interface CodexUnknownEvent {
  lineNumber: number;
  type: string;
  payloadType?: string;
}

export interface CodexParseResult {
  transcript: Transcript;
  meta: CodexSessionMeta;
  warnings: CodexParseWarning[];
  unknownEvents: CodexUnknownEvent[];
  lineCount: number;
  parsedLineCount: number;
  malformedLineCount: number;
}

export interface ShadowItemSummary {
  itemId: string;
  kind: ContextItemKind;
  action: ContextAction;
  reasonCode: ReasonCode;
  reason: string;
  rule: string;
  authority: DecisionAuthority;
  importance?: Importance;
  origin?: MessageOrigin;
  retention: Retention;
  compression: CompressionEligibility;
  tokens: number;
  originalTokens: number;
  retainedTokens: number;
  savedTokens: number;
  toolName?: string;
  command?: string;
  callId?: string;
  preview?: string;
  supersededBy?: string;
  supersedes?: string;
  relationships: readonly string[];
  messageIds: readonly string[];
  narrative?: string;
  semanticEligibility?: SemanticEligibility;
  deterministicAction?: ContextAction;
  semanticAction?: SemanticAction;
  relevanceScore?: number;
  confidence?: number;
  provider?: string;
}

export interface ShadowStatistics {
  originalTokens: number;
  protectedTokens: number;
  protectedVerbatimTokens: number;
  protectedCompressibleTokens: number;
  retentionProtectedTokens: number;
  keptTokens: number;
  compressedTokens: number;
  compressedRetainedTokens: number;
  droppedTokens: number;
  compressionSavings: number;
  dropSavings: number;
  totalPotentialSavings: number;
  potentialReductionPercent: number;
  itemCount: number;
  protectedItems: number;
  keptItems: number;
  compressedItems: number;
  droppedItems: number;
}

export interface ShadowAnalysisResult {
  sessionId: string;
  source: "codex";
  timestamp?: string;
  model?: string;
  cwd?: string;
  cliVersion?: string;
  originalTokens: number;
  protectedTokens: number;
  protectedVerbatimTokens: number;
  protectedCompressibleTokens: number;
  retentionProtectedTokens: number;
  keptTokens: number;
  compressedTokens: number;
  compressedRetainedTokens: number;
  droppedTokens: number;
  compressionSavings: number;
  dropSavings: number;
  totalPotentialSavings: number;
  potentialReductionPercent: number;
  itemCount: number;
  protectedItems: number;
  keptItems: number;
  compressedItems: number;
  droppedItems: number;
  reductionByReasonCode: Record<string, number>;
  ruleEvaluationCounts: Record<string, number>;
  decisions: readonly ContextDecision[];
  decisionTrace: readonly ItemDecisionRecord[];
  relationships: readonly ContextRelation[];
  items: readonly ShadowItemSummary[];
  parserWarnings: readonly CodexParseWarning[];
  unknownEvents: readonly CodexUnknownEvent[];
  reportPreviews: boolean;
  previewMaxChars: number;
  deterministicStats?: ShadowStatistics;
  semantic?: SemanticAudit;
}

export interface AnalyzeCodexSessionOptions extends CompactOptions {
  previewLength?: number;
  previewMaxChars?: number;
  reportPreviews?: boolean;
  sourcePath?: string;
}

export interface ShadowJsonDocument {
  metadata: {
    sessionId: string;
    source: "codex";
    mode: "shadow";
    localOnly: boolean;
    timestamp?: string;
    model?: string;
    cwd?: string;
    sourcePath?: string;
    reportPreviews: boolean;
    previewMaxChars: number;
    semanticMode?: string;
  };
  statistics: ShadowStatistics;
  deterministicStatistics?: ShadowStatistics;
  semantic?: SemanticAudit;
  decisions: readonly ContextDecision[];
  decisionTrace: readonly ItemDecisionRecord[];
  relationships: readonly ContextRelation[];
  items: readonly ShadowItemSummary[];
  parser: {
    warnings: readonly CodexParseWarning[];
    unknownEvents: readonly CodexUnknownEvent[];
  };
}

export const SHADOW_MODE_DISCLAIMER =
  "Shadow mode only. No Codex context was modified. Shadow reports remain local.";
