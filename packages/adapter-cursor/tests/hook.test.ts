import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCursorHookCli } from "../src/hook.js";
import { fixturePath } from "./helpers.js";

describe("optional sessionEnd hook", () => {
  it("analyzes a transcript path and stores only the report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-hook-shadow-"));
    try {
      await runCursorHookCli([
        "--analyze",
        fixturePath("conformance/operations.cursor.jsonl"),
        "--save-dir",
        dir,
      ]);
      const saved = await readFile(join(dir, "ops-cursor.json"), "utf8");
      const parsed = JSON.parse(saved) as { metadata: { mode: string; sessionId: string; source: string } };
      expect(parsed.metadata.mode).toBe("shadow");
      expect(parsed.metadata.sessionId).toBe("ops-cursor");
      expect(parsed.metadata.source).toBe("cursor");
      expect(saved).not.toContain("tool_use");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails open when analysis cannot run", async () => {
    await expect(
      runCursorHookCli(["--analyze", join(tmpdir(), "missing-cursor-transcript.jsonl")]),
    ).resolves.toBeUndefined();
  });

  it("never inherits a non-zero exit into the parent hook path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-hook-failopen-"));
    const bogus = join(dir, "not-a-session.txt");
    await writeFile(bogus, "not jsonl");
    await expect(runCursorHookCli(["--analyze", bogus, "--save-dir", dir])).resolves.toBeUndefined();
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
