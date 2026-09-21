#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compact, formatStats, type Transcript } from "@fast-jev/core";
import { codingSessionTranscript } from "../../fixtures/coding-session.ts";

const file = process.argv[2];
const transcript: Transcript = file
  ? (JSON.parse(await readFile(resolve(file), "utf8")) as Transcript)
  : codingSessionTranscript;

const result = await compact(transcript);

console.log(formatStats(result.stats, result.sessionId));
console.log("\nNon-KEEP decisions:");
for (const decision of result.decisions) {
  if (decision.action === "KEEP") {
    continue;
  }
  console.log(
    `  [${decision.action.padEnd(8)}] ${decision.itemId}  ${decision.rule}  ${decision.reason}`,
  );
}
