import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseNpmPackJson } from "./parse-npm-pack-json.ts";

const cliRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

const PROHIBITED = [
  /\.env(?:\.|$)/i,
  /\.context-engine/,
  /node_modules/,
  /coverage/,
  /\.testhomes/,
  /fixtures/,
  /benchmarks/,
  /\.(png|jpg|jpeg|webp)$/i,
  /transcript/i,
  /\.map$/,
  /src\//,
  /tests\//,
];

function ensureBuilt(): void {
  const build = spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: cliRoot,
    encoding: "utf8",
  });
  expect(build.status, build.stderr || build.stdout).toBe(0);
  expect(existsSync(join(cliRoot, "dist", "ctx.js"))).toBe(true);
}

describe("npm package contents", () => {
  it("ships only the compiled CLI and public docs", () => {
    ensureBuilt();
    const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts", "--loglevel=error"], {
      cwd: cliRoot,
      encoding: "utf8",
      env: { ...process.env, NPM_CONFIG_LOGLEVEL: "error" },
    });
    expect(packed.status, `${packed.stderr}\n${packed.stdout}`).toBe(0);
    const parsed = parseNpmPackJson(packed.stdout, packed.stderr);
    const files = (parsed[0]?.files ?? []).map((entry) => entry.path.replace(/\\/g, "/"));
    expect(files).toContain("package.json");
    expect(files).toContain("dist/ctx.js");
    expect(files).toContain("README.md");
    expect(files).toContain("LICENSE");
    expect(files).toContain("CHANGELOG.md");
    const pkg = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      bin?: { ctx?: string };
    };
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.bin?.ctx).toBe("./dist/ctx.js");
    for (const path of files) {
      for (const pattern of PROHIBITED) {
        expect(path, path).not.toMatch(pattern);
      }
    }
  });
});
