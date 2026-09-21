import { basename } from "node:path";
import type { ContextMessage, MessageOrigin, MessageRole, Transcript } from "@fast-jev/core";
import {
  isEventListInput,
  parseJsonLine,
  readJsonlLines,
  sourcePathOf,
} from "./jsonl.js";
import { normalizeClaudeTool } from "./tool-normalize.js";
import type {
  ClaudeAdapter,
  ClaudeParseResult,
  ClaudeParseWarning,
  ClaudeSessionMeta,
  ClaudeTranscriptInput,
  ClaudeUnknownEvent,
  ParseClaudeOptions,
} from "./types.js";

const IGNORED_TYPES = new Set([
  "turn_ended",
  "turnEnded",
  "thinking",
  "reasoning",
  "queue-operation",
  "attachment",
  "custom-title",
  "last-prompt",
  "mode",
  "progress",
  "file-history-snapshot",
]);

const CONVERSATION_TYPES = new Set(["user", "assistant", "system", "tool"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return items.length > 0 ? items : undefined;
}

export function sessionIdFromSourcePath(sourcePath?: string): string | undefined {
  if (!sourcePath) {
    return undefined;
  }
  const base = basename(sourcePath);
  if (base.endsWith(".jsonl")) {
    return base.slice(0, -".jsonl".length);
  }
  return undefined;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (!isRecord(part)) {
          return "";
        }
        const type = asString(part.type);
        if (
          type === "tool_use" ||
          type === "tool_call" ||
          type === "tool_result" ||
          type === "thinking" ||
          type === "redacted_thinking"
        ) {
          return "";
        }
        if (typeof part.text === "string") {
          return part.text;
        }
        if (typeof part.output === "string") {
          return part.output;
        }
        if (typeof part.content === "string") {
          return part.content;
        }
        return "";
      })
      .join("");
  }
  if (isRecord(content)) {
    if (typeof content.text === "string") {
      return content.text;
    }
    if (typeof content.stdout === "string") {
      return content.stdout;
    }
    if (typeof content.output === "string") {
      return content.output;
    }
    if (typeof content.content === "string") {
      return content.content;
    }
    try {
      return JSON.stringify(content);
    } catch {
      return "";
    }
  }
  return "";
}

function mapRole(role: unknown): MessageRole {
  if (role === "user") {
    return "user";
  }
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "tool") {
    return "tool";
  }
  if (role === "system" || role === "developer") {
    return "system";
  }
  return "assistant";
}

function messageOrigin(role: unknown): MessageOrigin {
  if (role === "user") {
    return "user";
  }
  if (role === "developer") {
    return "developer";
  }
  if (role === "system") {
    return "system";
  }
  if (role === "tool") {
    return "tool";
  }
  if (role === "assistant") {
    return "agent";
  }
  return "unknown";
}

function pushUnknown(
  unknownEvents: ClaudeUnknownEvent[],
  warnings: ClaudeParseWarning[],
  lineNumber: number,
  type: string,
): void {
  unknownEvents.push({ lineNumber, type });
  warnings.push({
    lineNumber,
    kind: "unknown_event",
    message: `Unknown event ${type}`,
    eventType: type,
  });
}

class ClaudeParser {
  readonly meta: ClaudeSessionMeta = { sessionId: "claude-session" };
  readonly warnings: ClaudeParseWarning[] = [];
  readonly unknownEvents: ClaudeUnknownEvent[] = [];
  readonly messages: ContextMessage[] = [];
  readonly pendingCallNames = new Map<string, string>();
  lineCount = 0;
  parsedLineCount = 0;
  malformedLineCount = 0;
  private seq = 0;

  constructor(options?: ParseClaudeOptions) {
    if (options?.sourcePath) {
      this.meta.sourcePath = options.sourcePath;
      const fromPath = sessionIdFromSourcePath(options.sourcePath);
      if (fromPath) {
        this.meta.sessionId = fromPath;
      }
    }
    if (options?.sessionId) {
      this.meta.sessionId = options.sessionId;
    }
    if (options?.cwd) {
      this.meta.cwd = options.cwd;
    }
    if (options?.claudeVersion) {
      this.meta.claudeVersion = options.claudeVersion;
    }
  }

  private nextId(prefix: string, preferred?: string): string {
    if (preferred && preferred.length > 0) {
      return preferred;
    }
    this.seq += 1;
    return `${prefix}_${String(this.seq).padStart(4, "0")}`;
  }

  ingest(value: unknown, lineNumber: number): void {
    if (!isRecord(value)) {
      this.malformedLineCount += 1;
      this.warnings.push({
        lineNumber,
        kind: "malformed_line",
        message: "JSON value is not a Claude event object",
      });
      return;
    }
    this.parsedLineCount += 1;

    const timestamp = asString(value.timestamp) ?? asString(value.createdAt);
    if (timestamp && !this.meta.timestamp) {
      this.meta.timestamp = timestamp;
    }
    this.readNativeSessionFields(value, timestamp);

    const type = asString(value.type);
    if (type === "session_meta") {
      const payload = isRecord(value.payload) ? value.payload : value;
      this.readSessionMeta(payload, timestamp);
      return;
    }
    if (type === "system" && asString(value.subtype) === "compact_boundary") {
      this.meta.observedClaudeCompaction = true;
      return;
    }
    if (type && IGNORED_TYPES.has(type)) {
      return;
    }

    if (
      (type && CONVERSATION_TYPES.has(type)) ||
      value.role !== undefined ||
      isRecord(value.message) ||
      Array.isArray(value.content)
    ) {
      this.readConversationEvent(value, timestamp, lineNumber);
      return;
    }

    if (type) {
      pushUnknown(this.unknownEvents, this.warnings, lineNumber, type);
      return;
    }
    this.malformedLineCount += 1;
    this.warnings.push({
      lineNumber,
      kind: "malformed_line",
      message: "JSON object has neither role nor a known type",
    });
  }

  private readSessionMeta(payload: Record<string, unknown>, timestamp?: string): void {
    const sessionId =
      asString(payload.session_id) ??
      asString(payload.sessionId) ??
      asString(payload.conversation_id) ??
      asString(payload.id);
    if (sessionId) {
      this.meta.sessionId = sessionId;
    }
    const ts = asString(payload.timestamp) ?? timestamp;
    if (ts) {
      this.meta.timestamp = ts;
    }
    const cwd =
      asString(payload.cwd) ??
      asString(payload.workspace) ??
      asStringArray(payload.workspace_roots)?.[0];
    if (cwd) {
      this.meta.cwd = cwd;
    }
    const claudeVersion =
      asString(payload.claude_version) ??
      asString(payload.claudeVersion) ??
      asString(payload.version);
    if (claudeVersion) {
      this.meta.claudeVersion = claudeVersion;
    }
    const gitBranch = asString(payload.gitBranch) ?? asString(payload.git_branch);
    if (gitBranch) {
      this.meta.gitBranch = gitBranch;
    }
    const model = asString(payload.model);
    if (model) {
      this.meta.model = model;
    }
    const format = asString(payload.observed_wire_format);
    if (format) {
      this.meta.observedWireFormat = format;
    }
  }

  private readNativeSessionFields(value: Record<string, unknown>, timestamp?: string): void {
    const sessionId =
      asString(value.sessionId) ?? asString(value.session_id) ?? asString(value.conversation_id);
    if (sessionId) {
      this.meta.sessionId = sessionId;
    }
    const cwd =
      asString(value.cwd) ?? asStringArray(value.workspace_roots)?.[0] ?? asString(value.workspace);
    if (cwd) {
      this.meta.cwd = cwd;
    }
    const version =
      asString(value.version) ?? asString(value.claude_version) ?? asString(value.claudeVersion);
    if (version) {
      this.meta.claudeVersion = version;
    }
    const gitBranch = asString(value.gitBranch) ?? asString(value.git_branch);
    if (gitBranch) {
      this.meta.gitBranch = gitBranch;
    }
    const ts = asString(value.timestamp) ?? timestamp;
    if (ts && !this.meta.timestamp) {
      this.meta.timestamp = ts;
    }
    this.meta.observedWireFormat ??= "claude-code-transcript-jsonl-v1";
  }

  private readConversationEvent(
    value: Record<string, unknown>,
    timestamp: string | undefined,
    lineNumber: number,
  ): void {
    this.readNativeSessionFields(value, timestamp);
    const message = isRecord(value.message) ? value.message : value;
    const model = asString(value.model) ?? asString(message.model);
    if (model) {
      this.meta.model = model;
    }

    const role = value.role ?? message.role ?? asString(value.type);
    const content = message.content ?? value.content;
    const eventUuid = asString(value.uuid) ?? asString(message.id) ?? asString(value.id);
    if (role === "tool" || asString(message.tool_call_id) || asString(message.toolCallId)) {
      this.readToolResultMessage(message, timestamp, role);
      return;
    }
    if (Array.isArray(content)) {
      this.readContentParts(content, role, timestamp, lineNumber, value);
      return;
    }
    if (typeof content === "string" || isRecord(content)) {
      this.readTextMessage(role, contentToText(content), timestamp, eventUuid);
      return;
    }
    if (isRecord(value.toolUseResult)) {
      this.readToolUseResultFallback(value, timestamp);
      return;
    }
    pushUnknown(this.unknownEvents, this.warnings, lineNumber, asString(value.type) ?? "message");
  }

  private readContentParts(
    parts: unknown[],
    role: unknown,
    timestamp: string | undefined,
    lineNumber: number,
    event?: Record<string, unknown>,
  ): void {
    const texts: string[] = [];
    for (const part of parts) {
      if (!isRecord(part)) {
        if (typeof part === "string" && part.length > 0) {
          texts.push(part);
        }
        continue;
      }
      const type = asString(part.type) ?? "text";
      if (type === "text" || type === "input_text" || type === "output_text") {
        const text = contentToText(part);
        if (text.length > 0) {
          texts.push(text);
        }
        continue;
      }
      if (type === "tool_use" || type === "tool_call") {
        if (texts.length > 0) {
          this.readTextMessage(role, texts.splice(0).join(""), timestamp);
        }
        this.readToolCall(part, timestamp);
        continue;
      }
      if (type === "tool_result") {
        if (texts.length > 0) {
          this.readTextMessage(role, texts.splice(0).join(""), timestamp);
        }
        this.readToolResultPart(part, timestamp, event);
        continue;
      }
      if (IGNORED_TYPES.has(type)) {
        continue;
      }
      this.warnings.push({
        lineNumber,
        kind: "unknown_event",
        message: `Unknown content part ${type}`,
        eventType: type,
      });
    }
    if (texts.length > 0) {
      this.readTextMessage(role, texts.join(""), timestamp);
    }
  }

  private readTextMessage(
    role: unknown,
    text: string,
    timestamp?: string,
    preferredId?: string,
  ): void {
    if (text.trim().length === 0) {
      return;
    }
    const mappedRole = mapRole(role);
    const origin = messageOrigin(role);
    const id = this.nextId("msg", preferredId);
    this.messages.push({
      id,
      role: mappedRole,
      content: text,
      origin,
      originVendor: "claude",
      ...(timestamp !== undefined ? { createdAt: timestamp } : {}),
      metadata: {
        source: "claude",
        eventType: "message",
        originalRole: role,
        origin,
        originVendor: "claude",
        ...(this.meta.claudeVersion !== undefined ? { claudeVersion: this.meta.claudeVersion } : {}),
      },
    });
  }

  private readToolCall(part: Record<string, unknown>, timestamp?: string): void {
    const callId =
      asString(part.id) ??
      asString(part.tool_use_id) ??
      asString(part.tool_call_id) ??
      asString(part.call_id) ??
      this.nextId("tool");
    const name = asString(part.name) ?? asString(part.tool_name) ?? "tool";
    const rawArguments = part.input ?? part.arguments ?? part.params ?? {};
    const normalized = normalizeClaudeTool({
      name,
      rawArguments,
      cwd: this.meta.cwd,
    });
    this.pendingCallNames.set(callId, normalized.name);
    this.messages.push({
      id: this.nextId("call", asString(part.id) ?? callId),
      role: "assistant",
      content: "",
      origin: "agent",
      originVendor: "claude",
      toolCalls: [
        {
          id: callId,
          name: normalized.name,
          arguments: normalized.arguments,
        },
      ],
      ...(timestamp !== undefined ? { createdAt: timestamp } : {}),
      metadata: {
        source: "claude",
        eventType: "tool_use",
        origin: "agent",
        originVendor: "claude",
        originalName: normalized.originalName,
        ...(typeof normalized.arguments.originalPath === "string"
          ? { originalPath: normalized.arguments.originalPath }
          : {}),
        ...(this.meta.cwd !== undefined ? { cwd: this.meta.cwd } : {}),
        ...(this.meta.claudeVersion !== undefined ? { claudeVersion: this.meta.claudeVersion } : {}),
      },
    });
  }

  private readToolResultPart(
    part: Record<string, unknown>,
    timestamp?: string,
    event?: Record<string, unknown>,
  ): void {
    const callId =
      asString(part.tool_use_id) ??
      asString(part.tool_call_id) ??
      asString(part.call_id) ??
      asString(part.id);
    if (!callId) {
      this.warnings.push({
        lineNumber: 0,
        kind: "skipped",
        message: "tool_result has no documented tool_use_id; not pairing by adjacency",
        eventType: "tool_result",
      });
    }
    const resolvedId = callId ?? this.nextId("result");
    let output = contentToText(part.content ?? part.output ?? part.result);
    if (output.length === 0 && event && isRecord(event.toolUseResult)) {
      output = contentToText(event.toolUseResult);
    }
    this.pushToolResult(resolvedId, output, { ...part, ...(event ?? {}) }, timestamp);
  }

  private readToolUseResultFallback(value: Record<string, unknown>, timestamp?: string): void {
    const callId = this.nextId("result");
    const output = contentToText(value.toolUseResult);
    this.pushToolResult(callId, output, value, timestamp);
  }

  private readToolResultMessage(
    message: Record<string, unknown>,
    timestamp: string | undefined,
    role: unknown,
  ): void {
    const callId =
      asString(message.tool_call_id) ??
      asString(message.toolCallId) ??
      asString(message.tool_use_id) ??
      this.nextId("result");
    const output = contentToText(message.content ?? message.output ?? message.result);
    this.pushToolResult(callId, output, { ...message, role }, timestamp);
  }

  private pushToolResult(
    callId: string,
    output: string,
    payload: Record<string, unknown>,
    timestamp?: string,
  ): void {
    const name =
      asString(payload.name) ?? this.pendingCallNames.get(callId) ?? "unknown";
    const isError =
      payload.is_error === true ||
      payload.isError === true ||
      (typeof payload.status === "string" && payload.status === "failed");
    const exitCode =
      typeof payload.exit_code === "number"
        ? payload.exit_code
        : typeof payload.exitCode === "number"
          ? payload.exitCode
          : undefined;
    this.messages.push({
      id: this.nextId("result", asString(payload.id) ?? `result_${callId}`),
      role: "tool",
      content: output,
      origin: "tool",
      originVendor: "claude",
      toolCallId: callId,
      name,
      ...(timestamp !== undefined ? { createdAt: timestamp } : {}),
      metadata: {
        source: "claude",
        eventType: "tool_result",
        origin: "tool",
        originVendor: "claude",
        ...(isError ? { isError: true } : {}),
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(this.meta.claudeVersion !== undefined ? { claudeVersion: this.meta.claudeVersion } : {}),
      },
    });
  }

  result(): ClaudeParseResult {
    const transcript: Transcript = {
      sessionId: this.meta.sessionId,
      messages: this.messages,
    };
    return {
      transcript,
      meta: this.meta,
      warnings: this.warnings,
      unknownEvents: this.unknownEvents,
      lineCount: this.lineCount,
      parsedLineCount: this.parsedLineCount,
      malformedLineCount: this.malformedLineCount,
    };
  }
}

export async function parseClaudeJsonl(
  input: ClaudeTranscriptInput,
  options?: ParseClaudeOptions,
): Promise<ClaudeParseResult> {
  const parser = new ClaudeParser({
    ...options,
    sourcePath: options?.sourcePath ?? sourcePathOf(input),
  });
  if (isEventListInput(input)) {
    for (const [index, event] of input.events.entries()) {
      parser.lineCount += 1;
      parser.ingest(event, index + 1);
    }
    return parser.result();
  }

  for await (const { lineNumber, raw } of readJsonlLines(input)) {
    parser.lineCount = lineNumber;
    const parsed = parseJsonLine(raw);
    if (parsed.kind === "empty") {
      continue;
    }
    if (parsed.kind === "error") {
      parser.malformedLineCount += 1;
      parser.warnings.push({
        lineNumber,
        kind: "malformed_line",
        message: parsed.error,
      });
      continue;
    }
    parser.ingest(parsed.value, lineNumber);
  }
  return parser.result();
}

export const defaultClaudeAdapter: ClaudeAdapter = {
  async parseTranscript(input: ClaudeTranscriptInput): Promise<Transcript> {
    const parsed = await parseClaudeJsonl(input);
    return parsed.transcript;
  },
};

export async function parseTranscript(input: ClaudeTranscriptInput): Promise<Transcript> {
  return defaultClaudeAdapter.parseTranscript(input);
}
