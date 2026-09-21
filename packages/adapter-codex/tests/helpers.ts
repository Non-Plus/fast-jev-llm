import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const fixturesDir = fileURLToPath(new URL("../fixtures", import.meta.url));

export function fixturePath(name: string): string {
  return join(fixturesDir, name);
}

export function envelope(
  type: string,
  payload: Record<string, unknown>,
  timestamp = "2026-09-21T00:00:00.000Z",
): Record<string, unknown> {
  return { timestamp, type, payload };
}
