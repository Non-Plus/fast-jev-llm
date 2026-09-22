import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".testhomes",
  ".context-engine",
  ".pnpm-store",
  ".cursor",
  ".vscode",
  ".idea",
  ".turbo",
]);

const PERSONAL_PATH =
  /(?:^|[^\w])(\/Users\/(?!alice\b|user\b|developer\b)[A-Za-z][A-Za-z0-9._-]*|\/home\/(?!alice\b|user\b|developer\b)[A-Za-z][A-Za-z0-9._-]*)/g;

const PRIVATE_KEY = /BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/;
const AWS_KEY = /\bAKIA[0-9A-Z]{16}\b/;
const GITHUB_TOKEN = /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/;
const OPENAI_LIVE = /\bsk-(?!a{8,})[A-Za-z0-9_-]{16,}\b/;
const CONN = /\b(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s:]+:[^@\s]+@/i;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.endsWith(".tgz")) {
      continue;
    }
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      walk(full, files);
    } else if (info.isFile() && info.size < 1_000_000) {
      files.push(full);
    }
  }
  return files;
}

function isSyntheticGithubToken(value: string): boolean {
  return value === "ghp_abcdefghijklmnopqrstuvwx";
}

describe("public-data scan", () => {
  it("does not include personal paths or live-looking secrets", () => {
    const findings: Array<{ file: string; category: string }> = [];
    for (const file of walk(repoRoot)) {
      const rel = relative(repoRoot, file);
      if (rel.includes(`${join("cli", "tests", "secret-scan")}`)) {
        continue;
      }
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (PERSONAL_PATH.test(text)) {
        findings.push({ file: rel, category: "personal-path" });
      }
      PERSONAL_PATH.lastIndex = 0;
      if (PRIVATE_KEY.test(text)) {
        findings.push({ file: rel, category: "private-key" });
      }
      if (AWS_KEY.test(text) && !text.includes("AKIAIOSFODNN7EXAMPLE")) {
        findings.push({ file: rel, category: "aws-access-key" });
      }
      const github = text.match(GITHUB_TOKEN) ?? [];
      if (github.some((token) => !isSyntheticGithubToken(token))) {
        findings.push({ file: rel, category: "github-token" });
      }
      if (OPENAI_LIVE.test(text) && !rel.endsWith("redact.ts") && !rel.includes("semantic/")) {
        findings.push({ file: rel, category: "api-key" });
      }
      if (CONN.test(text)) {
        findings.push({ file: rel, category: "connection-string" });
      }
    }
    expect(findings).toEqual([]);
  });
});
