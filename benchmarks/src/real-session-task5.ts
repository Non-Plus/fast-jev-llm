import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { analyzeCodexSession, parseCodexJsonl } from "@fast-jev/adapter-codex";
import { MockSemanticProvider } from "@fast-jev/core";
import { jevProviderFromEnv } from "@fast-jev/provider-jev";

const path =
  process.argv[2] ??
  `${process.env.HOME}/.codex/sessions/2026/09/21/rollout-2026-09-21T12-00-00-demo00000000-0000-4000-8000-000000000001.jsonl`;

const raw = await readFile(path);
const sha = createHash("sha256").update(raw).digest("hex");
console.log(`transcript: ${path}`);
console.log(`sha256:     ${sha}`);
console.log(`bytes:      ${raw.length}`);

const parsed = await parseCodexJsonl({ path });
console.log(`canonical messages: ${parsed.transcript.messages.length}`);

const deterministic = await analyzeCodexSession(
  { path },
  { sourcePath: path, reportPreviews: true, previewLength: 160, config: { semanticMode: "off" } },
);

console.log("\n=== DETERMINISTIC ONLY ===");
console.log(`original tokens:            ${deterministic.originalTokens}`);
console.log(`protected:                  ${deterministic.retentionProtectedTokens}`);
console.log(`kept:                       ${deterministic.keptTokens}`);
console.log(`compressed (original):      ${deterministic.compressedTokens}`);
console.log(`dropped:                    ${deterministic.droppedTokens}`);
console.log(`total potential savings:    ${deterministic.totalPotentialSavings}`);
console.log(`reduction:                  ${deterministic.potentialReductionPercent.toFixed(1)}%`);

const adversarial = new MockSemanticProvider({ defaultResponse: { action: "DROP" } });
const mock = await analyzeCodexSession(
  { path },
  {
    sourcePath: path,
    reportPreviews: true,
    previewLength: 160,
    config: { semanticMode: "local" },
    semanticProvider: adversarial,
  },
);
const unsafeMockDrops = mock.items.filter(
  (item) =>
    item.action === "DROP" &&
    item.semanticAction === "DROP" &&
    (item.deterministicAction === "PROTECT" || item.semanticEligibility === "forbidden"),
);
console.log("\n=== LOCAL ADVERSARIAL MOCK (DROP-all) ===");
console.log(`candidates:                 ${mock.semantic?.candidateCount}`);
console.log(`semantic KEEP/COMPRESS/DROP:${mock.semantic?.decisions.filter((d) => d.action === "KEEP").length}/${mock.semantic?.decisions.filter((d) => d.action === "COMPRESS").length}/${mock.semantic?.decisions.filter((d) => d.action === "DROP").length}`);
console.log(`final additional savings:   ${Math.max(0, mock.totalPotentialSavings - deterministic.totalPotentialSavings)}`);
console.log(`unsafe mock drops:          ${unsafeMockDrops.length}`);
console.log(`disagreements:              ${mock.semantic?.disagreements.length}`);
console.log(`provider failures:          ${mock.semantic?.providerFailures}`);

const mockDrops = mock.items.filter((item) => item.semanticAction === "DROP" && item.action === "DROP");
console.log(`\nSemantic DROP count (mock): ${mockDrops.length}`);
for (const item of mockDrops) {
  console.log(`\nDROP ${item.itemId}`);
  console.log(`  preview:       ${item.preview ?? "(omitted)"}`);
  console.log(`  relevance:     ${item.relevanceScore}`);
  console.log(`  confidence:    ${item.confidence}`);
  console.log(`  reason:        ${item.reason}`);
  console.log(`  relationships: ${item.relationships.join(" | ") || "(none)"}`);
  console.log(`  deterministic: ${item.deterministicAction}`);
  console.log(`  eligibility:   ${item.semanticEligibility}`);
  console.log("  why no protection: semantically eligible, not retention-protected");
}

console.log("\nDisagreements (mock, first 20)");
for (const disagreement of (mock.semantic?.disagreements ?? []).slice(0, 20)) {
  console.log(
    `  ${disagreement.itemId}: det ${disagreement.deterministicAction} vs sem ${disagreement.semanticAction} → ${disagreement.finalAction}`,
  );
}

const jev = jevProviderFromEnv();
if (!jev) {
  console.log("\n=== JEV SKIPPED ===");
  console.log("No TYPESAFE_API_KEY / JEV_API_KEY in the environment. Nothing was sent.");
} else {
  const semantic = await analyzeCodexSession(
    { path },
    {
      sourcePath: path,
      reportPreviews: true,
      previewLength: 160,
      config: { semanticMode: "remote" },
      semanticProvider: jev,
    },
  );
  console.log("\n=== DETERMINISTIC + JEV ===");
  console.log(`original tokens:            ${semantic.originalTokens}`);
  console.log(`effective deterministic:    ${deterministic.originalTokens - deterministic.totalPotentialSavings}`);
  console.log(`effective semantic:         ${semantic.originalTokens - semantic.totalPotentialSavings}`);
  console.log(`compression savings:        ${semantic.compressionSavings}`);
  console.log(`drop savings:               ${semantic.dropSavings}`);
  console.log(
    `additional semantic savings:${Math.max(0, semantic.totalPotentialSavings - deterministic.totalPotentialSavings)}`,
  );
  console.log(`combined reduction:         ${semantic.potentialReductionPercent.toFixed(1)}%`);
  console.log(`provider:                   ${semantic.semantic?.provider}`);
  console.log(`requests:                   ${semantic.semantic?.usage?.requests ?? semantic.semantic?.batchCount}`);
  console.log(`candidates:                 ${semantic.semantic?.candidateCount}`);
  console.log(`latency ms:                 ${semantic.semantic?.providerLatencyMs}`);
  console.log(`input tokens:               ${semantic.semantic?.usage?.inputTokens ?? "unknown"}`);
  console.log(`estimated cost:             ${semantic.semantic?.usage?.estimatedCost ?? "unavailable"}`);
  console.log(`failures:                   ${semantic.semantic?.providerFailures}`);
  console.log(`redactions:                 ${semantic.semantic?.redactionCount}`);
  console.log(`tokens sent externally:     ${semantic.semantic?.tokensSentExternally}`);

  const drops = semantic.items.filter((item) => item.semanticAction === "DROP" && item.action === "DROP");
  console.log(`\nSemantic DROP count: ${drops.length}`);
  for (const item of drops) {
    console.log(`\nDROP ${item.itemId}`);
    console.log(`  preview:       ${item.preview ?? "(omitted)"}`);
    console.log(`  relevance:     ${item.relevanceScore}`);
    console.log(`  confidence:    ${item.confidence}`);
    console.log(`  reason:        ${item.reason}`);
    console.log(`  relationships: ${item.relationships.join(" | ") || "(none)"}`);
    console.log("  why no protection: semantically eligible, not retention-protected");
  }

  console.log("\nDisagreements");
  for (const disagreement of semantic.semantic?.disagreements ?? []) {
    console.log(
      `  ${disagreement.itemId}: det ${disagreement.deterministicAction} vs sem ${disagreement.semanticAction} → ${disagreement.finalAction}`,
    );
  }
}

const after = createHash("sha256").update(await readFile(path)).digest("hex");
if (after !== sha) {
  throw new Error("transcript was modified");
}
console.log("\ntranscript hash unchanged; shadow mode only");
