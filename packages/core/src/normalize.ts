import { classifyFailureKind, classifyTool, parseArguments } from "./classify.js";
import { annotateFileState, normalizePath } from "./file-state.js";
import { collectRelations } from "./relations.js";
import { inferTaskState } from "./task.js";
import { resolveEstimator } from "./tokens.js";
import type {
  ContentPart,
  ContextItem,
  ContextMessage,
  EngineConfig,
  SessionState,
  ToolCall,
  ToolMeta,
  ToolResult,
  Transcript,
} from "./types.js";

function messageText(content: string | ContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function collectToolCalls(message: ContextMessage): ToolCall[] {
  const fromField = message.toolCalls ?? [];
  const fromContent = Array.isArray(message.content)
    ? message.content
        .filter(
          (part): part is Extract<ContentPart, { type: "tool_call" }> =>
            part.type === "tool_call",
        )
        .map((part) => part.toolCall)
    : [];
  return [...fromField, ...fromContent];
}

function collectInlineResults(message: ContextMessage): ToolResult[] {
  if (!Array.isArray(message.content)) {
    return [];
  }
  return message.content
    .filter(
      (part): part is Extract<ContentPart, { type: "tool_result" }> =>
        part.type === "tool_result",
    )
    .map((part) => part.toolResult);
}

function formatPair(name: string, args: Record<string, unknown>, result: string): string {
  return `$${name} ${JSON.stringify(args)}\n${result}`;
}

function nextId(index: number): string {
  return `item-${String(index).padStart(3, "0")}`;
}

function buildToolMeta(call: ToolCall, result?: ToolResult): ToolMeta {
  const args = parseArguments(call.arguments);
  const classified = classifyTool(call.name, args);
  const meta: ToolMeta = {
    name: call.name,
    kind: classified.kind,
    callId: call.id,
    args,
  };
  if (classified.path !== undefined) {
    meta.path = classified.path;
    meta.normalizedPath = normalizePath(classified.path);
  }
  if (classified.command !== undefined) {
    meta.command = classified.command;
  }
  if (classified.testTarget !== undefined) {
    meta.testTarget = classified.testTarget;
  }
  if (result?.content !== undefined) {
    meta.result = result.content;
  }
  if (result?.exitCode !== undefined) {
    meta.exitCode = result.exitCode;
  }
  if (result?.isError !== undefined) {
    meta.isError = result.isError;
  }
  const failureKind = classifyFailureKind({
    kind: meta.kind,
    command: meta.command,
    result: meta.result,
    ...(meta.isError !== undefined ? { isError: meta.isError } : {}),
    ...(meta.exitCode !== undefined ? { exitCode: meta.exitCode } : {}),
  });
  if (failureKind !== undefined) {
    meta.failureKind = failureKind;
  }
  return meta;
}

interface PendingCall {
  call: ToolCall;
  messageId: string;
  createdAt?: string;
}

export function normalizeTranscript(
  transcript: Transcript,
  config: Pick<EngineConfig, "charsPerToken" | "tokenEstimator">,
): ContextItem[] {
  const estimator = resolveEstimator(config);
  const items: ContextItem[] = [];
  const pending = new Map<string, PendingCall>();
  let seq = 0;

  const push = (item: Omit<ContextItem, "id" | "tokenCount"> & { tokenCount?: number }): void => {
    const tokenCount = item.tokenCount ?? estimator.estimate(item.content);
    items.push({
      ...item,
      id: nextId(seq),
      tokenCount,
    });
    seq += 1;
  };

  const emitPair = (
    call: ToolCall,
    result: ToolResult,
    messageIds: string[],
    createdAt?: string,
  ): void => {
    const tool = buildToolMeta(call, result);
    push({
      kind: "tool_pair",
      content: formatPair(call.name, tool.args, result.content),
      messageIds,
      tool,
      ...(createdAt !== undefined ? { createdAt } : {}),
    });
  };

  for (const message of transcript.messages) {
    const text = messageText(message.content).trim();
    const calls = collectToolCalls(message);
    const inlineResults = collectInlineResults(message);

    if (message.role === "tool" || (message.toolCallId && message.role !== "assistant")) {
      const callId = message.toolCallId;
      const result: ToolResult = {
        toolCallId: callId ?? message.id,
        content: typeof message.content === "string" ? message.content : messageText(message.content),
        ...(message.metadata?.["isError"] === true ? { isError: true } : {}),
        ...(typeof message.metadata?.["exitCode"] === "number"
          ? { exitCode: message.metadata["exitCode"] as number }
          : {}),
      };
      const matched = callId ? pending.get(callId) : undefined;
      if (matched) {
        pending.delete(matched.call.id);
        emitPair(
          matched.call,
          result,
          [matched.messageId, message.id],
          message.createdAt ?? matched.createdAt,
        );
      } else {
        const failureKind = classifyFailureKind({
          kind: "other",
          result: result.content,
          ...(result.isError !== undefined ? { isError: result.isError } : {}),
          ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
        });
        push({
          kind: "unpaired_tool_result",
          role: "tool",
          content: result.content,
          messageIds: [message.id],
          tool: {
            name: message.name ?? "unknown",
            kind: "other",
            callId: result.toolCallId,
            args: {},
            result: result.content,
            ...(result.isError !== undefined ? { isError: result.isError } : {}),
            ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
            ...(failureKind !== undefined ? { failureKind } : {}),
          },
          ...(message.createdAt !== undefined ? { createdAt: message.createdAt } : {}),
        });
      }
      continue;
    }

    if (text.length > 0) {
      const item: Omit<ContextItem, "id" | "tokenCount"> = {
        kind: "message",
        role: message.role,
        content: typeof message.content === "string" ? message.content : text,
        messageIds: [message.id],
        ...(message.createdAt !== undefined ? { createdAt: message.createdAt } : {}),
        ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
      };
      push(item);
    }

    for (const call of calls) {
      pending.set(call.id, {
        call,
        messageId: message.id,
        ...(message.createdAt !== undefined ? { createdAt: message.createdAt } : {}),
      });
    }

    for (const result of inlineResults) {
      const matched = pending.get(result.toolCallId);
      if (matched) {
        pending.delete(result.toolCallId);
        emitPair(
          matched.call,
          result,
          [matched.messageId, message.id],
          message.createdAt ?? matched.createdAt,
        );
      }
    }
  }

  for (const pendingCall of pending.values()) {
    const tool = buildToolMeta(pendingCall.call);
    push({
      kind: "unpaired_tool_call",
      role: "assistant",
      content: `$${pendingCall.call.name} ${JSON.stringify(tool.args)}`,
      messageIds: [pendingCall.messageId],
      tool,
      ...(pendingCall.createdAt !== undefined ? { createdAt: pendingCall.createdAt } : {}),
    });
  }

  annotateFileState(items);
  return items;
}

export function toSessionState(
  transcript: Transcript,
  config: Pick<EngineConfig, "charsPerToken" | "tokenEstimator">,
): SessionState {
  const items = normalizeTranscript(transcript, config);
  const tokenCount = items.reduce((sum, item) => sum + item.tokenCount, 0);
  const timestamps = transcript.messages
    .map((message) => message.createdAt)
    .filter((value): value is string => typeof value === "string");
  return {
    sessionId: transcript.sessionId ?? "session",
    items,
    tokenCount,
    createdAt: timestamps[0] ?? "1970-01-01T00:00:00.000Z",
    updatedAt: timestamps[timestamps.length - 1] ?? "1970-01-01T00:00:00.000Z",
    task: inferTaskState(items),
    relations: collectRelations(items),
  };
}
