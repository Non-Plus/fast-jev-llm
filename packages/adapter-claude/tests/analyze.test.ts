import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compact } from "@fast-jev/core";
import { describe, expect, it } from "vitest";
import { analyzeClaudeSession, toShadowJsonDocument } from "../src/analyze.js";
import { formatShadowAnalysis, formatShadowExplain } from "../src/format.js";
import { parseClaudeJsonl } from "../src/parser.js";
import { writeShadowReport } from "../src/report.js";
import { fixturePath } from "./helpers.js";

function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

describe("analyzeClaudeSession", () => {
  it("never mutates the original transcript file", async () => {
    const path = fixturePath("conformance/operations.claude.jsonl");
    const before = await readFile(path);
    const beforeHash = sha256(before);
    await analyzeClaudeSession({ path });
    const after = await readFile(path);
    expect(sha256(after)).toBe(beforeHash);
    expect(after.equals(before)).toBe(true);
  });

  it("never mutates an in-memory event list", async () => {
    const events = [
      {
        type: "session_meta",
        session_id: "frozen",
        cwd: "/Users/user/project",
        version: "2.1.251",
      },
      {
        role: "user",
        message: { content: [{ type: "text", text: "Do not mutate this payload." }] },
      },
    ];
    const frozen = events.map((event) => Object.freeze({ ...event }));
    Object.freeze(frozen);
    const snapshot = JSON.stringify(frozen);
    await analyzeClaudeSession({ events: frozen });
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("returns provider-independent shadow statistics including effective tokens", async () => {
    const result = await analyzeClaudeSession(fixturePath("conformance/operations.claude.jsonl"));
    expect(result.source).toBe("claude");
    expect(result.sessionId).toBe("ops-claude");
    expect(result.cwd).toBe("/Users/user/project");
    expect(result.claudeVersion).toBe("2.1.251");
    expect(result.effectiveTokens).toBe(
      result.originalTokens - result.totalPotentialSavings,
    );
    expect(result.decisions).toHaveLength(result.itemCount);
    expect(result.protectedItems + result.keptItems + result.compressedItems + result.droppedItems).toBe(
      result.itemCount,
    );
  });

  it("formats the Claude shadow summary", async () => {
    const result = await analyzeClaudeSession(fixturePath("conformance/operations.claude.jsonl"));
    const text = formatShadowAnalysis(result);
    expect(text).toContain("Context Engine — Claude Shadow Analysis");
    expect(text).toContain("Mode: SHADOW");
    expect(text).toContain("Claude version: 2.1.251");
    expect(text).toContain("Session: ops-claude");
    expect(text).toContain("Effective context");
    expect(text).toContain("Shadow mode only.");
    expect(text).toContain("No Claude context was modified.");
  });

  it("explains items without dumping huge output", async () => {
    const result = await analyzeClaudeSession(fixturePath("cross-agent/auth.claude.jsonl"), {
      previewLength: 80,
    });
    const text = formatShadowExplain(result);
    expect(text).toContain("Mode: SHADOW");
    expect(text).toContain("PROTECT");
    expect(text).not.toContain("chunk xxxxxxxx");
  });

  it("omits source-content previews when reportPreviews is false", async () => {
    const result = await analyzeClaudeSession(fixturePath("conformance/operations.claude.jsonl"), {
      reportPreviews: false,
    });
    expect(result.items.every((item) => item.preview === undefined)).toBe(true);
    const document = toShadowJsonDocument(result, "operations.claude.jsonl");
    expect(document.metadata.source).toBe("claude");
    expect(document.metadata.localOnly).toBe(true);
    expect(JSON.stringify(document.items)).not.toContain('"preview"');
  });

  it("reuses SemanticProvider without Claude-specific classification logic", async () => {
    const { MockSemanticProvider } = await import("@fast-jev/core");
    const provider = new MockSemanticProvider({ defaultResponse: { action: "KEEP" } });
    const result = await analyzeClaudeSession(fixturePath("conformance/operations.claude.jsonl"), {
      config: { semanticMode: "local", recentItemCount: 1 },
      semanticProvider: provider,
    });
    expect(result.semantic?.mode).toBe("local");
    expect(result.semantic?.provider).toBeTruthy();
    expect(formatShadowExplain(result)).toContain("Semantic eligibility:");
  });

  it("matches a direct compact() of the parsed transcript", async () => {
    const parsed = await parseClaudeJsonl(fixturePath("conformance/operations.claude.jsonl"));
    const direct = await compact(parsed.transcript);
    const shadow = await analyzeClaudeSession(fixturePath("conformance/operations.claude.jsonl"));
    expect(shadow.decisions).toEqual(direct.decisions);
  });

  it("writes a shadow report without copying the transcript", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-shadow-"));
    try {
      const result = await analyzeClaudeSession(fixturePath("conformance/operations.claude.jsonl"));
      const path = await writeShadowReport(result, { directory: dir });
      const saved = await readFile(path, "utf8");
      expect(saved).toContain('"source": "claude"');
      expect(saved).not.toContain("tool_use");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not write into the source file even when asked to save", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-src-"));
    const source = join(dir, "session.jsonl");
    const original = await readFile(fixturePath("unpaired-tool-call.jsonl"), "utf8");
    await writeFile(source, original);
    const result = await analyzeClaudeSession({ path: source });
    await writeShadowReport(result, { directory: join(dir, "reports") });
    expect(await readFile(source, "utf8")).toBe(original);
    await rm(dir, { recursive: true, force: true });
  });
});
