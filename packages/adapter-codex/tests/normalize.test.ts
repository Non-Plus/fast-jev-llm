import { classifyTool } from "@fast-jev/core";
import { describe, expect, it } from "vitest";
import { normalizeProjectPath } from "../src/path-normalize.js";
import { normalizeCodexTool, unwrapCommand } from "../src/tool-normalize.js";

const CWD = "/Users/user/project";

describe("path normalization", () => {
  it("resolves relative, dotted, and absolute paths to the same project path", () => {
    const paths = ["./src/auth.ts", "src/auth.ts", "/Users/user/project/src/auth.ts"];
    const canonical = paths.map((path) => normalizeProjectPath(path, CWD)?.canonical);
    expect(canonical).toEqual(["src/auth.ts", "src/auth.ts", "src/auth.ts"]);
  });

  it("does not map paths outside the repository into project paths", () => {
    const outside = normalizeProjectPath("../other/secret.ts", CWD);
    expect(outside?.outsideRepo).toBe(true);
    expect(outside?.canonical).toBeUndefined();
    expect(outside?.original).toBe("../other/secret.ts");

    const absOutside = normalizeProjectPath("/etc/passwd", CWD);
    expect(absOutside?.outsideRepo).toBe(true);
    expect(absOutside?.canonical).toBeUndefined();
  });

  it("preserves the original path alongside the canonical one", () => {
    const normalized = normalizeProjectPath("./src/auth.ts", CWD);
    expect(normalized).toEqual({
      original: "./src/auth.ts",
      canonical: "src/auth.ts",
      outsideRepo: false,
    });
  });
});

describe("Codex tool normalization", () => {
  it("classifies exec_command git status as git_status", () => {
    const tool = normalizeCodexTool({
      name: "exec",
      cwd: CWD,
      rawArguments:
        'const r = await tools.exec_command({cmd:"git status","workdir":"/Users/user/project"});text(r.output);',
    });
    expect(tool.arguments.command).toBe("git status");
    expect(classifyTool(tool.name, tool.arguments).kind).toBe("git_status");
  });

  it("unwraps rtk-prefixed git and shell commands", () => {
    expect(unwrapCommand("rtk git status")).toBe("git status");
    const tool = normalizeCodexTool({
      name: "exec",
      cwd: CWD,
      rawArguments:
        'const r = await tools.exec_command({cmd:"rtk git diff src/auth.ts"});text(r.output);',
    });
    expect(classifyTool(tool.name, tool.arguments).kind).toBe("git_diff");
  });

  it("classifies file reads, listings, tests, and writes", () => {
    const read = normalizeCodexTool({
      name: "exec",
      cwd: CWD,
      rawArguments: 'tools.exec_command({cmd:"cat ./src/auth.ts"})',
    });
    expect(read.arguments.path).toBe("src/auth.ts");
    expect(read.arguments.originalPath).toBe("./src/auth.ts");
    expect(classifyTool(read.name, read.arguments).kind).toBe("file_read");

    const list = normalizeCodexTool({
      name: "exec",
      cwd: CWD,
      rawArguments: 'tools.exec_command({cmd:"ls src"})',
    });
    expect(classifyTool(list.name, list.arguments).kind).toBe("directory_list");

    const test = normalizeCodexTool({
      name: "exec",
      cwd: CWD,
      rawArguments: 'tools.exec_command({cmd:"pnpm test"})',
    });
    expect(classifyTool(test.name, test.arguments).kind).toBe("test_run");

    const patch = normalizeCodexTool({
      name: "apply_patch",
      cwd: CWD,
      rawArguments: JSON.stringify({
        patch: "*** Begin Patch\n*** Update File: src/auth.ts\n@@\n-a\n+b\n",
      }),
    });
    expect(patch.arguments.path).toBe("src/auth.ts");
    expect(classifyTool(patch.name, patch.arguments).kind).toBe("file_write");
  });

  it("classifies generic shell and build commands without inventing file paths", () => {
    const build = normalizeCodexTool({
      name: "exec_command",
      cwd: CWD,
      rawArguments: { command: "npm run build" },
    });
    expect(classifyTool(build.name, build.arguments).kind).toBe("build_run");
    expect(build.arguments.path).toBeUndefined();

    const echo = normalizeCodexTool({
      name: "exec_command",
      cwd: CWD,
      rawArguments: { command: "echo hello" },
    });
    expect(classifyTool(echo.name, echo.arguments).kind).toBe("command");
    expect(echo.arguments.path).toBeUndefined();
  });
});
