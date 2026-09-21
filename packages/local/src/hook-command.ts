import { HOOK_MARKER } from "./types.js";
import type { AgentId } from "./types.js";

export function isOurHookCommand(command: unknown): boolean {
  return typeof command === "string" && command.includes(HOOK_MARKER);
}

export function hookInvocation(hookCommand: string, agent: AgentId): string {
  return `${hookCommand} hook ${agent} ${HOOK_MARKER}`.trim();
}

export function resolveHookCommand(explicit?: string): string {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const argv1 = process.argv[1];
  if (argv1 && argv1.length > 0) {
    if (argv1.endsWith(".ts")) {
      return `${process.execPath} --import tsx ${argv1}`;
    }
    return `${process.execPath} ${argv1}`;
  }
  return "ctx";
}
