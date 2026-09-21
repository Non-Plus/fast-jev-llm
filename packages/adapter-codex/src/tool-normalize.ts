import { classifyTool, parseArguments } from "@fast-jev/core";
import { normalizeProjectPath, preferCanonicalPath } from "./path-normalize.js";

const WRAPPER_PREFIXES = /^(rtk|sudo|time|nice|command|env)\s+/;

const STRING_FIELD_KEYS = [
  "cmd",
  "command",
  "script",
  "input",
  "path",
  "file",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "filename",
  "workdir",
  "working_directory",
  "workingDirectory",
  "cwd",
  "patch",
] as const;

const TOOL_CALL_NAMES = [
  "exec_command",
  "shell_command",
  "apply_patch",
  "exec",
  "shell",
];

export interface NormalizedCodexTool {
  name: string;
  arguments: Record<string, unknown>;
  originalName: string;
}

function unescapeString(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function sliceBalanced(
  source: string,
  openIndex: number,
  openChar: "{" | "(" | "[",
): string | undefined {
  const closeChar = openChar === "{" ? "}" : openChar === "(" ? ")" : "]";
  let depth = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex, i + 1);
      }
    }
  }
  return undefined;
}

function extractStringFields(objectLiteral: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of STRING_FIELD_KEYS) {
    const re = new RegExp(
      `(?:["']?${key}["']?)\\s*:\\s*(["'\`])([\\s\\S]*?)\\1`,
    );
    const match = objectLiteral.match(re);
    const value = match?.[2];
    if (value !== undefined) {
      fields[key] = unescapeString(value);
    }
  }
  return fields;
}

function extractJsToolCall(
  source: string,
): { name: string; fields: Record<string, string> } | undefined {
  for (const name of TOOL_CALL_NAMES) {
    const re = new RegExp(`(?:tools\\.)?${name}\\s*\\(`, "i");
    const match = re.exec(source);
    if (!match || match.index === undefined) {
      continue;
    }
    const openParen = source.indexOf("(", match.index + match[0].length - 1);
    if (openParen < 0) {
      continue;
    }
    const call = sliceBalanced(source, openParen, "(");
    if (!call) {
      continue;
    }
    const inner = call.slice(1, -1).trim();
    if (inner.startsWith("{")) {
      const object = sliceBalanced(inner, 0, "{");
      if (object) {
        return { name, fields: extractStringFields(object) };
      }
    }
    const quoted = inner.match(/^(["'`])([\s\S]*)\1\s*$/);
    if (quoted?.[2] !== undefined) {
      const value = unescapeString(quoted[2]);
      return {
        name,
        fields: name === "apply_patch" ? { patch: value } : { command: value },
      };
    }
  }
  return undefined;
}

export function unwrapCommand(command: string): string {
  let current = command.trim().replace(/\s+/g, " ");
  for (let i = 0; i < 4; i += 1) {
    const next = current.replace(WRAPPER_PREFIXES, "").trim();
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
}

const PATCH_FILE_RE =
  /^\*\*\*\s+(?:Begin Patch|Update File|Add File|Delete File):\s*(.+)$/m;

export function pathFromPatch(patch: string): string | undefined {
  const match = PATCH_FILE_RE.exec(patch);
  const path = match?.[1]?.trim();
  return path && path.length > 0 ? path : undefined;
}

function firstString(
  args: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

export function normalizeCodexTool(input: {
  name: string;
  rawArguments: unknown;
  cwd?: string;
}): NormalizedCodexTool {
  const originalName = input.name;
  let args: Record<string, unknown> = {};
  if (typeof input.rawArguments === "string") {
    const jsCall = extractJsToolCall(input.rawArguments);
    if (jsCall) {
      args = { ...jsCall.fields };
      if (jsCall.name === "apply_patch" && !args.patch && input.rawArguments) {
        args.patch = input.rawArguments;
      }
    } else {
      args = parseArguments(input.rawArguments);
    }
  } else if (input.rawArguments && typeof input.rawArguments === "object") {
    args = parseArguments(input.rawArguments as Record<string, unknown>);
  }

  const command = firstString(args, ["command", "cmd", "script"]);
  if (command) {
    const unwrapped = unwrapCommand(command);
    args.command = unwrapped;
    args.cmd = unwrapped;
    if (unwrapped !== command) {
      args.wrappedCommand = command;
    }
  }

  const patch = firstString(args, ["patch"]);
  const classified = classifyTool(originalName, args);
  const rawPath =
    firstString(args, [
      "path",
      "file",
      "file_path",
      "filePath",
      "target_file",
      "targetFile",
      "filename",
    ]) ??
    classified.path ??
    (patch ? pathFromPatch(patch) : undefined);

  if (rawPath) {
    const normalized = normalizeProjectPath(rawPath, input.cwd);
    args.originalPath = normalized?.original ?? rawPath;
    const canonical = preferCanonicalPath(normalized);
    if (canonical) {
      args.path = canonical;
    }
    if (normalized?.outsideRepo) {
      args.pathOutsideRepo = true;
    }
  }

  const workdir = firstString(args, ["workdir", "working_directory", "workingDirectory", "cwd"]);
  if (workdir) {
    args.workdir = workdir;
  }

  return {
    name: originalName,
    originalName,
    arguments: args,
  };
}
