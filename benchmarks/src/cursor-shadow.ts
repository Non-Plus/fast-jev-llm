import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { compact } from "@fast-jev/core";
import { analyzeCodexSession, parseCodexJsonl } from "@fast-jev/adapter-codex";
import { analyzeCursorSession, parseCursorJsonl } from "@fast-jev/adapter-cursor";

function rssMb(): number {
  return process.memoryUsage().rss / (1024 * 1024);
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

  await write(
    `${JSON.stringify({
      type: "session_meta",
      session_id: `cursor-bench-${targetBytes}`,
      cwd: "/Users/user/project",
      cursor_version: "3.21.16",
      observed_wire_format: "cursor-agent-transcript-jsonl-v1",
    })}\n`,
  );

  const payload = "x".repeat(8000);
  let index = 0;
  while (written < targetBytes) {
    index += 1;
    const command = index % 3 === 0 ? "git status" : index % 3 === 1 ? "cat src/file.ts" : "ls src";
    const name = index % 3 === 1 ? "Read" : "Shell";
    const input =
      name === "Read" ? { path: "src/file.ts" } : { command };
    await write(
      `${JSON.stringify({
        role: "assistant",
        message: {
          content: [{ type: "tool_use", id: `call_${index}`, name, input }],
        },
      })}\n`,
    );
    await write(
      `${JSON.stringify({
        role: "assistant",
        message: {
          content: [{ type: "tool_result", tool_use_id: `call_${index}`, content: payload }],
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

async function benchCursor(label: string, bytes: number): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "ctx-cursor-bench-"));
  const file = join(dir, `${label}.jsonl`);
  try {
    global.gc?.();
    const before = rssMb();
    const writeStarted = performance.now();
    await writeSyntheticCursorJsonl(file, bytes);
    const writeMs = performance.now() - writeStarted;
    const size = (await stat(file)).size;

    const parseStarted = performance.now();
    const parsed = await parseCursorJsonl({ path: file });
    const parseMs = performance.now() - parseStarted;

    const analysisStarted = performance.now();
    const compacted = await compact(parsed.transcript);
    const analysisMs = performance.now() - analysisStarted;

    const combinedStarted = performance.now();
    const result = await analyzeCursorSession({ path: file });
    const combinedMs = performance.now() - combinedStarted;
    const after = rssMb();

    console.log(`\nCursor ${label}`);
    console.log(`  file size:        ${(size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  write time:       ${writeMs.toFixed(0)} ms`);
    console.log(`  parse time:       ${parseMs.toFixed(0)} ms`);
    console.log(`  analysis time:    ${analysisMs.toFixed(0)} ms`);
    console.log(`  combined analyze: ${combinedMs.toFixed(0)} ms`);
    console.log(`  rss before:       ${before.toFixed(1)} MB`);
    console.log(`  rss after:        ${after.toFixed(1)} MB`);
    console.log(`  rss delta:        ${(after - before).toFixed(1)} MB`);
    console.log(`  canonical items:  ${result.itemCount}`);
    console.log(`  parsed messages:  ${parsed.transcript.messages.length}`);
    console.log(`  compacted items:  ${compacted.compacted.length}`);
    console.log(`  token estimate:   ${result.originalTokens}`);
    console.log(`  potential reduce: ${result.potentialReductionPercent.toFixed(1)}%`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function benchCodex(label: string, bytes: number): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "ctx-codex-compare-"));
  const file = join(dir, `${label}.jsonl`);
  try {
    global.gc?.();
    const before = rssMb();
    await writeSyntheticCodexJsonl(file, bytes);
    const parseStarted = performance.now();
    const parsed = await parseCodexJsonl({ path: file });
    const parseMs = performance.now() - parseStarted;
    const analysisStarted = performance.now();
    await compact(parsed.transcript);
    const analysisMs = performance.now() - analysisStarted;
    const combinedStarted = performance.now();
    const result = await analyzeCodexSession({ path: file });
    const combinedMs = performance.now() - combinedStarted;
    const after = rssMb();
    console.log(`\nCodex ${label} (comparison)`);
    console.log(`  parse time:       ${parseMs.toFixed(0)} ms`);
    console.log(`  analysis time:    ${analysisMs.toFixed(0)} ms`);
    console.log(`  combined analyze: ${combinedMs.toFixed(0)} ms`);
    console.log(`  rss delta:        ${(after - before).toFixed(1)} MB`);
    console.log(`  canonical items:  ${result.itemCount}`);
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

console.log("Context Engine — Cursor JSONL shadow benchmark");
console.log("Streaming parse; source transcript is not modified.");
for (const size of sizes) {
  await benchCursor(size.label, size.bytes);
  await benchCodex(size.label, size.bytes);
}
