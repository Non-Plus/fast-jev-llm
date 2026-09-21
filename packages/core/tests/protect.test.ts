import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/pipeline.js";
import {
  currentTask,
  explicitUserConstraints,
  recentItems,
  systemInstructions,
  unresolvedErrors,
} from "../src/rules/protect.js";
import { makeItem, makeToolItem } from "./helpers.js";

describe("protected-context rules", () => {
  it("protects system messages", () => {
    const items = [
      makeItem({ id: "sys", role: "system", content: "You are a coding assistant." }),
      makeItem({ id: "u", role: "user", content: "hi" }),
    ];
    expect(systemInstructions(items)).toEqual([
      expect.objectContaining({
        action: "PROTECT",
        itemId: "sys",
        rule: "system-instructions",
      }),
    ]);
  });

  it("protects explicit user constraints and metadata flags", () => {
    const items = [
      makeItem({
        id: "c1",
        role: "user",
        content: "Never log secrets or API keys.",
      }),
      makeItem({
        id: "c2",
        role: "user",
        content: "ship it",
        metadata: { constraint: true },
      }),
      makeItem({ id: "u", role: "user", content: "look at src/server.ts" }),
    ];
    expect(explicitUserConstraints(items).map((decision) => decision.itemId)).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("protects the most recent substantive user message as the current task", () => {
    const items = [
      makeItem({ id: "t1", role: "user", content: "Add rate limiting to the API." }),
      makeItem({ id: "ack", role: "user", content: "ok" }),
      makeItem({ id: "t2", role: "user", content: "Also add a health check endpoint." }),
      makeItem({ id: "thanks", role: "user", content: "thanks" }),
    ];
    expect(currentTask(items)).toEqual([
      expect.objectContaining({ itemId: "t2", rule: "current-task", action: "PROTECT" }),
    ]);
  });

  it("protects only the latest unresolved error per target", () => {
    const fail1 = makeToolItem("f1", {
      name: "Shell",
      kind: "test_run",
      callId: "f1",
      args: {},
      command: "pnpm test",
      testTarget: "pnpm test",
      isError: true,
      exitCode: 1,
      result: "1 failed",
    });
    const fail2 = makeToolItem("f2", {
      name: "Shell",
      kind: "test_run",
      callId: "f2",
      args: {},
      command: "pnpm test",
      testTarget: "pnpm test",
      isError: true,
      exitCode: 1,
      result: "1 failed",
    });
    const lint = makeToolItem("lint", {
      name: "Shell",
      kind: "command",
      callId: "lint",
      args: { command: "npm run lint" },
      command: "npm run lint",
      isError: true,
      exitCode: 1,
      result: "error: Unexpected console",
    });
    const pass = makeToolItem("p", {
      name: "Shell",
      kind: "test_run",
      callId: "p",
      args: {},
      command: "pnpm test",
      testTarget: "pnpm test",
      exitCode: 0,
      result: "0 failed",
    });

    const unresolved = unresolvedErrors([fail1, fail2, lint]);
    expect(unresolved.map((decision) => decision.itemId).sort()).toEqual(["f2", "lint"]);

    const resolved = unresolvedErrors([fail1, fail2, lint, pass]);
    expect(resolved.map((decision) => decision.itemId)).toEqual(["lint"]);
  });

  it("protects the last N items", () => {
    const items = [1, 2, 3, 4, 5].map((n) =>
      makeItem({ id: `i${n}`, role: "assistant", content: String(n) }),
    );
    const decisions = recentItems(items, { ...DEFAULT_CONFIG, recentItemCount: 2 });
    expect(decisions.map((decision) => decision.itemId)).toEqual(["i4", "i5"]);
    expect(decisions.every((decision) => decision.rule === "recent-items")).toBe(true);
  });

  it("allows compression on recent tool results and forbids it on recent user text", () => {
    const user = makeItem({ id: "u", role: "user", content: "Never log secrets." });
    const tool = makeToolItem(
      "t",
      {
        name: "Shell",
        kind: "build_run",
        callId: "t",
        args: { command: "npm run build" },
        command: "npm run build",
        result: "error TS2322",
      },
      "error TS2322",
      20_000,
    );
    const decisions = recentItems([user, tool], { ...DEFAULT_CONFIG, recentItemCount: 2 });
    const userDecision = decisions.find((decision) => decision.itemId === "u");
    const toolDecision = decisions.find((decision) => decision.itemId === "t");
    expect(userDecision).toEqual(
      expect.objectContaining({
        retention: "protected",
        compression: "forbidden",
      }),
    );
    expect(toolDecision).toEqual(
      expect.objectContaining({
        retention: "protected",
        compression: "allowed",
      }),
    );
  });

  it("does not treat plugin dumps as system safety instructions", () => {
    const plugin = makeItem({
      id: "plug",
      role: "system",
      origin: "plugin",
      content: "<recommended_plugins>weather</recommended_plugins>",
    });
    expect(systemInstructions([plugin])).toEqual([]);
  });
});
