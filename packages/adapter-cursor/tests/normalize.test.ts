import { classifyTool } from "@fast-jev/core";
import { describe, expect, it } from "vitest";
import { normalizeProjectPath } from "../src/path-normalize.js";
import { normalizeCursorTool, unwrapCommand } from "../src/tool-normalize.js";
import { parseCursorJsonl } from "../src/parser.js";
import { fixturePath } from "./helpers.js";

const CWD = "/Users/user/project";

describe("Cursor path normalization", () => {
  it("resolves relative, dotted, workspace, and absolute workspace paths", () => {
    const paths = ["./src/auth.ts", "src/auth.ts", "<workspace>/src/auth.ts", `${CWD}/src/auth.ts`];
    const canonical = paths.map((path) => normalizeProjectPath(path, CWD)?.canonical);
    expect(canonical).toEqual(["src/auth.ts", "src/auth.ts", "src/auth.ts", "src/auth.ts"]);
  });

  it("does not rewrite paths outside the workspace", () => {
    const outside = normalizeProjectPath("../other/secret.ts", CWD);
    expect(outside?.outsideRepo).toBe(true);
    expect(outside?.canonical).toBeUndefined();
    expect(outside?.original).toBe("../other/secret.ts");

    const absOutside = normalizeProjectPath("/etc/passwd", CWD);
    expect(absOutside?.outsideRepo).toBe(true);
    expect(absOutside?.canonical).toBeUndefined();
    expect(absOutside?.original).toBe("/etc/passwd");
  });

  it("preserves the original vendor path", async () => {
    const parsed = await parseCursorJsonl(fixturePath("path-variants.jsonl"));
    const calls = parsed.transcript.messages.flatMap((message) => message.toolCalls ?? []);
    expect(calls.map((call) => call.arguments.path)).toEqual([
      "src/auth.ts",
      "src/auth.ts",
      "src/auth.ts",
      "/etc/passwd",
    ]);
    expect(calls[0]?.arguments.originalPath).toBe("./src/auth.ts");
    expect(calls[2]?.arguments.originalPath).toBe("<workspace>/src/auth.ts");
    expect(calls[3]?.arguments.pathOutsideRepo).toBe(true);
  });
});

describe("Cursor tool normalization", () => {
  it("maps Cursor tools onto the same ToolKind values as Codex", () => {
    const read = normalizeCursorTool({ name: "Read", cwd: CWD, rawArguments: { path: "src/auth.ts" } });
    expect(classifyTool(read.name, read.arguments).kind).toBe("file_read");

    const write = normalizeCursorTool({
      name: "Write",
      cwd: CWD,
      rawArguments: { path: "src/auth.ts", contents: "export const login = () => false;\n" },
    });
    expect(classifyTool(write.name, write.arguments).kind).toBe("file_write");

    const replace = normalizeCursorTool({
      name: "StrReplace",
      cwd: CWD,
      rawArguments: { path: "src/auth.ts", old_string: "a", new_string: "b" },
    });
    expect(classifyTool(replace.name, replace.arguments).kind).toBe("file_write");

    const status = normalizeCursorTool({
      name: "Shell",
      cwd: CWD,
      rawArguments: { command: "git status" },
    });
    expect(classifyTool(status.name, status.arguments).kind).toBe("git_status");

    const diff = normalizeCursorTool({
      name: "Shell",
      cwd: CWD,
      rawArguments: { command: "rtk git diff" },
    });
    expect(unwrapCommand("rtk git diff")).toBe("git diff");
    expect(classifyTool(diff.name, diff.arguments).kind).toBe("git_diff");

    const tests = normalizeCursorTool({
      name: "Shell",
      cwd: CWD,
      rawArguments: { command: "npm test" },
    });
    expect(classifyTool(tests.name, tests.arguments).kind).toBe("test_run");

    const build = normalizeCursorTool({
      name: "Shell",
      cwd: CWD,
      rawArguments: { command: "npm run build" },
    });
    expect(classifyTool(build.name, build.arguments).kind).toBe("build_run");

    const list = normalizeCursorTool({
      name: "Glob",
      cwd: CWD,
      rawArguments: { glob_pattern: "src/**" },
    });
    expect(list.arguments.path).toBe("src");
    expect(classifyTool(list.name, list.arguments).kind).toBe("directory_list");

    const echo = normalizeCursorTool({
      name: "Shell",
      cwd: CWD,
      rawArguments: { command: "echo hello" },
    });
    expect(classifyTool(echo.name, echo.arguments).kind).toBe("command");
  });
});
