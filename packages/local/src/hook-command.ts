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
  const fromEnv = process.env.CONTEXT_ENGINE_HOOK_COMMAND;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  const argv1 = process.argv[1];
  if (argv1 && argv1.endsWith(".ts")) {
    return `${process.execPath} --import tsx ${argv1}`;
  }
  return "ctx";
}
