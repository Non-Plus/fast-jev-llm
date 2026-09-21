import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { ContextItem, ToolMeta } from "./types.js";

export function normalizePath(path: string): string {
  const replaced = path.replace(/\\/g, "/").trim();
  const normalized = posix.normalize(replaced);
  if (normalized !== "/" && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function fileContent(tool: ToolMeta): string | undefined {
  if (tool.kind === "file_read") {
    return tool.result;
  }
  if (tool.kind === "file_write") {
    for (const key of ["contents", "content", "new_string", "newString"]) {
      const value = tool.args[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    return tool.result;
  }
  return undefined;
}

export function itemPath(item: ContextItem): string | undefined {
  const raw = item.tool?.normalizedPath ?? item.tool?.path;
  if (!raw) {
    return undefined;
  }
  return normalizePath(raw);
}

export function annotateFileState(items: ContextItem[]): void {
  const lastReadIndex = new Map<string, number>();
  const lastWriteIndex = new Map<string, number>();

  items.forEach((item, index) => {
    if (!item.tool) {
      return;
    }
    if (item.tool.kind !== "file_read" && item.tool.kind !== "file_write") {
      return;
    }
    const path = itemPath(item);
    if (!path) {
      return;
    }
    item.tool.normalizedPath = path;
    item.tool.operationIndex = index;
    const content = fileContent(item.tool);
    if (content !== undefined) {
      item.tool.contentHash = contentHash(content);
    }

    if (item.tool.kind === "file_write") {
      lastWriteIndex.set(path, index);
      return;
    }

    const previousRead = lastReadIndex.get(path);
    const previousWrite = lastWriteIndex.get(path);
    item.tool.writeBetweenReads =
      previousRead !== undefined &&
      previousWrite !== undefined &&
      previousWrite > previousRead &&
      previousWrite < index;
    lastReadIndex.set(path, index);
  });
}
