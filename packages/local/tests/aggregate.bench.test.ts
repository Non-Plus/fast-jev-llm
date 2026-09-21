import { afterEach, describe, expect, it } from "vitest";
import { aggregateReports } from "../src/aggregate.js";
import { loadReports, writeStoreReport } from "../src/store.js";
import { makeFakeHome, sampleReport } from "./helpers.js";
import type { AgentId } from "../src/types.js";

const homes: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((cleanup) => cleanup()));
});

const AGENTS: AgentId[] = ["codex", "cursor", "claude"];

async function seed(count: number): Promise<{ msWrite: number; msRead: number; sessions: number }> {
  const fake = await makeFakeHome();
  homes.push(fake.cleanup);
  const startedWrite = performance.now();
  const writes: Promise<string>[] = [];
  for (let i = 0; i < count; i += 1) {
    const agent = AGENTS[i % 3]!;
    writes.push(
      writeStoreReport(
        fake.paths,
        sampleReport({
          sessionId: `s${i}`,
          agent,
          timestamp: new Date(Date.parse("2026-09-01T00:00:00.000Z") + i * 1000).toISOString(),
          originalTokens: 1000 + i,
          effectiveTokens: 400 + (i % 50),
        }),
      ),
    );
    if (writes.length >= 250) {
      await Promise.all(writes);
      writes.length = 0;
    }
  }
  await Promise.all(writes);
  const msWrite = performance.now() - startedWrite;
  const startedRead = performance.now();
  const loaded = await loadReports(fake.paths);
  const stats = aggregateReports(loaded.reports);
  const msRead = performance.now() - startedRead;
  expect(stats.sessionCount).toBe(count);
  expect(loaded.skipped).toBe(0);
  return { msWrite, msRead, sessions: stats.sessionCount };
}

describe("report aggregation benchmark", () => {
  it("aggregates 100 reports comfortably", async () => {
    const result = await seed(100);
    expect(result.msRead).toBeLessThan(5_000);
  });

  it("aggregates 1,000 reports comfortably", async () => {
    const result = await seed(1000);
    expect(result.msRead).toBeLessThan(15_000);
  }, 60_000);

  it("aggregates 10,000 reports if practical", async () => {
    const result = await seed(10_000);
    expect(result.msRead).toBeLessThan(45_000);
    if (result.msRead > 10_000) {
      console.warn(
        `JSON-file aggregation for 10,000 reports took ${Math.round(result.msRead)}ms (write ${Math.round(result.msWrite)}ms). Still no database.`,
      );
    }
  }, 120_000);
});
