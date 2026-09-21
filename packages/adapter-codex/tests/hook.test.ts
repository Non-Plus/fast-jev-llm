import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCodexHookCli } from "../src/hook.js";
import { fixturePath } from "./helpers.js";

describe("optional SessionEnd hook", () => {
  it("analyzes a transcript path and stores only the report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hook-shadow-"));
    try {
      await runCodexHookCli([
        "--analyze",
        fixturePath("normal-session.jsonl"),
        "--save-dir",
        dir,
      ]);
      const saved = await readFile(join(dir, "abc123.json"), "utf8");
      const parsed = JSON.parse(saved) as { metadata: { mode: string; sessionId: string } };
      expect(parsed.metadata.mode).toBe("shadow");
      expect(parsed.metadata.sessionId).toBe("abc123");
      expect(saved).not.toContain("session_meta");
      expect(saved).not.toContain("custom_tool_call");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails open when analysis cannot run", async () => {
    await expect(runCodexHookCli(["--analyze", join(tmpdir(), "missing-transcript.jsonl")])).resolves.toBeUndefined();
  });

  it("never inherits a non-zero exit into the parent hook path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hook-failopen-"));
    const bogus = join(dir, "not-a-session.txt");
    await writeFile(bogus, "not jsonl");
    await expect(runCodexHookCli(["--analyze", bogus, "--save-dir", dir])).resolves.toBeUndefined();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("detached hook spawn contract", () => {
  it("uses a child process that can be unref'd", () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      detached: true,
      stdio: "ignore",
    });
    expect(typeof child.unref).toBe("function");
    child.unref();
  });
});
