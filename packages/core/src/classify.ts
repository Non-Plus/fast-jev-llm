import type { ToolKind } from "./types.js";

const FILE_READ_NAMES = new Set([
  "read",
  "read_file",
  "readfile",
  "cat",
  "get_file_contents",
  "get_file",
  "view",
  "open_file",
]);

const FILE_WRITE_NAMES = new Set([
  "write",
  "write_file",
  "writefile",
  "create_file",
  "edit",
  "str_replace",
  "strreplace",
  "apply_patch",
  "applypatch",
]);

const DIR_NAMES = new Set([
  "ls",
  "glob",
  "list_dir",
  "list_directory",
  "listdir",
  "glob_file_search",
]);

const TEST_NAMES = new Set([
  "test",
  "run_test",
  "run_tests",
  "vitest",
  "jest",
  "pytest",
]);

const SHELL_NAMES = new Set([
  "bash",
  "shell",
  "sh",
  "zsh",
  "cmd",
  "command",
  "terminal",
  "run_terminal_cmd",
  "execute",
  "exec",
]);

const GIT_STATUS_RE = /^git\s+status\b/;
const GIT_DIFF_RE = /^git\s+diff\b/;
const FILE_READ_CMD_RE = /^(cat|head|tail|less|more|bat|type)\b/;
const DIR_CMD_RE = /^(ls|dir|tree|find|fd|glob)\b/;
const TEST_CMD_RE =
  /\b((npm|pnpm|yarn)\s+(run\s+)?test(\b|:)|(npx\s+)?vitest\b|\bjest\b|\bpytest\b|\bmocha\b|\bcargo\s+test\b|\bgo\s+test\b|\bplaywright\s+test\b)/;

const PATH_KEYS = [
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "filename",
  "file",
  "target",
  "glob",
  "pattern",
  "target_directory",
  "targetDirectory",
] as const;

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function parseArguments(
  args: Record<string, unknown> | string,
): Record<string, unknown> {
  if (typeof args !== "string") {
    return args;
  }

  const trimmed = args.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { _raw: args };
    }
  }

  return { command: args };
}

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

export function extractCommand(args: Record<string, unknown>): string | undefined {
  for (const key of ["command", "cmd", "script", "input"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return normalizeCommand(value);
    }
  }
  return undefined;
}

export function extractPath(args: Record<string, unknown>): string | undefined {
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function tokenize(command: string): string[] {
  return (
    command
      .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
      ?.map((token) => token.replace(/^["']|["']$/g, "")) ?? []
  );
}

export function pathFromCommand(command: string | undefined): string | undefined {
  if (!command) {
    return undefined;
  }
  const parts = tokenize(command);
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const part = parts[i];
    if (!part || part.startsWith("-")) {
      continue;
    }
    return part;
  }
  return undefined;
}

export function extractTestTarget(
  args: Record<string, unknown>,
  command?: string,
): string {
  for (const key of ["testTarget", "target", "file", "path", "testPath"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  if (command) {
    const match = command.match(/(\S+\.(?:test|spec)\.\w+)/);
    if (match?.[1]) {
      return match[1];
    }
    return normalizeCommand(command);
  }
  return "tests";
}

export interface ClassifiedTool {
  kind: ToolKind;
  path?: string;
  command?: string;
  testTarget?: string;
}

export function classifyTool(
  name: string,
  args: Record<string, unknown>,
): ClassifiedTool {
  const n = normalizeName(name);
  const command = extractCommand(args);
  const path = extractPath(args);

  if (n === "git_status" || (command && GIT_STATUS_RE.test(command))) {
    return { kind: "git_status", command, path };
  }
  if (n === "git_diff" || (command && GIT_DIFF_RE.test(command))) {
    return { kind: "git_diff", command, path };
  }
  if (FILE_WRITE_NAMES.has(n)) {
    return { kind: "file_write", path, command };
  }
  if (FILE_READ_NAMES.has(n) || (command && FILE_READ_CMD_RE.test(command))) {
    return {
      kind: "file_read",
      path: path ?? pathFromCommand(command),
      command,
    };
  }
  if (DIR_NAMES.has(n) || (command && DIR_CMD_RE.test(command))) {
    return {
      kind: "directory_list",
      path: path ?? pathFromCommand(command) ?? ".",
      command,
    };
  }
  if (TEST_NAMES.has(n) || (command && TEST_CMD_RE.test(command))) {
    return {
      kind: "test_run",
      command,
      path,
      testTarget: extractTestTarget(args, command),
    };
  }
  if (SHELL_NAMES.has(n) || command) {
    return { kind: "command", command: command ?? n, path };
  }
  return { kind: "other", path, command };
}

const PASS_PATTERNS = [
  /\b0 failed\b/i,
  /\ball tests passed\b/i,
  /\btests?\s+passed\b/i,
  /\bPASS\b/,
];

const FAIL_COUNT_RE = /\b([1-9]\d*)\s+failed\b/i;

export function isTestSuccessFromOutput(output: string): boolean {
  if (FAIL_COUNT_RE.test(output)) {
    return false;
  }
  if (/\bFAIL\b/.test(output) && !/\bPASS\b/.test(output)) {
    return false;
  }
  return PASS_PATTERNS.some((pattern) => pattern.test(output));
}

export function isTestFailureFromOutput(output: string): boolean {
  if (FAIL_COUNT_RE.test(output)) {
    return true;
  }
  if (/\bFAIL\b/.test(output) && !isTestSuccessFromOutput(output)) {
    return true;
  }
  if (/\b(failed|test(?:s)? failed)\b/i.test(output) && !/\b0 failed\b/i.test(output)) {
    return true;
  }
  return false;
}

export function isToolFailure(options: {
  kind: ToolKind;
  isError?: boolean;
  exitCode?: number;
  result?: string;
}): boolean {
  if (options.isError === true) {
    return true;
  }
  if (options.exitCode !== undefined && options.exitCode !== 0) {
    return true;
  }
  if (options.kind === "test_run") {
    return isTestFailureFromOutput(options.result ?? "");
  }
  return false;
}

export function isToolSuccess(options: {
  kind: ToolKind;
  isError?: boolean;
  exitCode?: number;
  result?: string;
}): boolean {
  if (options.isError === true) {
    return false;
  }
  if (options.exitCode === 0) {
    return true;
  }
  if (options.kind === "test_run") {
    return isTestSuccessFromOutput(options.result ?? "");
  }
  return false;
}

export function failureKey(kind: ToolKind, path?: string, command?: string, testTarget?: string): string {
  if (kind === "test_run") {
    return `test:${testTarget ?? command ?? "tests"}`;
  }
  if (kind === "command" && command) {
    return `${kind}:${command}`;
  }
  if (path) {
    return `${kind}:${path}`;
  }
  if (command) {
    return `${kind}:${command}`;
  }
  return kind;
}
