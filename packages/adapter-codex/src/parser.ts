import type { ContextMessage, MessageOrigin, MessageRole, Transcript } from "@fast-jev/core";
import {
  isEventListInput,
  parseJsonLine,
  readJsonlLines,
  sourcePathOf,
} from "./jsonl.js";
import { normalizeCodexTool } from "./tool-normalize.js";
import type {
  CodexAdapter,
  CodexParseResult,
  CodexParseWarning,
  CodexSessionMeta,
  CodexTranscriptInput,
  CodexUnknownEvent,
} from "./types.js";

const RESPONSE_ITEM_TYPES = new Set([
  "message",
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
]);

const IGNORED_ENVELOPE_TYPES = new Set([
  "event_msg",
  "token_usage_record",
  "world_state",
]);

const IGNORED_RESPONSE_TYPES = new Set(["reasoning", "compaction"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
        if (typeof part.text === "string") {
          return part.text;
        }
        if (typeof part.output === "string") {
          return part.output;
        }
        return "";
      })
      .join("");
  }
  if (isRecord(content) && typeof content.text === "string") {
    return content.text;
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

function envelopeOf(
  value: unknown,
): { type: string; payload: unknown; timestamp?: string } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.type === "string" && "payload" in value) {
    return {
      type: value.type,
      payload: value.payload,
      timestamp: asString(value.timestamp),
    };
  }
  if (typeof value.type === "string") {
    return { type: "response_item", payload: value, timestamp: asString(value.timestamp) };
  }
  return undefined;
}

function pushUnknown(
  unknownEvents: CodexUnknownEvent[],
  warnings: CodexParseWarning[],
  lineNumber: number,
  type: string,
  payloadType?: string,
): void {
  unknownEvents.push({
    lineNumber,
    type,
    ...(payloadType !== undefined ? { payloadType } : {}),
  });
  warnings.push({
    lineNumber,
    kind: "unknown_event",
    message: payloadType ? `Unknown event ${type}/${payloadType}` : `Unknown event ${type}`,
    eventType: type,
    ...(payloadType !== undefined ? { payloadType } : {}),
  });
}

class CodexParser {
  readonly meta: CodexSessionMeta = { sessionId: "codex-session" };
  readonly warnings: CodexParseWarning[] = [];
  readonly unknownEvents: CodexUnknownEvent[] = [];
  readonly messages: ContextMessage[] = [];
  readonly pendingCallNames = new Map<string, string>();
  lineCount = 0;
  parsedLineCount = 0;
  malformedLineCount = 0;
  private seq = 0;

  constructor(sourcePath?: string) {
    if (sourcePath) {
      this.meta.sourcePath = sourcePath;
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
    const envelope = envelopeOf(value);
    if (!envelope) {
      this.malformedLineCount += 1;
      this.warnings.push({
        lineNumber,
        kind: "malformed_line",
        message: "JSON value is not a Codex event object",
      });
      return;
    }
    this.parsedLineCount += 1;
    const payload = isRecord(envelope.payload) ? envelope.payload : undefined;
    const payloadType = asString(payload?.type);

    if (envelope.timestamp && !this.meta.timestamp) {
      this.meta.timestamp = envelope.timestamp;
    }

    switch (envelope.type) {
      case "session_meta":
        this.readSessionMeta(payload, envelope.timestamp);
        return;
      case "turn_context":
        this.readTurnContext(payload);
        return;
      case "response_item":
        this.readResponseItem(payload, envelope.timestamp, lineNumber);
        return;
      default:
        if (IGNORED_ENVELOPE_TYPES.has(envelope.type)) {
          return;
        }
        pushUnknown(this.unknownEvents, this.warnings, lineNumber, envelope.type, payloadType);
    }
  }

  private readSessionMeta(payload: Record<string, unknown> | undefined, timestamp?: string): void {
    if (!payload) {
      return;
    }
    const sessionId = asString(payload.session_id) ?? asString(payload.id);
    if (sessionId) {
      this.meta.sessionId = sessionId;
    }
    const ts = asString(payload.timestamp) ?? timestamp;
    if (ts) {
      this.meta.timestamp = ts;
    }
    const cwd = asString(payload.cwd);
    if (cwd) {
      this.meta.cwd = cwd;
    }
    const cliVersion = asString(payload.cli_version);
    if (cliVersion) {
      this.meta.cliVersion = cliVersion;
    }
    const originator = asString(payload.originator);
    if (originator) {
      this.meta.originator = originator;
    }
    const model = asString(payload.model);
    if (model) {
      this.meta.model = model;
    }
  }

  private readTurnContext(payload: Record<string, unknown> | undefined): void {
    if (!payload) {
      return;
    }
    const cwd = asString(payload.cwd);
    if (cwd) {
      this.meta.cwd = cwd;
    }
    const model = asString(payload.model);
    if (model) {
      this.meta.model = model;
    }
  }

  private readResponseItem(
    payload: Record<string, unknown> | undefined,
    timestamp: string | undefined,
    lineNumber: number,
  ): void {
    if (!payload) {
      pushUnknown(this.unknownEvents, this.warnings, lineNumber, "response_item");
      return;
    }
    const payloadType = asString(payload.type) ?? "unknown";
    if (IGNORED_RESPONSE_TYPES.has(payloadType)) {
      return;
    }
    if (!RESPONSE_ITEM_TYPES.has(payloadType)) {
      pushUnknown(this.unknownEvents, this.warnings, lineNumber, "response_item", payloadType);
      return;
    }
    if (payloadType === "message") {
      this.readMessage(payload, timestamp);
      return;
    }
    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      this.readToolCall(payload, timestamp, payloadType);
      return;
    }
    this.readToolResult(payload, timestamp, payloadType);
  }

  private readMessage(payload: Record<string, unknown>, timestamp?: string): void {
    const text = contentToText(payload.content);
    const role = mapRole(payload.role);
    const origin = messageOrigin(payload.role);
    const id = this.nextId("msg", asString(payload.id));
    const createdAt = timestamp;
    this.messages.push({
      id,
      role,
      content: text,
      origin,
      originVendor: "codex",
      ...(createdAt !== undefined ? { createdAt } : {}),
      metadata: {
        source: "codex",
        eventType: "message",
        originalRole: payload.role,
        origin,
        originVendor: "codex",
      },
    });
  }

  private readToolCall(
    payload: Record<string, unknown>,
    timestamp: string | undefined,
    eventType: string,
  ): void {
    const callId =
      asString(payload.call_id) ?? asString(payload.id) ?? this.nextId("call");
    const name =
      asString(payload.name) ??
      asString(payload.tool_name) ??
      (eventType === "custom_tool_call" ? "exec" : "tool");
    const rawArguments = payload.arguments ?? payload.input ?? payload.params ?? {};
    const normalized = normalizeCodexTool({
      name,
      rawArguments,
      cwd: this.meta.cwd,
    });
    this.pendingCallNames.set(callId, normalized.name);
    const id = this.nextId("call", asString(payload.id) ?? callId);
    this.messages.push({
      id,
      role: "assistant",
      content: "",
      origin: "agent",
      originVendor: "codex",
      toolCalls: [
        {
          id: callId,
          name: normalized.name,
          arguments: normalized.arguments,
        },
      ],
      ...(timestamp !== undefined ? { createdAt: timestamp } : {}),
      metadata: {
        source: "codex",
        eventType,
        origin: "agent",
        originVendor: "codex",
        originalName: normalized.originalName,
        ...(typeof normalized.arguments.originalPath === "string"
          ? { originalPath: normalized.arguments.originalPath }
          : {}),
        ...(this.meta.cwd !== undefined ? { cwd: this.meta.cwd } : {}),
        namespace: asString(payload.namespace),
      },
    });
  }

  private readToolResult(
    payload: Record<string, unknown>,
    timestamp: string | undefined,
    eventType: string,
  ): void {
    const callId =
      asString(payload.call_id) ?? asString(payload.id) ?? this.nextId("result");
    const output = contentToText(payload.output ?? payload.content ?? payload.result);
    const name =
      asString(payload.name) ?? this.pendingCallNames.get(callId) ?? "unknown";
    const isError =
      payload.is_error === true ||
      payload.isError === true ||
      (typeof payload.status === "string" && payload.status === "failed");
    const exitCode = typeof payload.exit_code === "number"
      ? payload.exit_code
      : typeof payload.exitCode === "number"
        ? payload.exitCode
        : undefined;
    const id = this.nextId("result", asString(payload.id) ?? `result_${callId}`);
    this.messages.push({
      id,
      role: "tool",
      content: output,
      origin: "tool",
      originVendor: "codex",
      toolCallId: callId,
      name,
      ...(timestamp !== undefined ? { createdAt: timestamp } : {}),
      metadata: {
        source: "codex",
        eventType,
        origin: "tool",
        originVendor: "codex",
        ...(isError ? { isError: true } : {}),
        ...(exitCode !== undefined ? { exitCode } : {}),
      },
    });
  }

  result(): CodexParseResult {
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

export async function parseCodexJsonl(
  input: CodexTranscriptInput,
): Promise<CodexParseResult> {
  const parser = new CodexParser(sourcePathOf(input));
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

export const defaultCodexAdapter: CodexAdapter = {
  async parseTranscript(input: CodexTranscriptInput): Promise<Transcript> {
    const parsed = await parseCodexJsonl(input);
    return parsed.transcript;
  },
};

export async function parseTranscript(input: CodexTranscriptInput): Promise<Transcript> {
  return defaultCodexAdapter.parseTranscript(input);
}
