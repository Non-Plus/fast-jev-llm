import { describe, expect, it } from "vitest";
import { compact } from "../src/pipeline.js";
import { snapshot } from "../src/freeze.js";
import { message, transcript } from "./helpers.js";
import type { SemanticProvider } from "../src/types.js";

describe("compact pipeline", () => {
  it("never mutates the original transcript", async () => {
    const input = transcript([
      message("sys", "system", "Follow user constraints."),
      message("u1", "user", "Never delete files. Read src/a.ts"),
      {
        id: "a1",
        role: "assistant",
        content: "reading",
        toolCalls: [{ id: "c1", name: "Read", arguments: { path: "src/a.ts" } }],
      },
      { id: "t1", role: "tool", toolCallId: "c1", content: "const a = 1;" },
      {
        id: "a2",
        role: "assistant",
        content: "reading again",
        toolCalls: [{ id: "c2", name: "Read", arguments: { path: "src/a.ts" } }],
      },
      { id: "t2", role: "tool", toolCallId: "c2", content: "const a = 2;" },
    ]);
    const before = snapshot(input);
    await compact(input);
    expect(snapshot(input)).toBe(before);
  });

  it("returns one decision per item with required fields", async () => {
    const result = await compact(
      transcript([
        message("sys", "system", "Be careful."),
        message("u1", "user", "hello"),
      ]),
    );
    expect(result.decisions).toHaveLength(result.items.length);
    for (const decision of result.decisions) {
      expect(["PROTECT", "KEEP", "COMPRESS", "DROP"]).toContain(decision.action);
      expect(decision.reason.length).toBeGreaterThan(0);
      expect(decision.itemId.length).toBeGreaterThan(0);
      expect(decision.rule.length).toBeGreaterThan(0);
      expect(decision.reasonCode.length).toBeGreaterThan(0);
      expect(["safety", "structural", "heuristic", "semantic"]).toContain(decision.authority);
      expect(["protected", "normal"]).toContain(decision.retention);
      expect(["allowed", "forbidden"]).toContain(decision.compression);
    }
    expect(result.decisionRecords).toHaveLength(result.items.length);
    expect(result.evaluations.length).toBeGreaterThan(0);
  });

  it("omits dropped items from compacted output and stubs compressed ones", async () => {
    const huge = "lock-entry\n".repeat(800);
    const result = await compact(
      transcript([
        message("sys", "system", "Stay in this repo."),
        message("u1", "user", "Inspect package-lock.json. Never log secrets."),
        {
          id: "a1",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "Read", arguments: { path: "package-lock.json" } }],
        },
        { id: "t1", role: "tool", toolCallId: "c1", content: huge },
        {
          id: "a2",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c2", name: "Read", arguments: { path: "src/a.ts" } }],
        },
        { id: "t2", role: "tool", toolCallId: "c2", content: "export const a = 1;" },
        {
          id: "a3",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c3", name: "Read", arguments: { path: "src/a.ts" } }],
        },
        { id: "t3", role: "tool", toolCallId: "c3", content: "export const a = 2;" },
        message("u2", "user", "Continue with src/a.ts"),
        message("a4", "assistant", "Using the latest file contents."),
      ]),
      { config: { recentItemCount: 2, largeOutputTokens: 50 } },
    );

    const byId = new Map(result.decisions.map((decision) => [decision.itemId, decision]));
    const lock = result.items.find((item) => item.tool?.path === "package-lock.json");
    expect(lock).toBeDefined();
    expect(byId.get(lock!.id)?.action).toBe("COMPRESS");
    expect(result.compacted.find((item) => item.id === lock!.id)?.content).toContain(
      "[compressed",
    );
    expect(result.compacted.find((item) => item.id === lock!.id)?.tokenCount).toBeLessThan(
      lock!.tokenCount,
    );

    const droppedReads = result.items.filter(
      (item) =>
        item.tool?.kind === "file_read" &&
        item.tool.path === "src/a.ts" &&
        byId.get(item.id)?.action === "DROP",
    );
    expect(droppedReads.length).toBe(1);
    expect(result.compacted.some((item) => item.id === droppedReads[0]?.id)).toBe(false);
  });

  it("lets a semantic provider drop unprotected KEEP items but not PROTECT", async () => {
    const { MockSemanticProvider } = await import("../src/semantic/mock.js");
    const provider = new MockSemanticProvider({
      defaultResponse: { action: "DROP", reason: "provider asked to drop" },
    });

    const result = await compact(
      transcript([
        message("sys", "system", "Standing instructions."),
        message("u1", "user", "Never change public APIs."),
        message("a1", "assistant", "I will inspect the code."),
      ]),
      {
        config: { recentItemCount: 0, semanticMode: "local" },
        semanticProvider: provider,
      },
    );

    const byId = new Map(result.decisions.map((decision) => [decision.itemId, decision]));
    const system = result.items.find((item) => item.role === "system");
    const constraint = result.items.find((item) => item.content.includes("Never change"));
    const assistant = result.items.find((item) => item.role === "assistant");

    expect(byId.get(system!.id)?.action).toBe("PROTECT");
    expect(byId.get(constraint!.id)?.action).toBe("PROTECT");
    expect(byId.get(assistant!.id)).toEqual(
      expect.objectContaining({ action: "DROP", authority: "semantic" }),
    );
  });

  it("uses provider.compress when an item is marked COMPRESS", async () => {
    const provider: SemanticProvider = {
      name: "fake-compressor",
      async compress() {
        return "PROVIDER_STUB";
      },
    };
    const huge = "n".repeat(4000);
    const result = await compact(
      transcript([
        {
          id: "a1",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "Read", arguments: { path: "big.txt" } }],
        },
        { id: "t1", role: "tool", toolCallId: "c1", content: huge },
      ]),
      { config: { recentItemCount: 0, largeOutputTokens: 10 }, semanticProvider: provider },
    );

    expect(result.compacted).toHaveLength(1);
    expect(result.compacted[0]?.content).toBe("PROVIDER_STUB");
  });

  it("handles an empty transcript", async () => {
    const result = await compact(transcript([]));
    expect(result.items).toEqual([]);
    expect(result.compacted).toEqual([]);
    expect(result.stats.originalItems).toBe(0);
  });
});
