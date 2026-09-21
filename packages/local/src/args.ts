import type { AgentId } from "./types.js";
import { AGENTS } from "./types.js";

export function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

export function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

export function parseAgent(raw: string | undefined): AgentId | undefined {
  if (!raw) {
    return undefined;
  }
  if (raw === "codex" || raw === "cursor" || raw === "claude") {
    return raw;
  }
  throw new Error(`Unknown agent: ${raw}. Use codex, cursor, or claude.`);
}

export function parseAgentList(raw: string | undefined): AgentId[] {
  if (!raw || raw.trim().length === 0) {
    return [...AGENTS];
  }
  return raw.split(",").map((part) => parseAgent(part.trim())!);
}

export function parseOlderThan(raw: string): number {
  const match = /^(\d+)(d|h|m)$/.exec(raw.trim());
  if (!match) {
    throw new Error("--older-than must look like 30d, 12h, or 15m");
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "d") {
    return amount * 24 * 60 * 60 * 1000;
  }
  if (unit === "h") {
    return amount * 60 * 60 * 1000;
  }
  return amount * 60 * 1000;
}

export function parseLimit(raw: string | undefined, fallback = 20): number {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("--limit must be a positive integer");
  }
  return value;
}

export function parseDays(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("--days must be a positive integer");
  }
  return value;
}
