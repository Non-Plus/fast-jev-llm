import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearReports, loadReports, pruneReports, writeStoreReport } from "../src/store.js";
import { parseStoreReport, reportFileName } from "../src/report-schema.js";
import { aggregateReports } from "../src/aggregate.js";
import { toStoreReport } from "../src/snapshot.js";
import { workspaceDisplayName, workspaceId } from "../src/workspace.js";
import { makeFakeHome, sampleReport } from "./helpers.js";

const homes: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((cleanup) => cleanup()));
});

describe("report schema and store", () => {
  it("skips unsupported schema versions and corrupted files", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    const good = sampleReport({ sessionId: "abc", agent: "codex" });
    await writeStoreReport(fake.paths, good);
    await mkdir(join(fake.paths.reportsRoot, "codex"), { recursive: true });
    await writeFile(join(fake.paths.reportsRoot, "codex", "legacy.json"), JSON.stringify({ schemaVersion: 99, sessionId: "x", agent: "codex" }), "utf8");
    await writeFile(join(fake.paths.reportsRoot, "codex", "broken.json"), "{nope", "utf8");
    const loaded = await loadReports(fake.paths);
    expect(loaded.reports).toHaveLength(1);
    expect(loaded.skipped).toBe(2);
    expect(parseStoreReport({ schemaVersion: 99, sessionId: "x", agent: "codex" })).toBeUndefined();
  });

  it("is idempotent for the same agent/session/engine/mode", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    const report = sampleReport({ sessionId: "same", agent: "cursor", engineVersion: "0.1.0", originalTokens: 10 });
    const first = await writeStoreReport(fake.paths, report);
    expect(first.endsWith(reportFileName(report))).toBe(true);
    await writeStoreReport(fake.paths, { ...report, originalTokens: 11 });
    const loaded = await loadReports(fake.paths);
    expect(loaded.reports).toHaveLength(1);
    expect(loaded.reports[0]?.originalTokens).toBe(11);
    await writeStoreReport(fake.paths, { ...report, engineVersion: "0.2.0", reportId: "other" });
    expect((await loadReports(fake.paths)).reports).toHaveLength(2);
  });

  it("hashes workspace paths and keeps only a basename display name", () => {
    const path = "/Users/alice/project/sample-app";
    expect(workspaceDisplayName(path)).toBe("sample-app");
    expect(workspaceId(path)).toHaveLength(16);
    expect(workspaceId(path)).not.toContain("/");
    const report = toStoreReport({
      sessionId: "ws",
      agent: "codex",
      cwd: path,
      originalTokens: 8,
      effectiveTokens: 8,
      protectedVerbatimTokens: 8,
      protectedCompressibleTokens: 0,
      keptTokens: 0,
      compressedRetainedTokens: 0,
      droppedTokens: 0,
      compressionSavings: 0,
      dropSavings: 0,
      potentialReductionPercent: 0,
      reasonCodeTotals: {},
      semanticMode: "off",
      items: [],
      durationMs: 1,
    });
    const json = JSON.stringify(report);
    expect(json).not.toContain("/Users/alice/project/sample-app");
    expect(json).toContain("sample-app");
    expect(report.workspaceId).toBe(workspaceId(path));
  });

  it("does not copy source previews into store reports", () => {
    const report = toStoreReport({
      sessionId: "priv",
      agent: "claude",
      originalTokens: 20,
      effectiveTokens: 20,
      protectedVerbatimTokens: 0,
      protectedCompressibleTokens: 0,
      keptTokens: 20,
      compressedRetainedTokens: 0,
      droppedTokens: 0,
      compressionSavings: 0,
      dropSavings: 0,
      potentialReductionPercent: 0,
      reasonCodeTotals: {},
      semanticMode: "off",
      items: [
        {
          kind: "message",
          action: "KEEP",
          reasonCode: "RECENT_USER_MESSAGE",
          savedTokens: 0,
        },
      ],
      durationMs: 3,
    });
    const json = JSON.stringify(report);
    expect(json).not.toContain("preview");
    expect(json).not.toContain("SECRET");
    expect(report.dataCompleteness).toBe("unknown");
  });

  it("prunes and clears only on explicit action", async () => {
    const fake = await makeFakeHome();
    homes.push(fake.cleanup);
    await writeStoreReport(
      fake.paths,
      sampleReport({
        sessionId: "old",
        agent: "codex",
        timestamp: "2020-01-01T00:00:00.000Z",
      }),
    );
    await writeStoreReport(
      fake.paths,
      sampleReport({
        sessionId: "new",
        agent: "codex",
        timestamp: "2026-09-21T00:00:00.000Z",
      }),
    );
    expect(await pruneReports(fake.paths, 30 * 24 * 60 * 60 * 1000, Date.parse("2026-09-21T00:00:00.000Z"))).toBe(1);
    expect((await loadReports(fake.paths)).reports).toHaveLength(1);
    expect(await clearReports(fake.paths)).toBe(1);
    expect((await loadReports(fake.paths)).reports).toHaveLength(0);
  });

  it("aggregates completeness instead of silently mixing agents", () => {
    const stats = aggregateReports([
      sampleReport({ sessionId: "a", agent: "codex", dataCompleteness: "full_tool_results", originalTokens: 100, effectiveTokens: 50 }),
      sampleReport({ sessionId: "b", agent: "cursor", dataCompleteness: "tool_calls_only", originalTokens: 100, effectiveTokens: 90 }),
    ]);
    expect(stats.completeness.full_tool_results).toBe(1);
    expect(stats.completeness.tool_calls_only).toBe(1);
    expect(stats.byAgent.cursor.completeness.tool_calls_only).toBe(1);
  });
});
