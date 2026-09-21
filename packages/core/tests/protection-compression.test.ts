import { describe, expect, it } from "vitest";
import { compact } from "../src/pipeline.js";
import { message, transcript } from "./helpers.js";

function hugeBuildLog(): string {
  const errors = [
    "src/auth.ts:128:4 - error TS2322: Type 'X' is not assignable to type 'Y'.",
    "src/user.ts:44:8 - error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
    "src/session.ts:9:1 - error TS2304: Cannot find name 'windowMs'.",
    "Found 3 errors.",
  ];
  const chatter = Array.from({ length: 2500 }, (_, index) => `webpack: compiled module ${index}`);
  return ["npm run build", ...chatter, ...errors, "Failed to compile."].join("\n");
}

describe("protection vs compression eligibility", () => {
  it("compresses a recent huge build output while leaving a recent user constraint verbatim", async () => {
    const log = hugeBuildLog();
    const result = await compact(
      transcript([
        message("u1", "user", "Never log secrets. Fix the TypeScript build."),
        {
          id: "a1",
          role: "assistant",
          content: "Running the build.",
          toolCalls: [{ id: "c1", name: "Shell", arguments: { command: "npm run build" } }],
        },
        {
          id: "t1",
          role: "tool",
          toolCallId: "c1",
          content: log,
          metadata: { exitCode: 1, isError: true },
        },
      ]),
    );

    const constraint = result.items.find((item) => item.content.includes("Never log secrets"));
    const build = result.items.find((item) => item.tool?.kind === "build_run");
    expect(constraint).toBeDefined();
    expect(build).toBeDefined();

    const byId = new Map(result.decisions.map((decision) => [decision.itemId, decision]));
    const constraintDecision = byId.get(constraint!.id);
    const buildDecision = byId.get(build!.id);

    expect(constraintDecision).toEqual(
      expect.objectContaining({
        action: "PROTECT",
        retention: "protected",
        compression: "forbidden",
        importance: "CRITICAL",
      }),
    );
    expect(result.compacted.find((item) => item.id === constraint!.id)?.content).toContain(
      "Never log secrets",
    );

    expect(buildDecision).toEqual(
      expect.objectContaining({
        action: "COMPRESS",
        retention: "protected",
        compression: "allowed",
        reasonCode: "LARGE_BUILD_OUTPUT",
      }),
    );
    const compactedBuild = result.compacted.find((item) => item.id === build!.id);
    expect(compactedBuild?.content).toContain("TS2322");
    expect(compactedBuild?.content).toContain("src/auth.ts:128:4");
    expect(compactedBuild?.content).toContain("TS2345");
    expect(compactedBuild?.content).not.toContain("webpack: compiled module 2000");
    expect(compactedBuild!.tokenCount).toBeLessThan(build!.tokenCount);
    expect(result.stats.protectedCompressibleTokens).toBeGreaterThan(0);
    expect(result.stats.protectedVerbatimTokens).toBeGreaterThan(0);
  });

  it("does not drop a protected item even when a prune rule asks to", async () => {
    const result = await compact(
      transcript([
        message("u1", "user", "Never change public APIs."),
        message("a1", "assistant", "Understood."),
      ]),
      { config: { recentItemCount: 8 } },
    );
    const constraint = result.items.find((item) => item.content.includes("Never change"));
    const decision = result.decisions.find((entry) => entry.itemId === constraint?.id);
    expect(decision?.action).not.toBe("DROP");
    expect(decision?.retention).toBe("protected");
  });
});
