import type { ContextItem } from "./types.js";

export const CONSTRAINT_RE =
  /\b(always|never|must not|must\b|do not|don't|dont\b|constraint|under no circumstances|requirement:|important:)\b/i;

export const ACK_RE =
  /^(ok(ay)?|k|thanks|thank you|yes|yep|yeah|continue|go ahead|please continue|got it|cool|sure|sounds good)[.!\s]*$/i;

export function isAck(content: string): boolean {
  return ACK_RE.test(content.trim());
}

export function isConstraintText(content: string): boolean {
  return CONSTRAINT_RE.test(content);
}

export function isConstraintMessage(item: ContextItem): boolean {
  if (item.kind !== "message" || item.role !== "user") {
    return false;
  }
  if (item.metadata?.["constraint"] === true || item.metadata?.["protect"] === true) {
    return true;
  }
  return isConstraintText(item.content);
}
