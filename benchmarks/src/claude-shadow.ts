import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { compact } from "@fast-jev/core";
import { analyzeClaudeSession, parseClaudeJsonl } from "@fast-jev/adapter-claude";
import { analyzeCodexSession, parseCodexJsonl } from "@fast-jev/adapter-codex";
import { analyzeCursorSession, parseCursorJsonl } from "@fast-jev/adapter-cursor";

function rssMb(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

async function writeSyntheticClaudeJsonl(path: string, targetBytes: number): Promise<void> {
  const stream = createWriteStream(path);
  let written = 0;
  const write = async (line: string): Promise<void> => {
    written += Buffer.byteLength(line);
    if (!stream.write(line)) {
      await new Promise<void>((resolve) => stream.once("drain", resolve));
    }
  };
  const payload = "x".repeat(8000);
  let index = 0;
  while (written < targetBytes) {
    index += 1;
    const command = index % 3 === 0 ? "git status" : index % 3 === 1 ? "cat src/file.ts" : "ls src";
    const name = index % 3 === 1 ? "Read" : "Bash";
    const input = name === "Read" ? { file_path: "src/file.ts" } : { command };
    await write(
      `${JSON.stringify({
        type: "assistant",
        sessionId: `claude-bench-${targetBytes}`,
        cwd: "/Users/user/project",
        version: "2.1.251",
        message: {
          role: "assistant",
          model: "claude-opus-4-8",
          content: [{ type: "tool_use", id: `toolu_${index}`, name, input }],
        },
      })}\n`,
    );
    await write(
      `${JSON.stringify({
        type: "user",
        sessionId: `claude-bench-${targetBytes}`,
        cwd: "/Users/user/project",
        version: "2.1.251",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: `toolu_${index}`, content: payload }],
        },
      })}\n`,
    );
  }
  stream.end();
  await finished(stream);
}

async function writeSyntheticCodexJsonl(path: string, targetBytes: number): Promise<void> {
  const stream = createWriteStream(path);
  let written = 0;
  const write = async (line: string): Promise<void> => {
    written += Buffer.byteLength(line);
    if (!stream.write(line)) {
      await new Promise<void>((resolve) => stream.once("drain", resolve));
    }
  };
  await write(
    `${JSON.stringify({
      timestamp: "2026-09-21T00:00:00.000Z",
      type: "session_meta",
      payload: { id: `bench-${targetBytes}`, session_id: `bench-${targetBytes}`, cwd: "/Users/user/project" },
    })}\n`,
  );
  const payload = "x".repeat(8000);
  let index = 0;
  while (written < targetBytes) {
    index += 1;
    const command = index % 3 === 0 ? "git status" : index % 3 === 1 ? "cat src/file.ts" : "ls src";
    await write(
      `${JSON.stringify({
        timestamp: "2026-09-21T00:00:00.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          id: `ctc_${index}`,
          call_id: `call_${index}`,
          name: "exec",
          input: `const r = await tools.exec_command({cmd:"${command}","workdir":"/Users/user/project"});text(r.output);`,
        },
      })}\n`,
    );
    await write(
      `${JSON.stringify({
        timestamp: "2026-09-21T00:00:01.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          id: `ctco_${index}`,
          call_id: `call_${index}`,
          output: payload,
        },
      })}\n`,
    );
  }
  stream.end();
  await finished(stream);
}

async function writeSyntheticCursorJsonl(path: string, targetBytes: number): Promise<void> {
  const stream = createWriteStream(path);
  let written = 0;
  const write = async (line: string): Promise<void> => {
    written += Buffer.byteLength(line);
    if (!stream.write(line)) {
      await new Promise<void>((resolve) => stream.once("drain", resolve));
    }
  };
  const payload = "x".repeat(8000);
  let index = 0;
  while (written < targetBytes) {
    index += 1;
    const command = index % 3 === 0 ? "git status" : index % 3 === 1 ? "cat src/file.ts" : "ls src";
    const name = index % 3 === 1 ? "Read" : "Shell";
    const input = name === "Read" ? { path: "src/file.ts" } : { command };
    await write(
      `${JSON.stringify({
        role: "assistant",
        message: { content: [{ type: "tool_use", id: `call_${index}`, name, input }] },
      })}\n`,
    );
    await write(
      `${JSON.stringify({
        role: "assistant",
        message: { content: [{ type: "tool_result", tool_use_id: `call_${index}`, content: payload }] },
      })}\n`,
    );
  }
  stream.end();
  await finished(stream);
}

async function benchOne(
  vendor: "Claude" | "Codex" | "Cursor",
  label: string,
  bytes: number,
  write: (path: string, bytes: number) => Promise<void>,
  parse: (path: string) => Promise<{ transcript: { messages: unknown[] }; itemCount?: number }>,
  analyze: (path: string) => Promise<{ itemCount: number; originalTokens: number; potentialReductionPercent: number }>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), `ctx-${vendor.toLowerCase()}-bench-`));
  const file = join(dir, `${label}.jsonl`);
  try {
    global.gc?.();
    const before = rssMb();
    await write(file, bytes);
    const size = (await stat(file)).size;
    const parseStarted = performance.now();
    const parsed = await parse(file);
    const parseMs = performance.now() - parseStarted;
    const analysisStarted = performance.now();
    await compact(
      (
        parsed as {
          transcript: import("@fast-jev/core").Transcript;
        }
      ).transcript,
    );
    const analysisMs = performance.now() - analysisStarted;
    const combinedStarted = performance.now();
    const result = await analyze(file);
    const combinedMs = performance.now() - combinedStarted;
    const after = rssMb();
    console.log(`\n${vendor} ${label}`);
    console.log(`  file size:        ${(size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  parse time:       ${parseMs.toFixed(0)} ms`);
    console.log(`  analysis time:    ${analysisMs.toFixed(0)} ms`);
    console.log(`  combined analyze: ${combinedMs.toFixed(0)} ms`);
    console.log(`  rss before:       ${before.toFixed(1)} MB`);
    console.log(`  rss after:        ${after.toFixed(1)} MB`);
    console.log(`  rss delta:        ${(after - before).toFixed(1)} MB`);
    console.log(`  canonical items:  ${result.itemCount}`);
    console.log(`  parsed messages:  ${parsed.transcript.messages.length}`);
    console.log(`  token estimate:   ${result.originalTokens}`);
    console.log(`  potential reduce: ${result.potentialReductionPercent.toFixed(1)}%`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const sizes = process.argv.includes("--small")
  ? [{ label: "1MB", bytes: 1_000_000 }]
  : [
      { label: "10MB", bytes: 10_000_000 },
      { label: "50MB", bytes: 50_000_000 },
    ];

console.log("Context Engine — Claude JSONL shadow benchmark");
console.log("Streaming parse; source transcript is not modified.");
for (const size of sizes) {
  await benchOne(
    "Claude",
    size.label,
    size.bytes,
    writeSyntheticClaudeJsonl,
    async (path) => parseClaudeJsonl({ path }),
    async (path) => analyzeClaudeSession({ path }),
  );
  await benchOne(
    "Codex",
    size.label,
    size.bytes,
    writeSyntheticCodexJsonl,
    async (path) => parseCodexJsonl({ path }),
    async (path) => analyzeCodexSession({ path }),
  );
  await benchOne(
    "Cursor",
    size.label,
    size.bytes,
    writeSyntheticCursorJsonl,
    async (path) => parseCursorJsonl({ path }),
    async (path) => analyzeCursorSession({ path }),
  );
}
