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
  "RECENT_CONTEXT",
  "USER_CONSTRAINT",
  "SYSTEM_INSTRUCTION",
  "CURRENT_TASK",
  "UNRESOLVED_ERROR",
  "DEFAULT_KEEP",
  "SEMANTIC_CLASSIFICATION",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

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
  metadata?: Record<string, unknown>;
}

export interface ContextDecision {
  itemId: string;
  action: ContextAction;
  rule: string;
  reasonCode: ReasonCode;
  reason: string;
  authority: DecisionAuthority;
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

export interface EngineConfig {
  recentItemCount: number;
  largeOutputTokens: number;
  charsPerToken: number;
  tokenEstimator?: TokenEstimator;
}

export interface PruningRule {
  name: string;
  evaluate(
    items: readonly ContextItem[],
    config: EngineConfig,
  ): ContextDecision[];
}

export interface SemanticProvider {
  readonly name: string;
  classify?(
    items: readonly ContextItem[],
    session: SessionState,
  ): Promise<readonly ContextDecision[]>;
  compress?(item: ContextItem): Promise<string>;
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
  reductionPercent: number;
  byRule: Record<string, RuleStat>;
  byReasonCode: Record<string, RuleStat>;
  reductionByReasonCode: Record<string, number>;
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
}

export interface CompactOptions {
  config?: Partial<EngineConfig>;
  semanticProvider?: SemanticProvider;
}
