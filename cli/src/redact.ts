import { homedir } from "node:os";

const SECRETISH =
  /\b(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+\S+|JEV_API_KEY|TYPESAFE_API_KEY)\b/gi;

function sanitizeText(text: string): string {
  const home = process.env.HOME ?? homedir();
  const withoutHome = home ? text.split(home).join("~") : text;
  return withoutHome.replace(SECRETISH, "[redacted]");
}

export function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "command failed";
  return sanitizeText(raw);
}

export function sanitizeDebug(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeText(error.stack ?? error.message);
  }
  return sanitizeText(String(error));
}

export function isDebugEnabled(argv: string[] = process.argv): boolean {
  return argv.includes("--debug") || process.env.CONTEXT_ENGINE_DEBUG === "1";
}
