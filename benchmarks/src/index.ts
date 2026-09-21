import { performance } from "node:perf_hooks";
import { compact } from "@fast-jev/core";
import { buildCodingSessionTranscript } from "../../fixtures/coding-session.ts";

const iterations = Number(process.argv[2] ?? 50);
const scale = Number(process.argv[3] ?? 1);

const base = buildCodingSessionTranscript();
const transcript = {
  sessionId: `bench-x${scale}`,
  messages: Array.from({ length: scale }, () => base.messages).flat(),
};

await compact(transcript);

const started = performance.now();
let lastTokens = 0;
for (let i = 0; i < iterations; i += 1) {
  const result = await compact(transcript);
  lastTokens = result.stats.originalTokens - result.stats.compactTokens;
}
const elapsed = performance.now() - started;

console.log(`iterations: ${iterations}`);
console.log(`scale:      ${scale}x fixture messages (${transcript.messages.length} messages)`);
console.log(`avg:        ${(elapsed / iterations).toFixed(2)} ms`);
console.log(`dropped:    ${lastTokens} tokens / run`);
