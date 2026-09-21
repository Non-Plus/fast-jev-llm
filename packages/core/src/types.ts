export const CONTEXT_ACTIONS = ["PROTECT", "KEEP", "COMPRESS", "DROP"] as const;
export type ContextAction = (typeof CONTEXT_ACTIONS)[number];

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

export interface ToolMeta {
  name: string;
  kind: ToolKind;
  callId: string;
  args: Record<string, unknown>;
  result?: string;
  exitCode?: number;
  isError?: boolean;
  path?: string;
  command?: string;
  testTarget?: string;
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
  action: ContextAction;
  reason: string;
  itemId: string;
  rule: string;
}

export interface SessionState {
  sessionId: string;
  items: readonly ContextItem[];
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EngineConfig {
  recentItemCount: number;
  largeOutputTokens: number;
  charsPerToken: number;
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
  byRule: Record<string, RuleStat>;
}

export interface CompactionResult {
  sessionId: string;
  items: readonly ContextItem[];
  compacted: readonly ContextItem[];
  decisions: readonly ContextDecision[];
  stats: CompactionStats;
}

export interface CompactOptions {
  config?: Partial<EngineConfig>;
  semanticProvider?: SemanticProvider;
}
