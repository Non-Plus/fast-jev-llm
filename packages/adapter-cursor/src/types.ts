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

export type CursorTranscriptInput =
  | string
  | URL
  | { readonly path: string }
  | { readonly text: string }
  | { readonly stream: Readable }
  | { readonly events: readonly unknown[] };

export interface CursorAdapter {
  parseTranscript(input: CursorTranscriptInput): Promise<Transcript>;
}

export interface CursorSessionMeta {
  sessionId: string;
  timestamp?: string;
  model?: string;
  cwd?: string;
  cursorVersion?: string;
  sourcePath?: string;
  observedWireFormat?: string;
}

export interface CursorParseWarning {
  lineNumber: number;
  kind: "malformed_line" | "unknown_event" | "skipped";
  message: string;
  eventType?: string;
}

export interface CursorUnknownEvent {
  lineNumber: number;
  type: string;
}

export interface CursorParseResult {
  transcript: Transcript;
  meta: CursorSessionMeta;
  warnings: CursorParseWarning[];
  unknownEvents: CursorUnknownEvent[];
  lineCount: number;
  parsedLineCount: number;
  malformedLineCount: number;
}

export interface ParseCursorOptions {
  cwd?: string;
  cursorVersion?: string;
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
  source: "cursor";
  timestamp?: string;
  model?: string;
  cwd?: string;
  cursorVersion?: string;
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
  parserWarnings: readonly CursorParseWarning[];
  unknownEvents: readonly CursorUnknownEvent[];
  reportPreviews: boolean;
  previewMaxChars: number;
  deterministicStats?: ShadowStatistics;
  semantic?: SemanticAudit;
}

export interface AnalyzeCursorSessionOptions extends CompactOptions, ParseCursorOptions {
  previewLength?: number;
  previewMaxChars?: number;
  reportPreviews?: boolean;
}

export interface ShadowJsonDocument {
  metadata: {
    sessionId: string;
    source: "cursor";
    mode: "shadow";
    localOnly: boolean;
    timestamp?: string;
    model?: string;
    cwd?: string;
    cursorVersion?: string;
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
    warnings: readonly CursorParseWarning[];
    unknownEvents: readonly CursorUnknownEvent[];
  };
}

export const SHADOW_MODE_DISCLAIMER =
  "Shadow mode only.\nNo Cursor context was modified.";
