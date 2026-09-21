import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { runAgentHook } from "../src/hook-run.js";
import { loadReports } from "../src/store.js";
import { claudeFixture, codexFixture, cursorFixture, makeFakeHome } from "./helpers.js";

const homes: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((cleanup) => cleanup()));
});

describe("hook analysis", () => {
  it("fails open on missing transcript path and missing files", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    await expect(runAgentHook("codex", [], { paths: fake.paths, stdinText: "{}" })).resolves.toBeUndefined();
    await expect(
      runAgentHook("codex", ["--analyze", join(fake.home, "missing.jsonl")], { paths: fake.paths }),
    ).resolves.toBeUndefined();
    expect((await loadReports(fake.paths)).reports).toHaveLength(0);
  });

  it("records unknown agent version without failing", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    await runAgentHook("claude", ["--analyze", claudeFixture("unpaired-tool-call.jsonl")], { paths: fake.paths });
    const loaded = await loadReports(fake.paths);
    expect(loaded.reports).toHaveLength(1);
    expect(loaded.reports[0]?.agentVersion ?? "unknown").toBeTruthy();
  });

  it("does not print analysis output", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    const chunks: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      chunks.push(String(chunk));
      return original(chunk as never, ...(rest as never[]));
    }) as typeof process.stdout.write;
    try {
      await runAgentHook("codex", ["--analyze", codexFixture("normal-session.jsonl")], { paths: fake.paths });
    } finally {
      process.stdout.write = original;
    }
    expect(chunks.join("")).toBe("");
    const report = (await loadReports(fake.paths)).reports[0];
    expect(report?.sessionId).toBe("abc123");
    expect(JSON.stringify(report)).not.toContain("export const login");
  });

  it("stores Cursor completeness as tool_calls_only for unpaired calls", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    await runAgentHook("cursor", ["--analyze", cursorFixture("unpaired-tool-call.jsonl")], { paths: fake.paths });
    expect((await loadReports(fake.paths)).reports[0]?.dataCompleteness).toBe("tool_calls_only");
  });
});
