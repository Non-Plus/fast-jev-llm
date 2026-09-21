import { classifyTool, parseArguments } from "@fast-jev/core";
import {
  directoryFromGlob,
  normalizeProjectPath,
  preferCanonicalPath,
} from "./path-normalize.js";

const WRAPPER_PREFIXES = /^(rtk|sudo|time|nice|command|env)\s+/;

export interface NormalizedClaudeTool {
  name: string;
  arguments: Record<string, unknown>;
  originalName: string;
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

function globDirectory(args: Record<string, unknown>): string | undefined {
  const explicit = firstString(args, ["target_directory", "targetDirectory", "path"]);
  if (explicit) {
    return explicit;
  }
  const pattern = firstString(args, ["glob_pattern", "glob", "pattern"]);
  if (!pattern) {
    return undefined;
  }
  return directoryFromGlob(pattern);
}

export function normalizeClaudeTool(input: {
  name: string;
  rawArguments: unknown;
  cwd?: string;
}): NormalizedClaudeTool {
  const originalName = input.name;
  let args: Record<string, unknown> = {};
  if (typeof input.rawArguments === "string") {
    args = parseArguments(input.rawArguments);
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

  const classified = classifyTool(originalName, args);
  const rawPath =
    classified.kind === "directory_list"
      ? globDirectory(args) ?? classified.path
      : firstString(args, [
          "path",
          "file",
          "file_path",
          "filePath",
          "target_file",
          "targetFile",
          "filename",
        ]) ?? classified.path;

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

  const workdir = firstString(args, [
    "workdir",
    "working_directory",
    "workingDirectory",
    "cwd",
  ]);
  if (workdir) {
    args.workdir = workdir;
  }

  return {
    name: originalName,
    originalName,
    arguments: args,
  };
}
