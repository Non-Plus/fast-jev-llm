import type { ContextItem, EngineConfig } from "./types.js";

const HEAD_CHARS = 400;
const TAIL_CHARS = 200;

export function deterministicCompress(item: ContextItem, config: EngineConfig): string {
  const original = item.content;
  const label = item.tool
    ? `${item.tool.kind}${item.tool.path ? ` ${item.tool.path}` : ""}${item.tool.command ? ` \`${item.tool.command}\`` : ""}`
    : item.kind;
  const header = `[compressed ${label} | original ${item.tokenCount} tokens, threshold ${config.largeOutputTokens}]`;

  if (original.length <= HEAD_CHARS + TAIL_CHARS + 80) {
    return `${header}\n${original}`;
  }

  const head = original.slice(0, HEAD_CHARS);
  const tail = original.slice(-TAIL_CHARS);
  return `${header}\n${head}\n...\n${tail}`;
}
