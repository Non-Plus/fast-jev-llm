import { basename } from "node:path";
import type { ContextMessage, MessageOrigin, MessageRole, Transcript } from "@fast-jev/core";
import {
  isEventListInput,
  parseJsonLine,
  readJsonlLines,
  sourcePathOf,
} from "./jsonl.js";
import { normalizeCursorTool } from "./tool-normalize.js";
import type {
  CursorAdapter,
  CursorParseResult,
  CursorParseWarning,
  CursorSessionMeta,
  CursorTranscriptInput,
  CursorUnknownEvent,
  ParseCursorOptions,
} from "./types.js";

const IGNORED_TYPES = new Set([
  "turn_ended",
  "turnEnded",
  "thinking",
  "reasoning",
]);

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
        if (type === "tool_use" || type === "tool_call" || type === "tool_result") {
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
  unknownEvents: CursorUnknownEvent[],
  warnings: CursorParseWarning[],
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

class CursorParser {
  readonly meta: CursorSessionMeta = { sessionId: "cursor-session" };
  readonly warnings: CursorParseWarning[] = [];
  readonly unknownEvents: CursorUnknownEvent[] = [];
  readonly messages: ContextMessage[] = [];
  readonly pendingCallNames = new Map<string, string>();
  lineCount = 0;
  parsedLineCount = 0;
  malformedLineCount = 0;
  private seq = 0;

  constructor(options?: ParseCursorOptions) {
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
    if (options?.cursorVersion) {
      this.meta.cursorVersion = options.cursorVersion;
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
        message: "JSON value is not a Cursor event object",
      });
      return;
    }
    this.parsedLineCount += 1;

    const timestamp = asString(value.timestamp) ?? asString(value.createdAt);
    if (timestamp && !this.meta.timestamp) {
      this.meta.timestamp = timestamp;
    }

    const type = asString(value.type);
    if (type === "session_meta") {
      const payload = isRecord(value.payload) ? value.payload : value;
      this.readSessionMeta(payload, timestamp);
      return;
    }
    if (type && IGNORED_TYPES.has(type)) {
      return;
    }

    if (value.role !== undefined || isRecord(value.message) || Array.isArray(value.content)) {
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
    const cursorVersion = asString(payload.cursor_version) ?? asString(payload.cursorVersion);
    if (cursorVersion) {
      this.meta.cursorVersion = cursorVersion;
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

  private readConversationEvent(
    value: Record<string, unknown>,
    timestamp: string | undefined,
    lineNumber: number,
  ): void {
    const model = asString(value.model);
    if (model) {
      this.meta.model = model;
    }
    const cursorVersion = asString(value.cursor_version) ?? asString(value.cursorVersion);
    if (cursorVersion) {
      this.meta.cursorVersion = cursorVersion;
    }
    const cwd =
      asString(value.cwd) ?? asStringArray(value.workspace_roots)?.[0] ?? asString(value.workspace);
    if (cwd && !this.meta.cwd) {
      this.meta.cwd = cwd;
    }
    const conversationId = asString(value.conversation_id) ?? asString(value.session_id);
    if (conversationId && this.meta.sessionId === "cursor-session") {
      this.meta.sessionId = conversationId;
    }

    const message = isRecord(value.message) ? value.message : value;
    const role = value.role ?? message.role;
    const content = message.content ?? value.content;
    if (role === "tool" || asString(message.tool_call_id) || asString(message.toolCallId)) {
      this.readToolResultMessage(message, timestamp, role);
      return;
    }
    if (Array.isArray(content)) {
      this.readContentParts(content, role, timestamp, lineNumber);
      return;
    }
    if (typeof content === "string" || isRecord(content)) {
      this.readTextMessage(role, contentToText(content), timestamp, asString(message.id) ?? asString(value.id));
      return;
    }
    pushUnknown(this.unknownEvents, this.warnings, lineNumber, asString(value.type) ?? "message");
  }

  private readContentParts(
    parts: unknown[],
    role: unknown,
    timestamp: string | undefined,
    lineNumber: number,
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
        this.readToolResultPart(part, timestamp);
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
      originVendor: "cursor",
      ...(timestamp !== undefined ? { createdAt: timestamp } : {}),
      metadata: {
        source: "cursor",
        eventType: "message",
        originalRole: role,
        origin,
        originVendor: "cursor",
        ...(this.meta.cursorVersion !== undefined ? { cursorVersion: this.meta.cursorVersion } : {}),
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
    const normalized = normalizeCursorTool({
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
      originVendor: "cursor",
      toolCalls: [
        {
          id: callId,
          name: normalized.name,
          arguments: normalized.arguments,
        },
      ],
      ...(timestamp !== undefined ? { createdAt: timestamp } : {}),
      metadata: {
        source: "cursor",
        eventType: "tool_use",
        origin: "agent",
        originVendor: "cursor",
        originalName: normalized.originalName,
        ...(typeof normalized.arguments.originalPath === "string"
          ? { originalPath: normalized.arguments.originalPath }
          : {}),
        ...(this.meta.cwd !== undefined ? { cwd: this.meta.cwd } : {}),
        ...(this.meta.cursorVersion !== undefined ? { cursorVersion: this.meta.cursorVersion } : {}),
      },
    });
  }

  private readToolResultPart(part: Record<string, unknown>, timestamp?: string): void {
    const callId =
      asString(part.tool_use_id) ??
      asString(part.tool_call_id) ??
      asString(part.call_id) ??
      asString(part.id) ??
      this.nextId("result");
    const output = contentToText(part.content ?? part.output ?? part.result);
    this.pushToolResult(callId, output, part, timestamp);
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
      originVendor: "cursor",
      toolCallId: callId,
      name,
      ...(timestamp !== undefined ? { createdAt: timestamp } : {}),
      metadata: {
        source: "cursor",
        eventType: "tool_result",
        origin: "tool",
        originVendor: "cursor",
        ...(isError ? { isError: true } : {}),
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(this.meta.cursorVersion !== undefined ? { cursorVersion: this.meta.cursorVersion } : {}),
      },
    });
  }

  result(): CursorParseResult {
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

export async function parseCursorJsonl(
  input: CursorTranscriptInput,
  options?: ParseCursorOptions,
): Promise<CursorParseResult> {
  const parser = new CursorParser({
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

export const defaultCursorAdapter: CursorAdapter = {
  async parseTranscript(input: CursorTranscriptInput): Promise<Transcript> {
    const parsed = await parseCursorJsonl(input);
    return parsed.transcript;
  },
};

export async function parseTranscript(input: CursorTranscriptInput): Promise<Transcript> {
  return defaultCursorAdapter.parseTranscript(input);
}
