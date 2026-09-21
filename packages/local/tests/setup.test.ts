import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { installSelected, planInstall, uninstallAgents } from "../src/install.js";
import { resolveHookCommand } from "../src/hook-command.js";
import { loadConfig } from "../src/config.js";
import { runProductCommand } from "../src/cli.js";
import { assertFakeHome, captureIo, countMarker, makeFakeHome, seedAgentConfigs } from "./helpers.js";

const homes: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((cleanup) => cleanup()));
});

describe("setup safety", () => {
  it("preserves existing unrelated hooks and stays idempotent", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    assertFakeHome(fake.paths);
    expect(fake.paths.home).not.toBe(homedir());
    await seedAgentConfigs(fake.paths);

    const first = await installSelected(fake.paths, {
      agents: ["codex", "cursor", "claude"],
      dryRun: false,
      hookCommand: "ctx",
    });
    expect(first.wrote).toBe(true);

    const codex = await readFile(fake.paths.agentConfig.codex, "utf8");
    const cursor = await readFile(fake.paths.agentConfig.cursor, "utf8");
    const claude = await readFile(fake.paths.agentConfig.claude, "utf8");
    expect(codex).toContain("unrelated-codex-pre");
    expect(codex).toContain("unrelated-codex-end");
    expect(cursor).toContain("unrelated-cursor-end");
    expect(cursor).toContain("unrelated-cursor-start");
    expect(claude).toContain("unrelated-claude-pre");
    expect(claude).toContain("unrelated-claude-end");
    expect(claude).toContain("Bash");
    expect(countMarker(codex)).toBe(1);
    expect(countMarker(cursor)).toBe(1);
    expect(countMarker(claude)).toBe(1);

    const second = await installSelected(fake.paths, {
      agents: ["codex", "cursor", "claude"],
      dryRun: false,
      hookCommand: "ctx",
    });
    expect(countMarker(await readFile(fake.paths.agentConfig.codex, "utf8"))).toBe(1);
    expect(second.plans.every((plan) => plan.alreadyInstalled)).toBe(true);

    const removed = await uninstallAgents(fake.paths, ["codex", "cursor", "claude"]);
    expect(removed.every((entry) => entry.removed)).toBe(true);
    expect(await readFile(fake.paths.agentConfig.codex, "utf8")).toContain("unrelated-codex-end");
    expect(await readFile(fake.paths.agentConfig.codex, "utf8")).not.toContain("--context-engine-shadow");
    expect(await readFile(fake.paths.agentConfig.cursor, "utf8")).toContain("unrelated-cursor-start");
    expect(await readFile(fake.paths.agentConfig.claude, "utf8")).toContain("permissions");
  });

  it("dry-run performs no writes", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    await seedAgentConfigs(fake.paths);
    const beforeCodex = await readFile(fake.paths.agentConfig.codex, "utf8");
    const io = captureIo();
    const code = await runProductCommand(["setup", "--dry-run", "--agents", "codex,cursor,claude"], {
      paths: fake.paths,
      io,
    });
    expect(code).toBe(0);
    expect(io.text()).toContain("Will update:");
    expect(io.text()).toContain("Dry-run: no files were written.");
    expect(await readFile(fake.paths.agentConfig.codex, "utf8")).toBe(beforeCodex);
    await expect(stat(fake.paths.configPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(fake.paths.engineHome)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses malformed agent config instead of overwriting it", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    await seedAgentConfigs(fake.paths);
    await writeFile(fake.paths.agentConfig.codex, "{not json", "utf8");
    const result = await installSelected(fake.paths, {
      agents: ["codex"],
      dryRun: false,
      hookCommand: "ctx",
    });
    expect(result.skipped.join(" ")).toMatch(/malformed|JSON/i);
    expect(await readFile(fake.paths.agentConfig.codex, "utf8")).toBe("{not json");
  });

  it("handles missing agent config by creating only that file", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    const result = await installSelected(fake.paths, {
      agents: ["cursor"],
      dryRun: false,
      hookCommand: "ctx",
    });
    expect(result.wrote).toBe(true);
    const cursor = JSON.parse(await readFile(fake.paths.agentConfig.cursor, "utf8")) as {
      hooks: { sessionEnd: unknown[] };
    };
    expect(cursor.hooks.sessionEnd).toHaveLength(1);
    await expect(stat(fake.paths.agentConfig.codex)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports read-only config conservatively", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    await seedAgentConfigs(fake.paths);
    try {
      await chmod(fake.paths.agentConfig.claude, 0o444);
      await chmod(join(fake.home, "claude-config"), 0o555);
      const result = await installSelected(fake.paths, {
        agents: ["claude"],
        dryRun: false,
        hookCommand: "ctx",
      });
      const claude = await readFile(fake.paths.agentConfig.claude, "utf8");
      expect(claude).not.toContain("--context-engine-shadow");
      expect(claude).toContain("unrelated-claude-end");
      expect(result.skipped.length).toBeGreaterThan(0);
    } finally {
      await chmod(join(fake.home, "claude-config"), 0o755).catch(() => undefined);
      await chmod(fake.paths.agentConfig.claude, 0o644).catch(() => undefined);
    }
  });

  it("does not enable remote semantic mode without --confirm-remote", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    await expect(
      installSelected(fake.paths, {
        agents: ["codex"],
        dryRun: false,
        semanticMode: "remote",
        confirmRemote: false,
      }),
    ).rejects.toThrow(/confirm/i);
    const loaded = await loadConfig(fake.paths);
    expect(loaded.exists).toBe(false);
  });

  it("planInstall notes malformed files", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    await seedAgentConfigs(fake.paths);
    await writeFile(fake.paths.agentConfig.cursor, "[]", "utf8");
    const plans = await planInstall(fake.paths, resolveHookCommand("ctx"), ["cursor"]);
    expect(plans[0]?.notes.join(" ")).toMatch(/not a JSON object|malformed/i);
    expect(plans[0]?.wouldWrite).toBe(false);
  });
});
