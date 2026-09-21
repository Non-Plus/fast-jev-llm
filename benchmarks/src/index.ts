import { performance } from "node:perf_hooks";
import { compact, formatStats } from "@fast-jev/core";
import { buildCodingSessionTranscript } from "../../fixtures/coding-session.ts";

const iterations = Number(process.argv[2] ?? 50);
const scale = Number(process.argv[3] ?? 1);

const base = buildCodingSessionTranscript();
const transcript = {
  sessionId: scale === 1 ? base.sessionId : `bench-x${scale}`,
  messages: Array.from({ length: scale }, () => base.messages).flat(),
};

const warmup = await compact(transcript);
console.log(formatStats(warmup.stats, warmup.sessionId));

const started = performance.now();
for (let i = 0; i < iterations; i += 1) {
  await compact(transcript);
}
const elapsed = performance.now() - started;

console.log("");
console.log(`iterations: ${iterations}`);
console.log(`scale:      ${scale}x fixture messages (${transcript.messages.length} messages)`);
console.log(`avg:        ${(elapsed / iterations).toFixed(2)} ms`);
