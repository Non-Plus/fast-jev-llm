import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const fixturesDir = fileURLToPath(new URL("../fixtures", import.meta.url));

export function fixturePath(name: string): string {
  return join(fixturesDir, name);
}

export function cursorMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "session_meta",
    session_id: "cursor-session",
    cwd: "/Users/user/project",
    model: "composer",
    cursor_version: "3.21.16",
    observed_wire_format: "cursor-agent-transcript-jsonl-v1",
    ...overrides,
  };
}

export function cursorUser(text: string): Record<string, unknown> {
  return { role: "user", message: { content: [{ type: "text", text }] } };
}

export function cursorAssistant(
  text: string,
  tools: Array<{ id?: string; name: string; input: Record<string, unknown> }> = [],
): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  if (text.length > 0) {
    content.push({ type: "text", text });
  }
  for (const tool of tools) {
    const part: Record<string, unknown> = { type: "tool_use", name: tool.name, input: tool.input };
    if (tool.id) {
      part.id = tool.id;
    }
    content.push(part);
  }
  return { role: "assistant", message: { content } };
}

export function cursorToolResult(
  toolUseId: string,
  content: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    role: "assistant",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content,
          ...extras,
        },
      ],
    },
  };
}

export function conceptualToolKey(item: {
  kind: string;
  toolName?: string;
  command?: string;
  reasonCode?: string;
  action?: string;
}): string {
  return [item.kind, item.toolName ?? "", item.command ?? "", item.action ?? "", item.reasonCode ?? ""].join("|");
}
