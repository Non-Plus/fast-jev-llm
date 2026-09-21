import type { ContextItem, ContextMessage, MessageOrigin } from "./types.js";

const PLUGIN_MARKERS = [
  /<recommended_plugins>/i,
  /<installed_plugins>/i,
  /plugins that are available but not installed/i,
  /\bplugin[-_]?generated\b/i,
];

export function isPluginContent(text: string, metadata?: Record<string, unknown>): boolean {
  if (metadata?.["origin"] === "plugin" || metadata?.["sourceKind"] === "plugin") {
    return true;
  }
  const vendor = metadata?.["originVendor"];
  if (typeof vendor === "string" && /plugin/i.test(vendor)) {
    return true;
  }
  return PLUGIN_MARKERS.some((marker) => marker.test(text));
}

export function inferOrigin(
  message: Pick<ContextMessage, "role" | "content" | "origin" | "originVendor" | "metadata">,
): { origin: MessageOrigin; originVendor?: string } {
  const text = typeof message.content === "string" ? message.content : "";
  const vendor = message.originVendor ?? asVendor(message.metadata);
  if (isPluginContent(text, message.metadata)) {
    return { origin: "plugin", ...(vendor !== undefined ? { originVendor: vendor } : {}) };
  }

  if (message.origin) {
    return {
      origin: message.origin,
      ...(message.originVendor !== undefined
        ? { originVendor: message.originVendor }
        : vendor !== undefined
          ? { originVendor: vendor }
          : {}),
    };
  }
  const metaOrigin = message.metadata?.["origin"];
  if (
    metaOrigin === "user" ||
    metaOrigin === "developer" ||
    metaOrigin === "system" ||
    metaOrigin === "tool" ||
    metaOrigin === "plugin" ||
    metaOrigin === "agent" ||
    metaOrigin === "unknown"
  ) {
    return {
      origin: metaOrigin,
      ...(vendor !== undefined ? { originVendor: vendor } : {}),
    };
  }
  if (message.role === "user") {
    return { origin: "user", ...(vendor !== undefined ? { originVendor: vendor } : {}) };
  }
  if (message.role === "tool") {
    return { origin: "tool", ...(vendor !== undefined ? { originVendor: vendor } : {}) };
  }
  if (message.role === "assistant") {
    return { origin: "agent", ...(vendor !== undefined ? { originVendor: vendor } : {}) };
  }
  const originalRole = message.metadata?.["originalRole"];
  if (originalRole === "developer") {
    return { origin: "developer", ...(vendor !== undefined ? { originVendor: vendor } : {}) };
  }
  if (message.role === "system") {
    return { origin: "system", ...(vendor !== undefined ? { originVendor: vendor } : {}) };
  }
  return { origin: "unknown", ...(vendor !== undefined ? { originVendor: vendor } : {}) };
}

function asVendor(metadata?: Record<string, unknown>): string | undefined {
  const vendor = metadata?.["originVendor"] ?? metadata?.["vendor"] ?? metadata?.["source"];
  return typeof vendor === "string" && vendor.length > 0 ? vendor : undefined;
}

export function itemLooksLikeSafetyInstruction(item: ContextItem): boolean {
  if (item.kind !== "message") {
    return false;
  }
  if (item.origin === "plugin") {
    return false;
  }
  return item.origin === "system" || item.origin === "developer" || item.role === "system";
}
