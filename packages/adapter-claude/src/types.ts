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

export type ClaudeTranscriptInput =
  | string
  | URL
  | { readonly path: string }
  | { readonly text: string }
  | { readonly stream: Readable }
  | { readonly events: readonly unknown[] };

export interface ClaudeAdapter {
  parseTranscript(input: ClaudeTranscriptInput): Promise<Transcript>;
}

export interface ClaudeSessionMeta {
  sessionId: string;
  timestamp?: string;
  model?: string;
  cwd?: string;
  claudeVersion?: string;
  gitBranch?: string;
  sourcePath?: string;
  observedWireFormat?: string;
  observedClaudeCompaction?: boolean;
}

export interface ClaudeParseWarning {
  lineNumber: number;
  kind: "malformed_line" | "unknown_event" | "skipped";
  message: string;
  eventType?: string;
}

export interface ClaudeUnknownEvent {
  lineNumber: number;
  type: string;
}

export interface ClaudeParseResult {
  transcript: Transcript;
  meta: ClaudeSessionMeta;
  warnings: ClaudeParseWarning[];
  unknownEvents: ClaudeUnknownEvent[];
  lineCount: number;
  parsedLineCount: number;
  malformedLineCount: number;
}

export interface ParseClaudeOptions {
  cwd?: string;
  claudeVersion?: string;
  sessionId?: string;
  sourcePath?: string;
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
  effectiveTokens: number;
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
  source: "claude";
  timestamp?: string;
  model?: string;
  cwd?: string;
  claudeVersion?: string;
  originalTokens: number;
  effectiveTokens: number;
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
  parserWarnings: readonly ClaudeParseWarning[];
  unknownEvents: readonly ClaudeUnknownEvent[];
  reportPreviews: boolean;
  previewMaxChars: number;
  deterministicStats?: ShadowStatistics;
  semantic?: SemanticAudit;
}

export interface AnalyzeClaudeSessionOptions extends CompactOptions, ParseClaudeOptions {
  previewLength?: number;
  previewMaxChars?: number;
  reportPreviews?: boolean;
}

export interface ShadowJsonDocument {
  metadata: {
    sessionId: string;
    source: "claude";
    mode: "shadow";
    localOnly: boolean;
    timestamp?: string;
    model?: string;
    cwd?: string;
    claudeVersion?: string;
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
    warnings: readonly ClaudeParseWarning[];
    unknownEvents: readonly ClaudeUnknownEvent[];
  };
}

export const SHADOW_MODE_DISCLAIMER =
  "Shadow mode only.\nNo Claude context was modified.";
