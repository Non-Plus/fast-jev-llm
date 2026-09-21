import { describe, expect, it } from "vitest";
import { classifyFailureKind } from "../src/classify.js";
import { compact, DEFAULT_CONFIG } from "../src/pipeline.js";
import { annotateFileState, contentHash, normalizePath } from "../src/file-state.js";
import { collectRelations } from "../src/relations.js";
import { inferTaskState } from "../src/task.js";
import { makeItem, makeToolItem, message, transcript } from "./helpers.js";

describe("file state awareness", () => {
  it("normalizes paths and hashes content", () => {
    expect(normalizePath("./src/../src/a.ts")).toBe("src/a.ts");
    expect(contentHash("hello")).toHaveLength(64);
  });

  it("marks writeBetweenReads when a write lands between two reads", () => {
    const items = [
      makeToolItem("r1", {
        name: "Read",
        kind: "file_read",
        callId: "r1",
        args: { path: "src/a.ts" },
        path: "src/a.ts",
        result: "v1",
      }),
      makeToolItem("w1", {
        name: "Write",
        kind: "file_write",
        callId: "w1",
        args: { path: "src/a.ts", contents: "v2" },
        path: "src/a.ts",
      }),
      makeToolItem("r2", {
        name: "Read",
        kind: "file_read",
        callId: "r2",
        args: { path: "src/a.ts" },
        path: "src/a.ts",
        result: "v2",
      }),
    ];
    annotateFileState(items);
    expect(items[0]?.tool?.writeBetweenReads).toBe(false);
    expect(items[2]?.tool?.writeBetweenReads).toBe(true);
    expect(items[0]?.tool?.contentHash).toBe(contentHash("v1"));
    expect(items[2]?.tool?.normalizedPath).toBe("src/a.ts");
  });

  it("keeps Read/Read and Read/Write/Read distinguishable through compact", async () => {
    const duplicate = await compact(
      transcript([
        {
          id: "a1",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "Read", arguments: { path: "src/a.ts" } }],
        },
        { id: "t1", role: "tool", toolCallId: "c1", content: "const a = 1;" },
        {
          id: "a2",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c2", name: "Read", arguments: { path: "src/a.ts" } }],
        },
        { id: "t2", role: "tool", toolCallId: "c2", content: "const a = 1;" },
      ]),
      { config: { ...DEFAULT_CONFIG, recentItemCount: 0 } },
    );
    const droppedDuplicate = duplicate.decisions.find((decision) => decision.action === "DROP");
    expect(droppedDuplicate?.reasonCode).toBe("SUPERSEDED_FILE_READ");

    const rewritten = await compact(
      transcript([
        {
          id: "a1",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "Read", arguments: { path: "src/a.ts" } }],
        },
        { id: "t1", role: "tool", toolCallId: "c1", content: "const a = 1;" },
        {
          id: "a2",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c2", name: "Write", arguments: { path: "src/a.ts", contents: "const a = 2;" } }],
        },
        { id: "t2", role: "tool", toolCallId: "c2", content: "Wrote src/a.ts" },
        {
          id: "a3",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c3", name: "Read", arguments: { path: "src/a.ts" } }],
        },
        { id: "t3", role: "tool", toolCallId: "c3", content: "const a = 2;" },
      ]),
      { config: { ...DEFAULT_CONFIG, recentItemCount: 0 } },
    );
    const droppedInvalidated = rewritten.decisions.find((decision) => decision.action === "DROP");
    expect(droppedInvalidated?.reasonCode).toBe("WRITE_INVALIDATED_READ");
    expect(rewritten.relations.some((relation) => relation.type === "invalidates")).toBe(true);
    expect(rewritten.relations.some((relation) => relation.type === "supersedes")).toBe(true);
  });
});

describe("failure classification", () => {
  it("classifies deterministic failure kinds without AI", () => {
    expect(
      classifyFailureKind({
        kind: "test_run",
        isError: true,
        exitCode: 1,
        result: "1 failed",
      }),
    ).toBe("test");
    expect(
      classifyFailureKind({
        kind: "command",
        command: "npm run lint",
        isError: true,
        exitCode: 1,
        result: "error: Unexpected console",
      }),
    ).toBe("lint");
    expect(
      classifyFailureKind({
        kind: "command",
        command: "tsc -p tsconfig.json",
        isError: true,
        exitCode: 1,
        result: "error TS2304: Cannot find name 'foo'.",
      }),
    ).toBe("compile");
    expect(
      classifyFailureKind({
        kind: "command",
        command: "curl localhost",
        isError: true,
        result: "ECONNREFUSED",
      }),
    ).toBe("network");
  });
});

describe("task state", () => {
  it("populates root, current, and constraints conservatively", () => {
    const task = inferTaskState([
      makeItem({ id: "u1", role: "user", content: "Add rate limiting. Never log secrets." }),
      makeItem({ id: "u2", role: "user", content: "yes" }),
      makeItem({ id: "u3", role: "user", content: "continue" }),
      makeItem({
        id: "u4",
        role: "user",
        content: "Fix that error.\nAcceptance criteria: requests over the limit return 429.",
      }),
    ]);
    expect(task.rootTask).toContain("Add rate limiting");
    expect(task.currentTask).toContain("Fix that error");
    expect(task.constraints.some((entry) => entry.includes("Never log secrets"))).toBe(true);
    expect(task.acceptanceCriteria.some((entry) => /429/.test(entry))).toBe(true);
  });
});

describe("relations", () => {
  it("emits supersedes, invalidates, and validates without building a graph", () => {
    const items = [
      makeToolItem("r1", {
        name: "Read",
        kind: "file_read",
        callId: "r1",
        args: { path: "a.ts" },
        path: "a.ts",
      }),
      makeToolItem("w1", {
        name: "Write",
        kind: "file_write",
        callId: "w1",
        args: { path: "a.ts" },
        path: "a.ts",
      }),
      makeToolItem("r2", {
        name: "Read",
        kind: "file_read",
        callId: "r2",
        args: { path: "a.ts" },
        path: "a.ts",
      }),
      makeToolItem(
        "t1",
        {
          name: "Shell",
          kind: "test_run",
          callId: "t1",
          args: {},
          command: "pnpm test",
          testTarget: "pnpm test",
          exitCode: 0,
          result: "3 passed, 0 failed",
        },
        "3 passed, 0 failed",
      ),
    ];
    const relations = collectRelations(items);
    expect(relations.some((relation) => relation.type === "supersedes")).toBe(true);
    expect(relations.some((relation) => relation.type === "invalidates")).toBe(true);
    expect(relations.some((relation) => relation.type === "validates")).toBe(true);
  });
});

describe("empty helpers import", () => {
  it("keeps message helper usable", () => {
    expect(message("m", "user", "hi").role).toBe("user");
  });
});
