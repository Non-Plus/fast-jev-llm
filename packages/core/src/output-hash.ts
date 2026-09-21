import { contentHash } from "./file-state.js";

const LINE_TIMESTAMP_RE =
  /^(\[\d{4}-\d{2}-\d{2}[^\]]*\]|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+/;

export function normalizeOutputContent(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(LINE_TIMESTAMP_RE, "").trimEnd())
    .join("\n")
    .trim();
}

export function outputHashes(text: string): {
  rawContentHash: string;
  normalizedContentHash: string;
} {
  return {
    rawContentHash: contentHash(text),
    normalizedContentHash: contentHash(normalizeOutputContent(text)),
  };
}
