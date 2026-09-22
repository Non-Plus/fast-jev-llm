import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runProductCommand } from "../src/cli.js";
import { runAgentHook } from "../src/hook-run.js";
import { loadConfig } from "../src/config.js";
import { claudeFixture, captureIo, codexFixture, cursorFixture, makeFakeHome, seedAgentConfigs } from "./helpers.js";

const homes: Array<() => Promise<void>> = [];
const previousSync = process.env.CONTEXT_ENGINE_HOOK_SYNC;
const previousHook = process.env.CONTEXT_ENGINE_HOOK_COMMAND;

beforeEach(() => {
  process.env.CONTEXT_ENGINE_HOOK_SYNC = "1";
  process.env.CONTEXT_ENGINE_HOOK_COMMAND = "ctx";
});

afterEach(async () => {
  if (previousSync === undefined) {
    delete process.env.CONTEXT_ENGINE_HOOK_SYNC;
  } else {
    process.env.CONTEXT_ENGINE_HOOK_SYNC = previousSync;
  }
  if (previousHook === undefined) {
    delete process.env.CONTEXT_ENGINE_HOOK_COMMAND;
  } else {
    process.env.CONTEXT_ENGINE_HOOK_COMMAND = previousHook;
  }
  await Promise.all(homes.splice(0).map((cleanup) => cleanup()));
});

describe("end-to-end setup in a fake HOME", () => {
  it("installs hooks, analyzes SessionEnd payloads, reports, then uninstalls only our entries", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    await seedAgentConfigs(fake.paths);

    const setupIo = captureIo();
    const setupCode = await runProductCommand(["setup", "--yes", "--agents", "codex,cursor,claude"], {
      paths: fake.paths,
      io: setupIo,
    });
    expect(setupCode).toBe(0);
    expect(setupIo.text()).toContain("SessionEnd");
    expect(await readFile(fake.paths.agentConfig.codex, "utf8")).toContain(
      "ctx hook codex --context-engine-shadow",
    );
    expect(await readFile(fake.paths.agentConfig.cursor, "utf8")).toContain(
      "ctx hook cursor --context-engine-shadow",
    );
    expect(await readFile(fake.paths.agentConfig.claude, "utf8")).toContain(
      "ctx hook claude --context-engine-shadow",
    );
    expect(await readFile(fake.paths.agentConfig.codex, "utf8")).not.toContain("tsx");
    const config = await loadConfig(fake.paths);
    expect(config.config.semanticMode).toBe("off");
    expect(config.config.reportPreviews).toBe(false);

    await runAgentHook("codex", [], {
      paths: fake.paths,
      stdinText: JSON.stringify({
        transcript_path: codexFixture("normal-session.jsonl"),
        cwd: "/Users/user/project",
        cli_version: "0.151.0",
      }),
    });
    await runAgentHook("cursor", [], {
      paths: fake.paths,
      stdinText: JSON.stringify({
        transcript_path: cursorFixture("unpaired-tool-call.jsonl"),
        cursor_version: "3.21.16",
        workspace_roots: ["/Users/user/project"],
      }),
    });
    await runAgentHook("claude", [], {
      paths: fake.paths,
      stdinText: JSON.stringify({
        transcript_path: claudeFixture("unpaired-tool-call.jsonl"),
        cwd: "/Users/user/project",
        version: "2.1.251",
      }),
    });

    const statusIo = captureIo();
    expect(await runProductCommand(["status"], { paths: fake.paths, io: statusIo })).toBe(0);
    expect(statusIo.text()).toContain("Shadow analysis");
    expect(statusIo.text()).toContain("Telemetry                 OFF");
    expect(statusIo.text()).toContain("Sessions analyzed        3");

    const sessionsIo = captureIo();
    expect(await runProductCommand(["sessions"], { paths: fake.paths, io: sessionsIo })).toBe(0);
    expect(sessionsIo.text()).toContain("abc123");

    const sessionIo = captureIo();
    expect(await runProductCommand(["session", "abc123"], { paths: fake.paths, io: sessionIo })).toBe(0);
    expect(sessionIo.text()).toContain("No raw transcript was stored.");

    const statsIo = captureIo();
    expect(await runProductCommand(["stats"], { paths: fake.paths, io: statsIo })).toBe(0);
    expect(statsIo.text()).toContain("Data completeness");
    expect(statsIo.text()).toMatch(/tool_calls_only|full_tool_results/);

    const jsonIo = captureIo();
    expect(await runProductCommand(["stats", "--json"], { paths: fake.paths, io: jsonIo })).toBe(0);
    const parsed = JSON.parse(jsonIo.text()) as { includesTranscripts: boolean; telemetry: boolean };
    expect(parsed.includesTranscripts).toBe(false);
    expect(parsed.telemetry).toBe(false);

    const doctorIo = captureIo();
    const doctorCode = await runProductCommand(["doctor"], { paths: fake.paths, io: doctorIo });
    expect(doctorCode).toBe(0);
    expect(doctorIo.text()).not.toMatch(/sk-|api[_-]?key/i);

    const dogfoodIo = captureIo();
    expect(await runProductCommand(["dogfood", "status"], { paths: fake.paths, io: dogfoodIo })).toBe(0);
    expect(dogfoodIo.text()).toContain("Dogfooding");

    const uninstallIo = captureIo();
    expect(await runProductCommand(["uninstall"], { paths: fake.paths, io: uninstallIo })).toBe(0);
    expect(await readFile(fake.paths.agentConfig.codex, "utf8")).toContain("unrelated-codex-end");
    expect(await readFile(fake.paths.agentConfig.codex, "utf8")).not.toContain("--context-engine-shadow");
    expect(await readFile(fake.paths.agentConfig.cursor, "utf8")).toContain("unrelated-cursor-start");
    expect(await readFile(fake.paths.agentConfig.claude, "utf8")).toContain("unrelated-claude-end");
  });
});
