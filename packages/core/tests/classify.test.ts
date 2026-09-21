import { describe, expect, it } from "vitest";
import {
  classifyTool,
  isTestFailureFromOutput,
  isTestSuccessFromOutput,
  parseArguments,
} from "../src/classify.js";

describe("parseArguments", () => {
  it("passes objects through", () => {
    expect(parseArguments({ path: "a.ts" })).toEqual({ path: "a.ts" });
  });

  it("parses JSON strings", () => {
    expect(parseArguments('{"path":"a.ts"}')).toEqual({ path: "a.ts" });
  });

  it("treats non-JSON strings as commands", () => {
    expect(parseArguments("git status")).toEqual({ command: "git status" });
  });
});

describe("classifyTool", () => {
  it("classifies file reads from tool name and path keys", () => {
    expect(classifyTool("Read", { path: "src/index.ts" }).kind).toBe("file_read");
    expect(classifyTool("Read", { path: "src/index.ts" }).path).toBe("src/index.ts");
    expect(classifyTool("read_file", { file_path: "a.ts" }).path).toBe("a.ts");
  });

  it("classifies cat shell commands as file reads", () => {
    const classified = classifyTool("Shell", { command: "cat src/server.ts" });
    expect(classified.kind).toBe("file_read");
    expect(classified.path).toBe("src/server.ts");
  });

  it("classifies git status and git diff before generic commands", () => {
    expect(classifyTool("Shell", { command: "git status --porcelain" }).kind).toBe(
      "git_status",
    );
    expect(classifyTool("Shell", { command: "git diff src/a.ts" }).kind).toBe("git_diff");
  });

  it("classifies directory listings", () => {
    expect(classifyTool("Glob", { glob: "src/**" }).kind).toBe("directory_list");
    expect(classifyTool("Shell", { command: "ls src" }).kind).toBe("directory_list");
    expect(classifyTool("Shell", { command: "ls" }).path).toBe(".");
  });

  it("classifies test runs and extracts a target", () => {
    const classified = classifyTool("Shell", { command: "pnpm test" });
    expect(classified.kind).toBe("test_run");
    expect(classified.testTarget).toBe("pnpm test");
    expect(classifyTool("Shell", { command: "vitest run src/foo.test.ts" }).testTarget).toBe(
      "src/foo.test.ts",
    );
  });

  it("does not treat lint as a test run", () => {
    const classified = classifyTool("Shell", { command: "npm run lint" });
    expect(classified.kind).toBe("command");
    expect(classified.path).toBeUndefined();
    expect(classified.command).toBe("npm run lint");
  });

  it("classifies writes and leftover shell as command/other", () => {
    expect(classifyTool("Write", { path: "a.ts" }).kind).toBe("file_write");
    expect(classifyTool("Shell", { command: "echo hello" }).kind).toBe("command");
    expect(classifyTool("mystery", {}).kind).toBe("other");
  });
});

describe("test output heuristics", () => {
  it("detects success and failure from common runners", () => {
    expect(isTestSuccessFromOutput("3 passed, 0 failed")).toBe(true);
    expect(isTestFailureFromOutput("1 failed, 2 passed")).toBe(true);
    expect(isTestSuccessFromOutput("FAIL src/a.test.ts")).toBe(false);
    expect(isTestFailureFromOutput("PASS src/a.test.ts")).toBe(false);
  });
});
