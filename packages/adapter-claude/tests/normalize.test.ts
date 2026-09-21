import { classifyTool } from "@fast-jev/core";
import { describe, expect, it } from "vitest";
import { normalizeProjectPath } from "../src/path-normalize.js";
import { normalizeClaudeTool, unwrapCommand } from "../src/tool-normalize.js";
import { parseClaudeJsonl } from "../src/parser.js";
import { fixturePath } from "./helpers.js";

const CWD = "/Users/user/project";

describe("Claude path normalization", () => {
  it("resolves relative, dotted, and absolute workspace paths", () => {
    const paths = ["./src/auth.ts", "src/auth.ts", `${CWD}/src/auth.ts`];
    const canonical = paths.map((path) => normalizeProjectPath(path, CWD)?.canonical);
    expect(canonical).toEqual(["src/auth.ts", "src/auth.ts", "src/auth.ts"]);
  });

  it("does not rewrite paths outside the workspace", () => {
    const outside = normalizeProjectPath("../other/secret.ts", CWD);
    expect(outside?.outsideRepo).toBe(true);
    expect(outside?.canonical).toBeUndefined();

    const absOutside = normalizeProjectPath("/etc/passwd", CWD);
    expect(absOutside?.outsideRepo).toBe(true);
    expect(absOutside?.original).toBe("/etc/passwd");
  });

  it("preserves the original vendor path from file_path", async () => {
    const parsed = await parseClaudeJsonl(fixturePath("path-variants.jsonl"));
    const calls = parsed.transcript.messages.flatMap((message) => message.toolCalls ?? []);
    expect(calls.map((call) => call.arguments.path)).toEqual([
      "src/auth.ts",
      "src/auth.ts",
      "src/auth.ts",
      "/etc/passwd",
    ]);
    expect(calls[0]?.arguments.originalPath).toBe("./src/auth.ts");
    expect(calls[3]?.arguments.pathOutsideRepo).toBe(true);
  });
});

describe("Claude tool normalization", () => {
  it("maps Claude tools onto the same ToolKind values as Codex and Cursor", () => {
    const read = normalizeClaudeTool({
      name: "Read",
      cwd: CWD,
      rawArguments: { file_path: "src/auth.ts" },
    });
    expect(classifyTool(read.name, read.arguments).kind).toBe("file_read");

    const write = normalizeClaudeTool({
      name: "Write",
      cwd: CWD,
      rawArguments: { file_path: "src/auth.ts", contents: "export const login = () => false;\n" },
    });
    expect(classifyTool(write.name, write.arguments).kind).toBe("file_write");

    const edit = normalizeClaudeTool({
      name: "Edit",
      cwd: CWD,
      rawArguments: { file_path: "src/auth.ts", old_string: "a", new_string: "b" },
    });
    expect(classifyTool(edit.name, edit.arguments).kind).toBe("file_write");

    const status = normalizeClaudeTool({
      name: "Bash",
      cwd: CWD,
      rawArguments: { command: "git status" },
    });
    expect(classifyTool(status.name, status.arguments).kind).toBe("git_status");

    const diff = normalizeClaudeTool({
      name: "Bash",
      cwd: CWD,
      rawArguments: { command: "rtk git diff" },
    });
    expect(unwrapCommand("rtk git diff")).toBe("git diff");
    expect(classifyTool(diff.name, diff.arguments).kind).toBe("git_diff");

    const tests = normalizeClaudeTool({
      name: "Bash",
      cwd: CWD,
      rawArguments: { command: "npm test" },
    });
    expect(classifyTool(tests.name, tests.arguments).kind).toBe("test_run");

    const build = normalizeClaudeTool({
      name: "Bash",
      cwd: CWD,
      rawArguments: { command: "npm run build" },
    });
    expect(classifyTool(build.name, build.arguments).kind).toBe("build_run");

    const list = normalizeClaudeTool({
      name: "Glob",
      cwd: CWD,
      rawArguments: { glob_pattern: "src/**" },
    });
    expect(list.arguments.path).toBe("src");
    expect(classifyTool(list.name, list.arguments).kind).toBe("directory_list");

    const grep = normalizeClaudeTool({
      name: "Grep",
      cwd: CWD,
      rawArguments: { pattern: "login", path: "src" },
    });
    expect(classifyTool(grep.name, grep.arguments).kind).toBe("command");

    const echo = normalizeClaudeTool({
      name: "Bash",
      cwd: CWD,
      rawArguments: { command: "echo hello" },
    });
    expect(classifyTool(echo.name, echo.arguments).kind).toBe("command");
  });
});
