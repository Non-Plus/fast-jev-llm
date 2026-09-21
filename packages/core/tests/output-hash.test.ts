import { describe, expect, it } from "vitest";
import { normalizeOutputContent, outputHashes } from "../src/output-hash.js";
import { collectRelations } from "../src/relations.js";
import { makeToolItem } from "./helpers.js";

describe("output identity hashing", () => {
  it("computes distinct raw hashes and matching normalized hashes after timestamp strip", () => {
    const a = "[2026-09-21T00:00:00Z] clean working tree";
    const b = "[2026-09-21T01:00:00Z] clean working tree";
    expect(normalizeOutputContent(a)).toBe("clean working tree");
    expect(outputHashes(a).rawContentHash).not.toBe(outputHashes(b).rawContentHash);
    expect(outputHashes(a).normalizedContentHash).toBe(outputHashes(b).normalizedContentHash);
  });

  it("records newerItem supersedes olderItem for identical normalized command output", () => {
    const older = makeToolItem(
      "old",
      {
        name: "Shell",
        kind: "command",
        callId: "old",
        args: { command: "pwd" },
        command: "pwd",
        result: "  /repo\n",
        normalizedContentHash: outputHashes("  /repo\n").normalizedContentHash,
      },
      "  /repo\n",
    );
    const newer = makeToolItem(
      "new",
      {
        name: "Shell",
        kind: "command",
        callId: "new",
        args: { command: "pwd" },
        command: "pwd",
        result: "/repo",
        normalizedContentHash: outputHashes("/repo").normalizedContentHash,
      },
      "/repo",
    );
    older.normalizedContentHash = older.tool?.normalizedContentHash;
    newer.normalizedContentHash = newer.tool?.normalizedContentHash;
    const relations = collectRelations([older, newer]);
    expect(relations).toContainEqual(
      expect.objectContaining({
        type: "supersedes",
        fromId: "new",
        toId: "old",
        rule: "repeated-command-output",
      }),
    );
  });
});
