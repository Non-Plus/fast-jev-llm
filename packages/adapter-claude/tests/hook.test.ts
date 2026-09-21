import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runClaudeHookCli } from "../src/hook.js";
import { fixturePath } from "./helpers.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("optional Claude SessionEnd hook", () => {
  it("analyzes a transcript in --analyze mode and writes only a report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-hook-shadow-"));
    dirs.push(dir);
    await runClaudeHookCli([
      "--analyze",
      fixturePath("conformance/operations.claude.jsonl"),
      "--save-dir",
      dir,
    ]);
    const saved = await readFile(join(dir, "ops-claude.json"), "utf8");
    const parsed = JSON.parse(saved) as { metadata: { sessionId: string; source: string } };
    expect(parsed.metadata.sessionId).toBe("ops-claude");
    expect(parsed.metadata.source).toBe("claude");
  });

  it("fails open when the transcript is missing", async () => {
    await expect(
      runClaudeHookCli(["--analyze", join(tmpdir(), "missing-claude-transcript.jsonl")]),
    ).resolves.toBeUndefined();
  });

  it("fails open on a truncated jsonl file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-hook-failopen-"));
    dirs.push(dir);
    const bogus = join(dir, "broken.jsonl");
    await writeFile(bogus, "{not json\n");
    await expect(runClaudeHookCli(["--analyze", bogus, "--save-dir", dir])).resolves.toBeUndefined();
  });
});
