import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { analyzeCodexSession } from "@fast-jev/adapter-codex";

function rssMb(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

async function writeSyntheticJsonl(path: string, targetBytes: number): Promise<void> {
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
  await write(
    `${JSON.stringify({
      timestamp: "2026-09-21T00:00:01.000Z",
      type: "turn_context",
      payload: { cwd: "/Users/user/project", model: "gpt-5.4" },
    })}\n`,
  );

  const payload = "x".repeat(8000);
  let index = 0;
  while (written < targetBytes) {
    index += 1;
    const command = index % 3 === 0 ? "git status" : index % 3 === 1 ? "cat src/file.ts" : "ls src";
    await write(
      `${JSON.stringify({
        timestamp: `2026-09-21T00:00:00.${String(index).padStart(3, "0")}Z`,
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
        timestamp: `2026-09-21T00:00:01.${String(index).padStart(3, "0")}Z`,
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

async function bench(label: string, bytes: number): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "ctx-codex-bench-"));
  const file = join(dir, `${label}.jsonl`);
  try {
    global.gc?.();
    const before = rssMb();
    const writeStarted = performance.now();
    await writeSyntheticJsonl(file, bytes);
    const writeMs = performance.now() - writeStarted;
    const size = (await stat(file)).size;
    const started = performance.now();
    const result = await analyzeCodexSession({ path: file });
    const elapsed = performance.now() - started;
    const after = rssMb();
    console.log(`\n${label}`);
    console.log(`  file size:        ${(size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  write time:       ${writeMs.toFixed(0)} ms`);
    console.log(`  processing time:  ${elapsed.toFixed(0)} ms`);
    console.log(`  rss before:       ${before.toFixed(1)} MB`);
    console.log(`  rss after:        ${after.toFixed(1)} MB`);
    console.log(`  rss delta:        ${(after - before).toFixed(1)} MB`);
    console.log(`  item count:       ${result.itemCount}`);
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

console.log("Context Engine — Codex JSONL shadow benchmark");
console.log("Streaming parse; source transcript is not modified.");
for (const size of sizes) {
  await bench(size.label, size.bytes);
}
