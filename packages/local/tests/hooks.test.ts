import { describe, expect, it } from "vitest";
import { applyClaudeHook, removeClaudeHook } from "../src/hooks/claude.js";
import { applyCodexHook, removeCodexHook } from "../src/hooks/codex.js";
import { applyCursorHook, removeCursorHook } from "../src/hooks/cursor.js";
import { hookInvocation } from "../src/hook-command.js";

const ours = hookInvocation("ctx", "codex");

describe("hook installers preserve unrelated hooks", () => {
  it("keeps multiple Codex hooks and is idempotent", () => {
    const existing = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "echo pre" }] }],
        SessionEnd: [
          { hooks: [{ type: "command", command: "echo first-end" }] },
          { hooks: [{ type: "command", command: "echo second-end" }] },
        ],
      },
    };
    const first = applyCodexHook(existing, ours);
    expect(first.changed).toBe(true);
    expect(JSON.stringify(first.next)).toContain("echo pre");
    expect(JSON.stringify(first.next)).toContain("echo first-end");
    expect(JSON.stringify(first.next)).toContain("echo second-end");
    expect(JSON.stringify(first.next)).toContain("--context-engine-shadow");
    const second = applyCodexHook(first.next, ours);
    expect(second.changed).toBe(false);
    expect(JSON.stringify(second.next).split("--context-engine-shadow").length - 1).toBe(1);
    const removed = removeCodexHook(second.next);
    expect(removed.changed).toBe(true);
    expect(JSON.stringify(removed.next)).toContain("echo pre");
    expect(JSON.stringify(removed.next)).toContain("echo first-end");
    expect(JSON.stringify(removed.next)).not.toContain("--context-engine-shadow");
  });

  it("keeps Cursor sessionStart and extra sessionEnd entries", () => {
    const existing = {
      version: 1,
      hooks: {
        sessionStart: [{ command: "echo start" }],
        sessionEnd: [{ command: "echo other-end" }],
      },
    };
    const command = hookInvocation("ctx", "cursor");
    const first = applyCursorHook(existing, command);
    expect(first.next.hooks).toMatchObject({
      sessionStart: [{ command: "echo start" }],
    });
    expect(JSON.stringify(first.next)).toContain("echo other-end");
    expect(applyCursorHook(first.next, command).changed).toBe(false);
    const removed = removeCursorHook(first.next);
    expect(JSON.stringify(removed.next)).toContain("echo start");
    expect(JSON.stringify(removed.next)).toContain("echo other-end");
    expect(JSON.stringify(removed.next)).not.toContain("--context-engine-shadow");
  });

  it("preserves Claude settings keys besides SessionEnd", () => {
    const existing = {
      permissions: { allow: ["Bash"] },
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "echo pre" }] }],
        SessionEnd: [{ hooks: [{ type: "command", command: "echo end" }] }],
      },
    };
    const command = hookInvocation("ctx", "claude");
    const first = applyClaudeHook(existing, command);
    expect(first.next.permissions).toEqual({ allow: ["Bash"] });
    expect(JSON.stringify(first.next)).toContain("echo pre");
    expect(JSON.stringify(first.next)).toContain("echo end");
    expect(applyClaudeHook(first.next, command).alreadyInstalled).toBe(true);
    const removed = removeClaudeHook(first.next);
    expect(removed.next.permissions).toEqual({ allow: ["Bash"] });
    expect(JSON.stringify(removed.next)).not.toContain("--context-engine-shadow");
  });

  it("refuses to treat malformed objects as empty configs on remove", () => {
    expect(removeCodexHook("nope").conservative).toBe(true);
    expect(removeCursorHook(["bad"]).conservative).toBe(true);
    expect(removeClaudeHook(null).conservative).toBe(true);
  });
});

describe("hook command marker", () => {
  it("does not look like a mutation hook", async () => {
    const { HOOK_MARKER } = await import("../src/types.js");
    expect(ours).toContain("hook");
    expect(ours).toContain(HOOK_MARKER);
    expect(ours.toLowerCase()).not.toContain("compact");
    expect(ours.toLowerCase()).not.toContain("rewrite");
  });
});
