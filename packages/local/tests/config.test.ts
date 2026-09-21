import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, loadConfig, parseConfig } from "../src/config.js";
import { parseOlderThan } from "../src/args.js";
import { runProductCommand } from "../src/cli.js";
import { captureIo, makeFakeHome } from "./helpers.js";

const homes: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((cleanup) => cleanup()));
});

describe("config", () => {
  it("defaults to local deterministic shadow with no remote provider", () => {
    const config = defaultConfig();
    expect(config.semanticMode).toBe("off");
    expect(config.semanticProvider).toBeNull();
    expect(config.reportPreviews).toBe(false);
    expect(config.retentionDays).toBeNull();
    expect(config.enabledAgents).toEqual(["codex", "cursor", "claude"]);
  });

  it("falls back on malformed objects and never copies secrets", () => {
    const parsed = parseConfig({
      schemaVersion: 1,
      semanticMode: "remote",
      semanticProvider: "jev",
      reportPreviews: true,
      apiKey: "sk-secret",
      TYPESAFE_API_KEY: "nope",
    });
    expect(parsed.semanticMode).toBe("remote");
    expect(parsed.semanticProvider).toBe("jev");
    expect(JSON.stringify(parsed)).not.toContain("sk-secret");
    expect(JSON.stringify(parsed)).not.toContain("TYPESAFE");
    expect(parseConfig("bad").semanticMode).toBe("off");
  });

  it("loads missing and malformed config files without throwing", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    const missing = await loadConfig(fake.paths);
    expect(missing.exists).toBe(false);
    expect(missing.config.semanticMode).toBe("off");
    await mkdir(dirname(fake.paths.configPath), { recursive: true });
    await writeFile(fake.paths.configPath, "{bad", "utf8");
    const malformed = await loadConfig(fake.paths);
    expect(malformed.exists).toBe(true);
    expect(malformed.error).toBeTruthy();
    expect(malformed.config.semanticMode).toBe("off");
  });

  it("refuses reports clear without --yes", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    const io = captureIo();
    const code = await runProductCommand(["reports", "clear"], { paths: fake.paths, io });
    expect(code).toBe(1);
    expect(io.errText()).toMatch(/--yes/);
  });

  it("parses retention windows", () => {
    expect(parseOlderThan("30d")).toBe(30 * 24 * 60 * 60 * 1000);
    expect(() => parseOlderThan("30")).toThrow();
  });
});
