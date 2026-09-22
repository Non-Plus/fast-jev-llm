import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseNpmPackJson } from "./parse-npm-pack-json.ts";

const cliRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeout ?? 60_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("packed artifact", () => {
  it("installs a compiled ctx that works without tsx or the repo", () => {
    const build = run(process.execPath, ["scripts/build.mjs"], { cwd: cliRoot });
    expect(build.status, build.stderr || build.stdout).toBe(0);

    const pack = run("npm", ["pack", "--json", "--loglevel=error"], {
      cwd: cliRoot,
      env: { ...process.env, NPM_CONFIG_LOGLEVEL: "error" },
    });
    expect(pack.status, `${pack.stderr}\n${pack.stdout}`).toBe(0);
    const packed = parseNpmPackJson(pack.stdout);
    const filename = packed[0]?.filename;
    expect(filename).toMatch(/fast-jev-llm-0\.1\.0\.tgz$/);
    const tarball = join(cliRoot, filename!);

    const prefix = mkdtempSync(join(tmpdir(), "ctx-prefix-"));
    const home = mkdtempSync(join(tmpdir(), "ctx-home-"));
    try {
      const install = run("npm", ["install", "--ignore-scripts", "-g", "--prefix", prefix, tarball]);
      expect(install.status, install.stderr).toBe(0);
      const ctx = join(prefix, "bin", "ctx");
      const env = {
        ...process.env,
        HOME: home,
        PATH: `${join(prefix, "bin")}:${process.env.PATH ?? ""}`,
        CONTEXT_ENGINE_HOME: join(home, ".context-engine"),
      };
      const help = run(ctx, ["--help"], { env });
      expect(help.status).toBe(0);
      expect(help.stdout).toContain("Shadow mode only");
      expect(help.stdout).not.toContain("tsx");

      const version = run(ctx, ["--version"], { env });
      expect(version.status).toBe(0);
      expect(version.stdout).toContain("0.1.0");

      const dry = run(ctx, ["setup", "--dry-run", "--yes", "--agents", "codex"], { env });
      expect(dry.status, dry.stderr).toBe(0);
      expect(dry.stdout).toContain("ctx hook codex --context-engine-shadow");
      expect(dry.stdout).not.toContain("--import tsx");
      expect(dry.stdout).not.toContain(cliRoot);

      const status = run(ctx, ["status"], { env });
      expect(status.status, status.stderr).toBe(0);

      const doctor = run(ctx, ["doctor"], { env });
      expect(doctor.stdout).toContain("Context Engine doctor");
      expect(doctor.stdout).not.toMatch(/sk-[A-Za-z0-9]/);

      const npx = run("npx", ["--yes", `--package=${tarball}`, "ctx", "--help"], { env });
      expect(npx.status, npx.stderr).toBe(0);
      expect(npx.stdout).toContain("ctx setup");
    } finally {
      rmSync(prefix, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(tarball, { force: true });
    }
  }, 120_000);
});
