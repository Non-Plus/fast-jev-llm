import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const fixturesDir = fileURLToPath(new URL("../fixtures", import.meta.url));

export function fixturePath(name: string): string {
  return join(fixturesDir, name);
}

export function cursorPackageFixture(name: string): string {
  return join(fixturesDir, "../../adapter-cursor/fixtures", name);
}
