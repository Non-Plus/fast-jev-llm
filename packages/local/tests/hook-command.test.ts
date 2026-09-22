import { afterEach, describe, expect, it } from "vitest";
import { hookInvocation, resolveHookCommand } from "../src/hook-command.js";
import { displayUserPath } from "../src/paths.js";

const originalArgv1 = process.argv[1];

afterEach(() => {
  process.argv[1] = originalArgv1;
  delete process.env.CONTEXT_ENGINE_HOOK_COMMAND;
});

describe("resolveHookCommand", () => {
  it("prefers an explicit command", () => {
    expect(resolveHookCommand("ctx")).toBe("ctx");
  });

  it("uses CONTEXT_ENGINE_HOOK_COMMAND", () => {
    process.env.CONTEXT_ENGINE_HOOK_COMMAND = "/opt/ctx";
    expect(resolveHookCommand()).toBe("/opt/ctx");
  });

  it("uses tsx only when the running entry is TypeScript source", () => {
    process.argv[1] = "/Users/alice/project/cli/src/index.ts";
    expect(resolveHookCommand()).toMatch(/--import tsx .*index\.ts$/);
  });

  it("uses the stable ctx binary for compiled installs", () => {
    process.argv[1] = "/usr/lib/node_modules/fast-jev-llm/dist/ctx.js";
    expect(resolveHookCommand()).toBe("ctx");
  });
});

describe("hookInvocation", () => {
  it("writes portable SessionEnd commands", () => {
    expect(hookInvocation("ctx", "codex")).toBe("ctx hook codex --context-engine-shadow");
    expect(hookInvocation("ctx", "cursor")).toBe("ctx hook cursor --context-engine-shadow");
    expect(hookInvocation("ctx", "claude")).toBe("ctx hook claude --context-engine-shadow");
  });
});

describe("displayUserPath", () => {
  it("replaces the home prefix with ~", () => {
    expect(displayUserPath("/Users/alice/project", "/Users/alice")).toBe("~/project");
    expect(displayUserPath("/home/developer/project", "/home/developer")).toBe("~/project");
  });
});
