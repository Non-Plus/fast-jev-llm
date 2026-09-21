import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compact } from "@fast-jev/core";
import { analyzeCodexSession, toShadowJsonDocument } from "../src/analyze.js";
import { formatShadowAnalysis, formatShadowExplain } from "../src/format.js";
import { parseCodexJsonl } from "../src/parser.js";
import { writeShadowReport } from "../src/report.js";
import { fixturePath } from "./helpers.js";

function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

describe("analyzeCodexSession", () => {
  it("never mutates the original transcript file", async () => {
    const path = fixturePath("normal-session.jsonl");
    const before = await readFile(path);
    const beforeHash = sha256(before);
    await analyzeCodexSession({ path });
    const after = await readFile(path);
    expect(sha256(after)).toBe(beforeHash);
    expect(after.equals(before)).toBe(true);
  });

  it("never mutates an in-memory event list", async () => {
    const parsed = await parseCodexJsonl(fixturePath("normal-session.jsonl"));
    const events = [
      {
        timestamp: "2026-09-21T00:00:00.000Z",
        type: "session_meta",
        payload: { id: "frozen", cwd: "/Users/user/project" },
      },
      {
        timestamp: "2026-09-21T00:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "msg_u",
          role: "user",
          content: [{ type: "input_text", text: "Do not mutate this payload." }],
        },
      },
    ];
    const frozen = events.map((event) => Object.freeze({ ...event, payload: Object.freeze({ ...event.payload }) }));
    Object.freeze(frozen);
    const snapshot = JSON.stringify(frozen);
    await analyzeCodexSession({ events: frozen });
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(parsed.transcript.sessionId).toBe("abc123");
  });

  it("preserves engine decisions in the shadow result", async () => {
    const result = await analyzeCodexSession(fixturePath("normal-session.jsonl"), {
      config: { recentItemCount: 1 },
    });
    expect(result.source).toBe("codex");
    expect(result.sessionId).toBe("abc123");
    expect(result.cwd).toBe("/Users/user/project");
    expect(result.model).toBe("gpt-5.4");
    expect(result.decisions).toHaveLength(result.itemCount);
    expect(result.decisionTrace).toHaveLength(result.itemCount);
    expect(result.protectedItems).toBeGreaterThan(0);
    expect(result.droppedItems + result.keptItems + result.protectedItems + result.compressedItems).toBe(
      result.itemCount,
    );
    const gitDrops = result.items.filter((item) => item.reasonCode === "SUPERSEDED_GIT_STATUS");
    expect(gitDrops.length).toBeGreaterThan(0);
    expect(gitDrops[0]?.supersededBy).toBeTruthy();
  });

  it("produces machine-readable JSON with metadata, statistics, decisions, trace, and relationships", async () => {
    const result = await analyzeCodexSession(fixturePath("normal-session.jsonl"));
    const document = toShadowJsonDocument(result, "normal-session.jsonl");
    expect(document.metadata).toMatchObject({
      sessionId: "abc123",
      source: "codex",
      mode: "shadow",
      cwd: "/Users/user/project",
      model: "gpt-5.4",
    });
    expect(document.statistics.originalTokens).toBe(result.originalTokens);
    expect(document.decisions).toEqual(result.decisions);
    expect(document.decisionTrace).toEqual(result.decisionTrace);
    expect(document.relationships).toEqual(result.relationships);
    expect(document.items.length).toBe(result.itemCount);
  });

  it("limits explain previews and includes individual decisions", async () => {
    const result = await analyzeCodexSession(fixturePath("long-tool-output.jsonl"), {
      previewLength: 80,
    });
    const text = formatShadowExplain(result);
    expect(text).toContain("Mode: SHADOW");
    expect(text).toContain("PROTECT");
    expect(text).toContain("USER_CONSTRAINT");
    expect(text).toContain("Shadow mode only. No Codex context was modified.");
    expect(text).not.toContain("lockfile-line\nlockfile-line\nlockfile-line");
    const longItem = result.items.find((item) => item.tokens > 1000);
    expect(longItem?.preview?.length).toBeLessThanOrEqual(80);
    expect(text).toContain("Retention:");
    expect(text).toContain("Compression:");
  });

  it("omits source-content previews when reportPreviews is false", async () => {
    const result = await analyzeCodexSession(fixturePath("long-tool-output.jsonl"), {
      reportPreviews: false,
    });
    expect(result.reportPreviews).toBe(false);
    expect(result.items.every((item) => item.preview === undefined)).toBe(true);
    const document = toShadowJsonDocument(result, "long-tool-output.jsonl");
    expect(document.metadata.localOnly).toBe(true);
    expect(document.metadata.reportPreviews).toBe(false);
    expect(document.items.every((item) => !("preview" in item))).toBe(true);
    expect(JSON.stringify(document.items)).not.toContain('"preview"');
  });

  it("formats a human shadow summary", async () => {
    const result = await analyzeCodexSession(fixturePath("normal-session.jsonl"));
    const text = formatShadowAnalysis(result);
    expect(text).toContain("Context Engine — Codex Shadow Analysis");
    expect(text).toContain("Mode: SHADOW");
    expect(text).toContain("Session: abc123");
    expect(text).toContain("Shadow mode only. No Codex context was modified.");
    expect(text).toContain("Potential reduction");
  });

  it("explains semantic eligibility and recommendations when a provider is attached", async () => {
    const { MockSemanticProvider } = await import("@fast-jev/core");
    const provider = new MockSemanticProvider({ defaultResponse: { action: "KEEP" } });
    const result = await analyzeCodexSession(fixturePath("normal-session.jsonl"), {
      config: { semanticMode: "local", recentItemCount: 1 },
      semanticProvider: provider,
    });
    const text = formatShadowExplain(result);
    expect(text).toContain("Semantic eligibility:");
    expect(text).toContain("Final shadow decision:");
    expect(text).toContain("Deterministic:");
  });

  it("writes a shadow report without copying the transcript", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shadow-report-"));
    try {
      const result = await analyzeCodexSession(fixturePath("normal-session.jsonl"));
      const path = await writeShadowReport(result, { directory: dir, sourcePath: "normal-session.jsonl" });
      const saved = JSON.parse(await readFile(path, "utf8")) as { metadata: { sessionId: string }; items: unknown[] };
      expect(saved.metadata.sessionId).toBe("abc123");
      const raw = await readFile(path, "utf8");
      expect(raw).not.toContain("session_meta");
      expect(raw).not.toContain("custom_tool_call");
      expect(raw).not.toContain("\"type\": \"response_item\"");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves the canonical transcript identical to a direct compact() of the parse", async () => {
    const parsed = await parseCodexJsonl(fixturePath("multiple-turns.jsonl"));
    const direct = await compact(parsed.transcript);
    const shadow = await analyzeCodexSession(fixturePath("multiple-turns.jsonl"));
    expect(shadow.decisions).toEqual(direct.decisions);
    expect(shadow.itemCount).toBe(direct.items.length);
  });

  it("keeps unpaired tool calls and results as their own items", async () => {
    const interrupted = await analyzeCodexSession(fixturePath("interrupted-tool-call.jsonl"));
    expect(interrupted.items.some((item) => item.kind === "unpaired_tool_call")).toBe(true);
    const orphan = await analyzeCodexSession(fixturePath("unpaired-tool-result.jsonl"));
    expect(orphan.items.some((item) => item.kind === "unpaired_tool_result")).toBe(true);
  });
});

describe("shadow report generation", () => {
  it("does not write into the source file even when asked to save", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shadow-src-"));
    const source = join(dir, "session.jsonl");
    const original = await readFile(fixturePath("interrupted-tool-call.jsonl"), "utf8");
    await writeFile(source, original);
    const result = await analyzeCodexSession({ path: source });
    await writeShadowReport(result, { directory: join(dir, "reports") });
    expect(await readFile(source, "utf8")).toBe(original);
    await rm(dir, { recursive: true, force: true });
  });
});
