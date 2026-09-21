import { compact, MockSemanticProvider } from "@fast-jev/core";
import { describe, expect, it } from "vitest";
import { analyzeCursorSession } from "../src/analyze.js";
import { parseCursorJsonl } from "../src/parser.js";
import { fixturePath } from "./helpers.js";

describe("Cursor privacy", () => {
  it("keeps default analysis local with semantic mode off", async () => {
    const provider = new MockSemanticProvider({ defaultResponse: { action: "DROP" } });
    const result = await analyzeCursorSession(fixturePath("privacy-env.jsonl"), {
      config: { semanticMode: "off", recentItemCount: 0 },
      semanticProvider: provider,
    });
    expect(result.semantic?.mode).toBe("off");
    expect(provider.calls).toHaveLength(0);
    expect(result.source).toBe("cursor");
  });

  it("does not send Cursor .env secrets to a remote provider", async () => {
    const token = `sk-${"a".repeat(24)}`;
    const provider = new MockSemanticProvider({ defaultResponse: { action: "DROP" } });
    const parsed = await parseCursorJsonl(fixturePath("privacy-env.jsonl"));
    const result = await compact(parsed.transcript, {
      config: { semanticMode: "remote", recentItemCount: 0 },
      semanticProvider: provider,
    });
    const envItem = result.items.find((item) => item.tool?.path === ".env" || item.tool?.normalizedPath === ".env");
    expect(envItem?.semanticEligibility).toBe("forbidden");
    expect(JSON.stringify(provider.calls).includes(token)).toBe(false);
    expect(
      provider.calls.some((call) => call.candidates.some((candidate) => candidate.itemId === envItem?.id)),
    ).toBe(false);
    expect(parsed.transcript.messages.some((message) => message.content.toString().includes(token))).toBe(true);
  });

  it("applies the same redaction gate through analyzeCursorSession", async () => {
    const token = `sk-${"a".repeat(24)}`;
    const provider = new MockSemanticProvider({ defaultResponse: { action: "KEEP" } });
    const result = await analyzeCursorSession(fixturePath("privacy-env.jsonl"), {
      config: { semanticMode: "remote", recentItemCount: 0 },
      semanticProvider: provider,
    });
    expect(result.semantic?.mode).toBe("remote");
    expect(JSON.stringify(provider.calls).includes(token)).toBe(false);
    const env = result.items.find((item) => item.toolName === "Read");
    expect(env?.semanticEligibility).toBe("forbidden");
  });
});
