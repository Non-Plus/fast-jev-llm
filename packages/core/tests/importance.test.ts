import { describe, expect, it } from "vitest";
import { annotateImportance, classifyItemImportance } from "../src/importance.js";
import { compact } from "../src/pipeline.js";
import { makeItem, makeToolItem, message, transcript } from "./helpers.js";

describe("deterministic importance", () => {
  it("labels constraints, tasks, and safety as CRITICAL", () => {
    expect(
      classifyItemImportance(
        makeItem({ id: "c", role: "user", content: "Never log secrets." }),
        { currentTaskId: "c" },
      ),
    ).toBe("CRITICAL");
    expect(
      classifyItemImportance(
        makeItem({
          id: "s",
          role: "system",
          origin: "system",
          content: "You are a coding assistant.",
        }),
      ),
    ).toBe("CRITICAL");
  });

  it("labels unresolved errors and current git diffs as IMPORTANT", () => {
    const error = makeToolItem("e", {
      name: "Shell",
      kind: "build_run",
      callId: "e",
      args: {},
      command: "npm run build",
      isError: true,
      exitCode: 1,
      result: "error TS2322",
    });
    expect(classifyItemImportance(error, { unresolvedErrorIds: new Set(["e"]) })).toBe("IMPORTANT");
  });

  it("labels directory listings and git status as EPHEMERAL", () => {
    expect(
      classifyItemImportance(
        makeToolItem("l", {
          name: "Shell",
          kind: "directory_list",
          callId: "l",
          args: {},
          path: ".",
        }),
      ),
    ).toBe("EPHEMERAL");
    expect(
      classifyItemImportance(
        makeToolItem("g", {
          name: "Shell",
          kind: "git_status",
          callId: "g",
          args: {},
          command: "git status",
        }),
      ),
    ).toBe("EPHEMERAL");
  });

  it("labels generic tool dumps as NORMAL and never deletes from importance alone", async () => {
    const generic = makeToolItem(
      "n",
      {
        name: "Shell",
        kind: "command",
        callId: "n",
        args: { command: "echo hi" },
        command: "echo hi",
        result: "hi",
      },
      "hi",
    );
    expect(classifyItemImportance(generic)).toBe("NORMAL");

    const items = [
      makeToolItem("l1", {
        name: "Shell",
        kind: "directory_list",
        callId: "l1",
        args: {},
        path: ".",
        command: "ls",
        result: "src",
      }),
    ];
    annotateImportance(items);
    expect(items[0]?.importance).toBe("EPHEMERAL");

    const result = await compact(
      transcript([
        message("u1", "user", "List the repo."),
        {
          id: "a1",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "Shell", arguments: { command: "ls" } }],
        },
        { id: "t1", role: "tool", toolCallId: "c1", content: "src\nREADME.md" },
      ]),
      { config: { recentItemCount: 0 } },
    );
    const listing = result.items.find((item) => item.tool?.kind === "directory_list");
    expect(listing?.importance).toBe("EPHEMERAL");
    expect(result.decisions.find((decision) => decision.itemId === listing?.id)?.action).not.toBe(
      "DROP",
    );
  });

  it("treats unknown-origin messages conservatively as IMPORTANT", () => {
    expect(
      classifyItemImportance(
        makeItem({ id: "u", kind: "message", origin: "unknown", content: "mystery" }),
      ),
    ).toBe("IMPORTANT");
  });
});
