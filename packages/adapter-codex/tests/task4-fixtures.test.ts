import { describe, expect, it } from "vitest";
import { analyzeCodexSession } from "../src/analyze.js";
import { parseCodexJsonl } from "../src/parser.js";
import { fixturePath } from "./helpers.js";

const TASK4_FIXTURES = [
  "huge-build-failure.jsonl",
  "huge-build-success.jsonl",
  "huge-test-suite.jsonl",
  "large-git-diff.jsonl",
  "large-directory-tree.jsonl",
  "duplicate-generic-command.jsonl",
  "same-command-different-output.jsonl",
  "developer-plugin-content.jsonl",
  "explicit-user-constraints.jsonl",
  "recent-huge-tool-result.jsonl",
  "old-superseded-tool-result.jsonl",
] as const;

describe("Task 4 realistic fixtures", () => {
  it("identifies the observed Codex wire format on every fixture", async () => {
    for (const name of TASK4_FIXTURES) {
      const parsed = await parseCodexJsonl(fixturePath(name));
      const metaLine = parsed.transcript.sessionId;
      expect(metaLine.length).toBeGreaterThan(0);
      expect(parsed.meta.cliVersion).toBe("0.151.0");
      expect(parsed.malformedLineCount).toBe(0);
    }
  });

  it("compresses a recent huge build failure without dropping the user constraint", async () => {
    const result = await analyzeCodexSession(fixturePath("huge-build-failure.jsonl"));
    const constraint = result.items.find((item) => item.reasonCode === "USER_CONSTRAINT" || item.reasonCode === "CURRENT_TASK");
    const build = result.items.find((item) => item.command === "npm run build");
    expect(constraint?.action).toBe("PROTECT");
    expect(constraint?.compression).toBe("forbidden");
    expect(build?.action).toBe("COMPRESS");
    expect(build?.retention).toBe("protected");
    expect(build?.reasonCode).toBe("LARGE_BUILD_OUTPUT");
    expect(build?.savedTokens).toBeGreaterThan(0);
  });

  it("compresses huge tests, diffs, and directory trees", async () => {
    const tests = await analyzeCodexSession(fixturePath("huge-test-suite.jsonl"));
    const testItem = tests.items.find((item) => item.command === "pnpm test");
    expect(testItem?.action).toBe("COMPRESS");
    expect(testItem?.reasonCode).toBe("LARGE_TEST_OUTPUT");

    const diff = await analyzeCodexSession(fixturePath("large-git-diff.jsonl"));
    const diffItem = diff.items.find((item) => item.command === "git diff");
    expect(diffItem?.action).toBe("COMPRESS");
    expect(diffItem?.reasonCode).toBe("LARGE_GIT_DIFF");

    const tree = await analyzeCodexSession(fixturePath("large-directory-tree.jsonl"));
    const treeItem = tree.items.find((item) => item.command === "find .");
    expect(treeItem?.action).toBe("COMPRESS");
    expect(treeItem?.reasonCode).toBe("LARGE_DIRECTORY_LISTING");
  });

  it("drops older equivalent generic command output and keeps different output", async () => {
    const dup = await analyzeCodexSession(fixturePath("duplicate-generic-command.jsonl"), {
      config: { recentItemCount: 2 },
    });
    expect(dup.items.some((item) => item.reasonCode === "DUPLICATE_OUTPUT")).toBe(true);

    const different = await analyzeCodexSession(fixturePath("same-command-different-output.jsonl"), {
      config: { recentItemCount: 2 },
    });
    expect(different.items.some((item) => item.reasonCode === "DUPLICATE_OUTPUT")).toBe(false);
  });

  it("distinguishes developer instructions from plugin dumps", async () => {
    const result = await analyzeCodexSession(fixturePath("developer-plugin-content.jsonl"));
    const developer = result.items.find((item) => item.origin === "developer");
    const plugin = result.items.find((item) => item.origin === "plugin");
    expect(developer?.reasonCode).toBe("SYSTEM_INSTRUCTION");
    expect(developer?.action).toBe("PROTECT");
    expect(plugin?.reasonCode).not.toBe("SYSTEM_INSTRUCTION");
  });

  it("protects explicit user constraints verbatim", async () => {
    const result = await analyzeCodexSession(fixturePath("explicit-user-constraints.jsonl"));
    const constraint = result.items.find((item) => item.reasonCode === "USER_CONSTRAINT");
    expect(constraint?.action).toBe("PROTECT");
    expect(constraint?.compression).toBe("forbidden");
    expect(constraint?.importance).toBe("CRITICAL");
  });

  it("compresses a recent huge tool result and can drop an old superseded snapshot", async () => {
    const recent = await analyzeCodexSession(fixturePath("recent-huge-tool-result.jsonl"));
    const huge = recent.items.find((item) => item.originalTokens > 1000);
    expect(huge?.action).toBe("COMPRESS");
    expect(huge?.retention).toBe("protected");

    const old = await analyzeCodexSession(fixturePath("old-superseded-tool-result.jsonl"), {
      config: { recentItemCount: 2 },
    });
    expect(old.items.some((item) => item.reasonCode === "SUPERSEDED_GIT_STATUS")).toBe(true);
  });
});
