export const CONTEXT_ACTIONS = ["PROTECT", "KEEP", "COMPRESS", "DROP"] as const;
export type ContextAction = (typeof CONTEXT_ACTIONS)[number];

export const DECISION_AUTHORITIES = [
  "safety",
  "structural",
  "heuristic",
  "semantic",
] as const;
export type DecisionAuthority = (typeof DECISION_AUTHORITIES)[number];

export const REASON_CODES = [
  "SUPERSEDED_FILE_READ",
  "WRITE_INVALIDATED_READ",
  "SUPERSEDED_GIT_STATUS",
  "SUPERSEDED_GIT_DIFF",
  "OLD_DIRECTORY_LISTING",
  "SUPERSEDED_TEST_RUN",
  "TEST_FAILURE_RESOLVED",
  "DUPLICATE_OUTPUT",
  "LARGE_OUTPUT",
  "LARGE_BUILD_OUTPUT",
  "LARGE_TEST_OUTPUT",
  "LARGE_GIT_DIFF",
  "LARGE_DIRECTORY_LISTING",
  "RECENT_CONTEXT",
  "USER_CONSTRAINT",
  "SYSTEM_INSTRUCTION",
  "CURRENT_TASK",
  "UNRESOLVED_ERROR",
  "DEFAULT_KEEP",
  "SEMANTIC_CLASSIFICATION",
  "SEMANTIC_KEEP",
  "SEMANTIC_COMPRESS",
  "SEMANTIC_DROP",
  "SEMANTIC_LOW_CONFIDENCE",
  "SEMANTIC_PROVIDER_FAILURE",
  "SENSITIVE_CONTENT_REMOTE_BLOCK",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const RETENTION_STATES = ["protected", "normal"] as const;
export type Retention = (typeof RETENTION_STATES)[number];

export const COMPRESSION_ELIGIBILITIES = ["allowed", "forbidden"] as const;
export type CompressionEligibility = (typeof COMPRESSION_ELIGIBILITIES)[number];

export const IMPORTANCE_LEVELS = ["CRITICAL", "IMPORTANT", "NORMAL", "EPHEMERAL"] as const;
export type Importance = (typeof IMPORTANCE_LEVELS)[number];

export const SEMANTIC_ELIGIBILITIES = ["forbidden", "eligible", "recommended"] as const;
export type SemanticEligibility = (typeof SEMANTIC_ELIGIBILITIES)[number];

export const SEMANTIC_MODES = ["off", "local", "remote"] as const;
export type SemanticMode = (typeof SEMANTIC_MODES)[number];

export const SEMANTIC_ACTIONS = ["KEEP", "COMPRESS", "DROP"] as const;
export type SemanticAction = (typeof SEMANTIC_ACTIONS)[number];

export const MESSAGE_ORIGINS = [
  "user",
  "developer",
  "system",
  "tool",
  "plugin",
  "agent",
  "unknown",
] as const;
export type MessageOrigin = (typeof MESSAGE_ORIGINS)[number];

export const RELATION_TYPES = [
  "supersedes",
  "invalidates",
  "validates",
  "depends_on",
  "caused_by",
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export const FAILURE_KINDS = [
  "test",
  "build",
  "compile",
  "lint",
  "runtime",
  "network",
  "deployment",
  "unknown",
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export const COMPRESSION_STRATEGIES = [
  "head_tail",
  "error_extract",
  "test_summary",
  "git_diff",
  "directory_list",
] as const;
export type CompressionStrategyName = (typeof COMPRESSION_STRATEGIES)[number];

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type ToolKind =
  | "file_read"
  | "file_write"
  | "git_status"
  | "git_diff"
  | "directory_list"
  | "test_run"
  | "build_run"
  | "command"
  | "other";

export type ContextItemKind =
  | "message"
  | "tool_pair"
  | "unpaired_tool_call"
  | "unpaired_tool_result";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown> | string;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
  exitCode?: number;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_result"; toolResult: ToolResult };

export interface ContextMessage {
  id: string;
  role: MessageRole;
  content: string | ContentPart[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  createdAt?: string;
  origin?: MessageOrigin;
  originVendor?: string;
  metadata?: Record<string, unknown>;
}

export interface Transcript {
  sessionId?: string;
  messages: ContextMessage[];
}

export interface TokenEstimator {
  estimate(text: string): number;
}

export interface ToolMeta {
  name: string;
  kind: ToolKind;
  callId: string;
  args: Record<string, unknown>;
  result?: string;
  exitCode?: number;
  isError?: boolean;
  path?: string;
  normalizedPath?: string;
  contentHash?: string;
  operationIndex?: number;
  writeBetweenReads?: boolean;
  command?: string;
  testTarget?: string;
  failureKind?: FailureKind;
  rawContentHash?: string;
  normalizedContentHash?: string;
}

export interface ContextItem {
  id: string;
  kind: ContextItemKind;
  role?: MessageRole;
  content: string;
  createdAt?: string;
  tokenCount: number;
  tool?: ToolMeta;
  messageIds: readonly string[];
  origin?: MessageOrigin;
  originVendor?: string;
  importance?: Importance;
  rawContentHash?: string;
  normalizedContentHash?: string;
  semanticEligibility?: SemanticEligibility;
  metadata?: Record<string, unknown>;
}

export interface ContextDecision {
  itemId: string;
  action: ContextAction;
  rule: string;
  reasonCode: ReasonCode;
  reason: string;
  authority: DecisionAuthority;
  retention: Retention;
  compression: CompressionEligibility;
  importance?: Importance;
  semanticEligibility?: SemanticEligibility;
  relevanceScore?: number;
  confidence?: number;
  provider?: string;
}

export interface ItemDecisionRecord {
  itemId: string;
  winning: ContextDecision;
  evaluations: readonly ContextDecision[];
}

export interface ContextRelation {
  type: RelationType;
  fromId: string;
  toId: string;
  rule: string;
}

export interface TaskState {
  rootTask?: string;
  currentTask?: string;
  constraints: string[];
  acceptanceCriteria: string[];
}

export interface SessionState {
  sessionId: string;
  items: readonly ContextItem[];
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
  task: TaskState;
  relations: readonly ContextRelation[];
}

export interface ToolOutputBudgets {
  generic: number;
  build: number;
  test: number;
  gitDiff: number;
  directoryList: number;
}

export interface SemanticPolicy {
  keepMinRelevance: number;
  compressMinRelevance: number;
  dropMinConfidence: number;
  policyVersion: string;
}

export interface EngineConfig {
  recentItemCount: number;
  largeOutputTokens: number;
  charsPerToken: number;
  tokenEstimator?: TokenEstimator;
  toolOutputBudgets: ToolOutputBudgets;
  reportPreviews: boolean;
  previewMaxChars: number;
  semanticMode: SemanticMode;
  semanticPolicy: SemanticPolicy;
  semanticBatchMaxItems: number;
  semanticBatchMaxTokens: number;
  semanticTimeoutMs: number;
  semanticCache: boolean;
  semanticCacheDir: string;
}

export interface PruningRule {
  name: string;
  evaluate(
    items: readonly ContextItem[],
    config: EngineConfig,
  ): ContextDecision[];
}

export interface PackedCandidate {
  itemId: string;
  kind: ContextItemKind;
  origin?: MessageOrigin;
  importance?: Importance;
  toolKind?: ToolKind;
  command?: string;
  path?: string;
  order: number;
  ageFromEnd: number;
  tokenCount: number;
  relationships: readonly ContextRelation[];
  contentPreview: string;
  normalizedContentHash?: string;
}

export interface PackedSemanticState {
  currentTask?: string;
  userConstraints: string[];
  currentErrors: string[];
  modifiedFiles: string[];
  recentActivity: string[];
  architecturalFacts: string[];
}

export interface SemanticClassificationRequest {
  sessionId: string;
  packedState: PackedSemanticState;
  candidates: readonly PackedCandidate[];
  tokenBudget: number;
  policyVersion: string;
}

export interface SemanticItemResult {
  itemId: string;
  action: SemanticAction;
  relevanceScore: number;
  confidence: number;
  reasonCode: ReasonCode;
  reason: string;
}

export interface ProviderUsage {
  requests: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  estimatedCost?: number;
  estimatedCostUnavailable?: boolean;
}

export interface SemanticClassificationResult {
  provider: string;
  providerVersion?: string;
  decisions: readonly SemanticItemResult[];
  usage?: ProviderUsage;
  redactionsApplied?: number;
  failure?: string;
}

export interface SemanticProvider {
  readonly name: string;
  readonly version?: string;
  /** When true, classify() may send packed state off-box. Requires semanticMode=remote. */
  readonly remote?: boolean;
  classify(request: SemanticClassificationRequest): Promise<SemanticClassificationResult>;
  compress?(item: ContextItem): Promise<string>;
}

export interface SemanticDisagreement {
  itemId: string;
  deterministicAction: ContextAction;
  deterministicReason: string;
  semanticAction: SemanticAction;
  semanticReason: string;
  finalAction: ContextAction;
  relevanceScore?: number;
  confidence?: number;
}

export interface SemanticAudit {
  provider?: string;
  providerVersion?: string;
  mode: SemanticMode;
  policy: SemanticPolicy;
  candidateCount: number;
  batchCount: number;
  providerLatencyMs: number;
  providerFailures: number;
  redactionCount: number;
  tokensSentExternally: number;
  charactersSentExternally: number;
  cacheHits: number;
  cacheMisses: number;
  usage?: ProviderUsage;
  decisions: readonly SemanticItemResult[];
  disagreements: readonly SemanticDisagreement[];
}

export interface CompressedContent {
  strategy: CompressionStrategyName;
  originalTokens: number;
  retainedTokens: number;
  content: string;
}

export interface CompressionStrategy {
  readonly name: CompressionStrategyName;
  supports(item: ContextItem): boolean;
  compress(
    item: ContextItem,
    config: EngineConfig,
    estimator: TokenEstimator,
  ): CompressedContent;
}

export interface RuleStat {
  count: number;
  tokens: number;
}

export interface CompactionStats {
  originalItems: number;
  compactItems: number;
  originalTokens: number;
  compactTokens: number;
  keptCount: number;
  keptTokens: number;
  protectedCount: number;
  protectedTokens: number;
  compressedCount: number;
  compressedTokens: number;
  droppedCount: number;
  droppedTokens: number;
  protectedVerbatimTokens: number;
  protectedCompressibleTokens: number;
  retentionProtectedTokens: number;
  compressionSavings: number;
  dropSavings: number;
  totalPotentialSavings: number;
  reductionPercent: number;
  byRule: Record<string, RuleStat>;
  byReasonCode: Record<string, RuleStat>;
  reductionByReasonCode: Record<string, number>;
  semanticCandidateCount?: number;
  semanticKeepCount?: number;
  semanticCompressCount?: number;
  semanticDropCount?: number;
  additionalSemanticSavings?: number;
}

export interface CompactionResult {
  sessionId: string;
  session: SessionState;
  items: readonly ContextItem[];
  compacted: readonly ContextItem[];
  decisions: readonly ContextDecision[];
  evaluations: readonly ContextDecision[];
  decisionRecords: readonly ItemDecisionRecord[];
  relations: readonly ContextRelation[];
  stats: CompactionStats;
  deterministicDecisions: readonly ContextDecision[];
  deterministicStats: CompactionStats;
  semantic?: SemanticAudit;
}

export interface CompactOptions {
  config?: Partial<EngineConfig>;
  semanticProvider?: SemanticProvider;
}
