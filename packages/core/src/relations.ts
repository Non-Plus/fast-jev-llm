import { isToolSuccess } from "./classify.js";
import { itemPath } from "./file-state.js";
import type { ContextItem, ContextRelation } from "./types.js";

function pushUnique(relations: ContextRelation[], relation: ContextRelation): void {
  if (
    relations.some(
      (existing) =>
        existing.type === relation.type &&
        existing.fromId === relation.fromId &&
        existing.toId === relation.toId &&
        existing.rule === relation.rule,
    )
  ) {
    return;
  }
  relations.push(relation);
}

function supersedeOlder(
  relations: ContextRelation[],
  group: readonly ContextItem[],
  rule: string,
): void {
  if (group.length < 2) {
    return;
  }
  const newest = group[group.length - 1];
  if (!newest) {
    return;
  }
  for (const older of group.slice(0, -1)) {
    pushUnique(relations, {
      type: "supersedes",
      fromId: newest.id,
      toId: older.id,
      rule,
    });
  }
}

export function collectRelations(items: readonly ContextItem[]): ContextRelation[] {
  const relations: ContextRelation[] = [];

  const opsByPath = new Map<string, ContextItem[]>();
  for (const item of items) {
    if (!item.tool) {
      continue;
    }
    if (item.tool.kind !== "file_read" && item.tool.kind !== "file_write") {
      continue;
    }
    const path = itemPath(item);
    if (!path) {
      continue;
    }
    const list = opsByPath.get(path) ?? [];
    list.push(item);
    opsByPath.set(path, list);
  }

  for (const ops of opsByPath.values()) {
    for (let i = 0; i < ops.length; i += 1) {
      const current = ops[i];
      if (current?.tool?.kind !== "file_read") {
        continue;
      }
      for (let j = i + 1; j < ops.length; j += 1) {
        const next = ops[j];
        if (!next?.tool) {
          continue;
        }
        if (next.tool.kind === "file_write") {
          pushUnique(relations, {
            type: "invalidates",
            fromId: next.id,
            toId: current.id,
            rule: "superseded-file-read",
          });
          continue;
        }
        if (next.tool.kind === "file_read") {
          pushUnique(relations, {
            type: "supersedes",
            fromId: next.id,
            toId: current.id,
            rule: "superseded-file-read",
          });
          break;
        }
      }
    }
  }

  supersedeOlder(
    relations,
    items.filter((item) => item.tool?.kind === "git_status"),
    "superseded-git-status",
  );
  supersedeOlder(
    relations,
    items.filter((item) => item.tool?.kind === "git_diff"),
    "superseded-git-diff",
  );

  const listings = new Map<string, ContextItem[]>();
  for (const item of items) {
    if (item.tool?.kind !== "directory_list") {
      continue;
    }
    const glob = item.tool.args["glob"];
    const key =
      (typeof glob === "string" && glob.length > 0 ? glob : undefined) ??
      item.tool.path ??
      item.tool.command ??
      ".";
    const list = listings.get(key) ?? [];
    list.push(item);
    listings.set(key, list);
  }
  for (const list of listings.values()) {
    supersedeOlder(relations, list, "old-directory-listing");
  }

  items.forEach((item, index) => {
    if (item.tool?.kind !== "test_run" || !isToolSuccess(item.tool)) {
      return;
    }
    for (let i = index - 1; i >= 0; i -= 1) {
      const previous = items[i];
      if (previous?.tool?.kind === "file_write") {
        pushUnique(relations, {
          type: "validates",
          fromId: item.id,
          toId: previous.id,
          rule: "successful-test-supersedes-failures",
        });
        break;
      }
    }
  });

  const byIdentityHash = new Map<string, ContextItem[]>();
  for (const item of items) {
    const identity = item.tool?.command ?? item.tool?.name;
    const hash = item.normalizedContentHash ?? item.tool?.normalizedContentHash;
    if (!identity || !hash) {
      continue;
    }
    if (item.tool?.kind === "file_read" || item.tool?.kind === "file_write") {
      continue;
    }
    const key = `${identity}\n${hash}`;
    const list = byIdentityHash.get(key) ?? [];
    list.push(item);
    byIdentityHash.set(key, list);
  }
  for (const list of byIdentityHash.values()) {
    supersedeOlder(relations, list, "repeated-command-output");
  }

  return relations;
}
