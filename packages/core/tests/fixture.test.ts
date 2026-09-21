import { describe, expect, it } from "vitest";
import { buildCodingSessionTranscript } from "../../../fixtures/coding-session.ts";
import { compact, formatStats } from "../src/index.js";

describe("coding session fixture", () => {
  it("compacts a realistic session and reports per-rule statistics", async () => {
    const transcript = buildCodingSessionTranscript();
    const before = JSON.stringify(transcript);
    const result = await compact(transcript);

    expect(JSON.stringify(transcript)).toBe(before);
    expect(result.sessionId).toBe("coding-session-rate-limit");
    expect(result.decisions).toHaveLength(result.items.length);
    expect(result.stats.compactTokens).toBeLessThan(result.stats.originalTokens);
    expect(result.stats.droppedCount).toBeGreaterThan(0);
    expect(result.stats.compressedCount).toBeGreaterThan(0);
    expect(result.stats.protectedCount).toBeGreaterThan(0);

    const byRule = result.stats.byRule;
    expect(byRule["superseded-file-read"]?.count).toBeGreaterThan(0);
    expect(byRule["superseded-git-status"]?.count).toBeGreaterThan(0);
    expect(byRule["superseded-git-diff"]?.count).toBeGreaterThan(0);
    expect(byRule["old-directory-listing"]?.count).toBeGreaterThan(0);
    expect(byRule["repeated-command-output"]?.count).toBeGreaterThan(0);
    expect(byRule["compress-large-output"]?.count).toBeGreaterThan(0);
    expect(result.stats.byReasonCode["SUPERSEDED_FILE_READ"]?.count).toBeGreaterThan(0);
    expect(result.stats.byReasonCode["WRITE_INVALIDATED_READ"]?.count).toBeGreaterThan(0);
    expect(result.stats.byReasonCode["DUPLICATE_OUTPUT"]?.count).toBeGreaterThan(0);
    expect(result.evaluations.length).toBeGreaterThanOrEqual(
      result.decisions.filter((decision) => decision.rule !== "default").length,
    );
    expect(result.session.task.constraints.length).toBeGreaterThan(0);
    expect(result.relations.length).toBeGreaterThan(0);
    expect(
      (byRule["successful-test-supersedes-failures"]?.count ?? 0) +
        (byRule["superseded-test-run"]?.count ?? 0),
    ).toBeGreaterThan(0);
    expect(byRule["explicit-user-constraint"]?.count).toBeGreaterThan(0);
    expect(result.evaluations.some((evaluation) => evaluation.rule === "unresolved-error")).toBe(
      true,
    );
    expect(byRule["current-task"]?.count).toBe(1);
    expect(byRule["system-instructions"]?.count).toBe(1);

    const droppedIds = new Set(
      result.decisions.filter((decision) => decision.action === "DROP").map((decision) => decision.itemId),
    );
    expect(result.compacted.some((item) => droppedIds.has(item.id))).toBe(false);

    const summary = formatStats(result.stats, result.sessionId);
    expect(summary).toContain("coding-session-rate-limit");
    expect(summary).toContain("By winning rule:");
    expect(summary).toContain("By reason code");
    expect(summary).toContain("Reduction:");
  });
});
