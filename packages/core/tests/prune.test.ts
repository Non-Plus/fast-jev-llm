import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/pipeline.js";
import {
  compressLargeOutput,
  oldDirectoryListings,
  repeatedCommandOutputs,
  successfulTestSupersedesFailures,
  supersededFileReads,
  supersededGitDiff,
  supersededGitStatus,
  supersededTestRuns,
} from "../src/rules/prune.js";
import { makeItem, makeToolItem } from "./helpers.js";
import type { ToolMeta } from "../src/types.js";

function fileRead(id: string, path: string): ReturnType<typeof makeToolItem> {
  return makeToolItem(id, {
    name: "Read",
    kind: "file_read",
    callId: id,
    args: { path },
    path,
  });
}

function git(id: string, kind: "git_status" | "git_diff"): ReturnType<typeof makeToolItem> {
  return makeToolItem(id, {
    name: "Shell",
    kind,
    callId: id,
    args: { command: kind === "git_status" ? "git status" : "git diff" },
    command: kind === "git_status" ? "git status" : "git diff",
  });
}

function listing(id: string, path: string): ReturnType<typeof makeToolItem> {
  return makeToolItem(id, {
    name: "Shell",
    kind: "directory_list",
    callId: id,
    args: { command: `ls ${path}` },
    path,
    command: `ls ${path}`,
  });
}

function testRun(
  id: string,
  extra: Partial<ToolMeta> & { result?: string },
): ReturnType<typeof makeToolItem> {
  return makeToolItem(
    id,
    {
      name: "Shell",
      kind: "test_run",
      callId: id,
      args: { command: "pnpm test" },
      command: "pnpm test",
      testTarget: "pnpm test",
      ...extra,
    },
    extra.result ?? "",
  );
}

function command(id: string, cmd: string, result = ""): ReturnType<typeof makeToolItem> {
  return makeToolItem(
    id,
    {
      name: "Shell",
      kind: "command",
      callId: id,
      args: { command: cmd },
      command: cmd,
      result,
    },
    result,
  );
}

function fileWrite(id: string, path: string): ReturnType<typeof makeToolItem> {
  return makeToolItem(id, {
    name: "Write",
    kind: "file_write",
    callId: id,
    args: { path, contents: "new" },
    path,
    normalizedPath: path,
  });
}

describe("deterministic prune rules", () => {
  it("drops earlier reads of the same path and keeps different paths", () => {
    const decisions = supersededFileReads([
      fileRead("a", "src/a.ts"),
      fileRead("b", "src/b.ts"),
      fileRead("c", "src/a.ts"),
    ]);
    expect(decisions).toEqual([
      expect.objectContaining({
        action: "DROP",
        itemId: "a",
        rule: "superseded-file-read",
      }),
    ]);
  });

  it("drops superseded git status and git diff", () => {
    expect(
      supersededGitStatus([git("s1", "git_status"), git("s2", "git_status")]).map(
        (decision) => decision.itemId,
      ),
    ).toEqual(["s1"]);
    expect(
      supersededGitDiff([git("d1", "git_diff"), git("d2", "git_diff")]).map(
        (decision) => decision.itemId,
      ),
    ).toEqual(["d1"]);
  });

  it("drops old directory listings of the same path", () => {
    const decisions = oldDirectoryListings([
      listing("l1", "."),
      listing("l2", "src"),
      listing("l3", "."),
    ]);
    expect(decisions.map((decision) => decision.itemId)).toEqual(["l1"]);
  });

  it("drops earlier test runs of the same target", () => {
    const decisions = supersededTestRuns([
      testRun("t1", { exitCode: 1, isError: true }),
      testRun("t2", { exitCode: 0 }),
    ]);
    expect(decisions).toEqual([
      expect.objectContaining({
        itemId: "t1",
        rule: "superseded-test-run",
        action: "DROP",
      }),
    ]);
  });

  it("drops failed tests once a later run of the same target passes", () => {
    const decisions = successfulTestSupersedesFailures([
      testRun("fail-1", {
        isError: true,
        exitCode: 1,
        result: "1 failed, 2 passed",
      }),
      testRun("fail-other", {
        isError: true,
        exitCode: 1,
        testTarget: "other",
        command: "pnpm test other",
        result: "1 failed",
      }),
      testRun("pass", { exitCode: 0, result: "3 passed, 0 failed" }),
    ]);
    expect(decisions.map((decision) => decision.itemId)).toEqual(["fail-1"]);
    expect(decisions[0]?.rule).toBe("successful-test-supersedes-failures");
  });

  it("drops earlier repeated generic commands only when output is identical", () => {
    const decisions = repeatedCommandOutputs([
      command("e1", "echo hello", "hello"),
      fileRead("r1", "a.ts"),
      command("e2", "echo hello", "hello"),
    ]);
    expect(decisions.map((decision) => decision.itemId)).toEqual(["e1"]);
    expect(decisions[0]?.reasonCode).toBe("DUPLICATE_OUTPUT");
  });

  it("does not drop the same command when outputs differ", () => {
    const decisions = repeatedCommandOutputs([
      command("e1", "echo hello", "hello"),
      command("e2", "echo hello", "hello world"),
    ]);
    expect(decisions).toEqual([]);
  });

  it("drops earlier generic command output when normalized hashes match", () => {
    const decisions = repeatedCommandOutputs([
      command("e1", "pwd", "[2026-09-21T00:00:00Z] /repo"),
      command("e2", "pwd", "[2026-09-21T01:00:00Z] /repo"),
    ]);
    expect(decisions.map((decision) => decision.itemId)).toEqual(["e1"]);
    expect(decisions[0]?.reasonCode).toBe("DUPLICATE_OUTPUT");
  });

  it("does not treat reads of the same path as equivalent when a write lands between them", () => {
    const duplicate = supersededFileReads([
      fileRead("r1", "src/a.ts"),
      fileRead("r2", "src/a.ts"),
    ]);
    expect(duplicate).toEqual([
      expect.objectContaining({
        itemId: "r1",
        reasonCode: "SUPERSEDED_FILE_READ",
      }),
    ]);

    const withWrite = supersededFileReads([
      fileRead("r1", "src/a.ts"),
      fileWrite("w1", "src/a.ts"),
      fileRead("r2", "src/a.ts"),
    ]);
    expect(withWrite).toEqual([
      expect.objectContaining({
        itemId: "r1",
        reasonCode: "WRITE_INVALIDATED_READ",
        action: "DROP",
      }),
    ]);
  });

  it("emits COMPRESS for oversized tool outputs only", () => {
    const large = makeToolItem(
      "big",
      {
        name: "Read",
        kind: "file_read",
        callId: "big",
        args: { path: "lock" },
        path: "lock",
      },
      "x".repeat(100),
      5000,
    );
    const small = makeItem({
      id: "msg",
      kind: "message",
      role: "user",
      content: "x".repeat(100),
      tokenCount: 5000,
    });
    const decisions = compressLargeOutput([large, small], DEFAULT_CONFIG);
    expect(decisions).toEqual([
      expect.objectContaining({
        action: "COMPRESS",
        itemId: "big",
        rule: "compress-large-output",
        reasonCode: "LARGE_OUTPUT",
      }),
    ]);
  });

  it("uses structured reason codes for known tool kinds", () => {
    const build = makeToolItem(
      "b",
      { name: "Shell", kind: "build_run", callId: "b", args: {}, command: "npm run build" },
      "log",
      5000,
    );
    const test = makeToolItem(
      "t",
      { name: "Shell", kind: "test_run", callId: "t", args: {}, command: "pnpm test", testTarget: "pnpm test" },
      "log",
      5000,
    );
    const diff = makeToolItem(
      "d",
      { name: "Shell", kind: "git_diff", callId: "d", args: {}, command: "git diff" },
      "log",
      5000,
    );
    const listing = makeToolItem(
      "l",
      { name: "Shell", kind: "directory_list", callId: "l", args: {}, path: "." },
      "log",
      5000,
    );
    const decisions = compressLargeOutput([build, test, diff, listing], DEFAULT_CONFIG);
    expect(decisions.map((decision) => decision.reasonCode)).toEqual([
      "LARGE_BUILD_OUTPUT",
      "LARGE_TEST_OUTPUT",
      "LARGE_GIT_DIFF",
      "LARGE_DIRECTORY_LISTING",
    ]);
  });

  it("includes action, reason, item id, and rule on every decision", () => {
    const decisions = supersededFileReads([
      fileRead("a", "a.ts"),
      fileRead("b", "a.ts"),
    ]);
    for (const decision of decisions) {
      expect(decision.action).toBe("DROP");
      expect(decision.reason.length).toBeGreaterThan(0);
      expect(decision.itemId).toBe("a");
      expect(decision.rule).toBe("superseded-file-read");
      expect(decision.reasonCode).toBe("SUPERSEDED_FILE_READ");
      expect(decision.authority).toBe("structural");
    }
  });
});
