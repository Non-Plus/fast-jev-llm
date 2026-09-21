import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { analyzeCodexSession, parseCodexJsonl } from "@fast-jev/adapter-codex";
import { compact } from "@fast-jev/core";

const path =
  process.argv[2] ??
  `${process.env.HOME}/.codex/sessions/2026/09/21/rollout-2026-09-21T12-00-00-demo00000000-0000-4000-8000-000000000001.jsonl`;

const raw = await readFile(path);
const sha = createHash("sha256").update(raw).digest("hex");
console.log(`transcript: ${path}`);
console.log(`sha256:     ${sha}`);
console.log(`bytes:      ${raw.length}`);

const parsed = await parseCodexJsonl({ path });
const compacted = await compact(parsed.transcript);
const result = await analyzeCodexSession({ path }, { sourcePath: path, reportPreviews: true, previewLength: 200 });
const after = createHash("sha256").update(await readFile(path)).digest("hex");
if (after !== sha) {
  throw new Error("transcript was modified");
}

console.log("\nTask 4 shadow analysis");
console.log(`original tokens:            ${result.originalTokens}`);
console.log(`protected verbatim:         ${result.protectedVerbatimTokens}`);
console.log(`protected compressible:     ${result.protectedCompressibleTokens}`);
console.log(`kept:                       ${result.keptTokens}`);
console.log(`compressed (original):      ${result.compressedTokens}`);
console.log(`compressed (retained):      ${result.compressedRetainedTokens}`);
console.log(`dropped:                    ${result.droppedTokens}`);
console.log(`compression savings:        ${result.compressionSavings}`);
console.log(`drop savings:               ${result.dropSavings}`);
console.log(`total potential savings:    ${result.totalPotentialSavings}`);
console.log(`total reduction:            ${result.potentialReductionPercent.toFixed(1)}%`);
console.log(
  `items:                      ${result.itemCount} (P ${result.protectedItems} / K ${result.keptItems} / C ${result.compressedItems} / D ${result.droppedItems})`,
);

console.log("\nTask 3 comparison (same transcript)");
console.log("  original:                  83737");
console.log("  PROTECT:                   32706");
console.log("  KEEP:                        667");
console.log("  COMPRESS:                  50364");
console.log("  DROP:                          0");
console.log("  reduction:                  58.2%");

console.log("\nTop reductions by reason:");
for (const [code, tokens] of Object.entries(result.reductionByReasonCode).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${code.padEnd(28)} ${String(Math.round(tokens)).padStart(8)}`);
}

const compactedById = new Map(compacted.compacted.map((item) => [item.id, item]));
const originalById = new Map(compacted.items.map((item) => [item.id, item]));
const top = [...result.items].sort((a, b) => b.savedTokens - a.savedTokens).slice(0, 10);
console.log("\nLargest 10 context savings");
for (const [index, item] of top.entries()) {
  const original = originalById.get(item.itemId);
  const retained = compactedById.get(item.itemId);
  console.log(`\n#${index + 1} ${item.itemId}  ${item.action}  ${item.reasonCode}`);
  console.log(`  tool:        ${item.toolName ?? "-"} ${item.command ?? ""}`.trimEnd());
  console.log(`  importance:  ${item.importance ?? "-"}  origin: ${item.origin ?? "-"}`);
  console.log(`  retention:   ${item.retention}  compression: ${item.compression}`);
  console.log(`  original:    ${item.originalTokens}`);
  console.log(`  retained:    ${item.retainedTokens}`);
  console.log(`  saved:       ${item.savedTokens}`);
  console.log(`  kind:        ${original?.tool?.kind ?? original?.kind}`);
  if (item.narrative) {
    console.log(`  narrative:   ${item.narrative}`);
  }
  const retainedPreview = (retained?.content ?? "").replace(/\s+/g, " ").slice(0, 420);
  console.log(`  retained:    ${retainedPreview}`);
}
