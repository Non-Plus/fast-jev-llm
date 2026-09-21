import type { ContextItem, ContextMessage, Transcript } from "../src/types.js";

export function makeItem(
  partial: Partial<ContextItem> & Pick<ContextItem, "id">,
): ContextItem {
  return {
    kind: "message",
    content: "",
    tokenCount: 0,
    messageIds: [],
    ...partial,
  };
}

export function makeToolItem(
  id: string,
  tool: NonNullable<ContextItem["tool"]>,
  content = "",
  tokenCount = 10,
): ContextItem {
  return makeItem({
    id,
    kind: "tool_pair",
    content,
    tokenCount,
    tool,
    messageIds: [id],
  });
}

export function message(
  id: string,
  role: ContextMessage["role"],
  content: string,
  extra?: Partial<ContextMessage>,
): ContextMessage {
  return { id, role, content, ...extra };
}

export function transcript(messages: ContextMessage[], sessionId = "test"): Transcript {
  return { sessionId, messages };
}
