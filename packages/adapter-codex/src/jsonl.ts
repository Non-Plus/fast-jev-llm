import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { Readable as NodeReadable } from "node:stream";
import type { CodexTranscriptInput } from "./types.js";

export interface JsonlLine {
  lineNumber: number;
  raw: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function inputToStream(input: CodexTranscriptInput): {
  stream: Readable;
  sourcePath?: string;
} {
  if (typeof input === "string") {
    return { stream: createReadStream(input, { encoding: "utf8" }), sourcePath: input };
  }
  if (input instanceof URL) {
    const path = input.protocol === "file:" ? input.pathname : input.toString();
    return { stream: createReadStream(input, { encoding: "utf8" }), sourcePath: path };
  }
  if (isRecord(input) && "path" in input && typeof input.path === "string") {
    return {
      stream: createReadStream(input.path, { encoding: "utf8" }),
      sourcePath: input.path,
    };
  }
  if (isRecord(input) && "text" in input && typeof input.text === "string") {
    return { stream: NodeReadable.from([input.text]) };
  }
  if (isRecord(input) && "stream" in input) {
    return { stream: input.stream as Readable };
  }
  throw new Error("Codex JSONL input is not streamable");
}

export async function* readJsonlLines(
  input: Exclude<CodexTranscriptInput, { readonly events: readonly unknown[] }>,
): AsyncGenerator<JsonlLine> {
  const { stream } = inputToStream(input);
  try {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of rl) {
      lineNumber += 1;
      const raw = lineNumber === 1 ? line.replace(/^\uFEFF/, "") : line;
      yield { lineNumber, raw };
    }
  } finally {
    stream.destroy();
  }
}

export function sourcePathOf(input: CodexTranscriptInput): string | undefined {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL && input.protocol === "file:") {
    return input.pathname;
  }
  if (isRecord(input) && "path" in input && typeof input.path === "string") {
    return input.path;
  }
  return undefined;
}

export function isEventListInput(
  input: CodexTranscriptInput,
): input is { readonly events: readonly unknown[] } {
  return isRecord(input) && "events" in input && Array.isArray(input.events);
}

export type ParsedJsonLine =
  | { kind: "empty" }
  | { kind: "error"; error: string }
  | { kind: "value"; value: unknown };

export function parseJsonLine(raw: string): ParsedJsonLine {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { kind: "empty" };
  }
  try {
    return { kind: "value", value: JSON.parse(trimmed) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    return { kind: "error", error: message };
  }
}
