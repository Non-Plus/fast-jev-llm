import { createHash } from "node:crypto";
import { basename } from "node:path";

export function normalizeWorkspacePath(input: string | undefined): string | undefined {
  if (!input || input.trim().length === 0) {
    return undefined;
  }
  let path = input.trim().replace(/\\/g, "/");
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

export function workspaceId(path: string | undefined): string {
  const normalized = normalizeWorkspacePath(path) ?? "unknown";
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function workspaceDisplayName(path: string | undefined): string | undefined {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized) {
    return undefined;
  }
  const name = basename(normalized);
  return name.length > 0 ? name : undefined;
}
