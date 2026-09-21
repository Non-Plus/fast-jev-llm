import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = fileURLToPath(new URL("../fixtures", import.meta.url));

const WIRE = {
  observed_wire_format: "codex-rollout-jsonl-v1",
  observed_cli_version: "0.151.0",
  observed_payload_types: [
    "session_meta",
    "turn_context",
    "response_item/message",
    "response_item/function_call",
    "response_item/function_call_output",
    "response_item/custom_tool_call",
    "response_item/custom_tool_call_output",
  ],
};

function line(type: string, payload: Record<string, unknown>, timestamp: string): string {
  return `${JSON.stringify({ timestamp, type, payload })}\n`;
}

function session(id: string, note: string): string {
  return (
    line(
      "session_meta",
      {
        id,
        session_id: id,
        cwd: "/Users/user/project",
        cli_version: "0.151.0",
        originator: "Codex CLI",
        fixture_note: note,
        ...WIRE,
      },
      "2026-09-21T03:00:00.000Z",
    ) +
    line(
      "turn_context",
      { cwd: "/Users/user/project", model: "gpt-5.4" },
      "2026-09-21T03:00:01.000Z",
    )
  );
}

function message(id: string, role: string, text: string, ts: string): string {
  const type = role === "assistant" ? "output_text" : "input_text";
  return line(
    "response_item",
    { type: "message", id, role, content: [{ type, text }] },
    ts,
  );
}

function customCall(id: string, callId: string, cmd: string, ts: string): string {
  return line(
    "response_item",
    {
      type: "custom_tool_call",
      id,
      call_id: callId,
      name: "exec",
      input: `const r = await tools.exec_command({cmd:${JSON.stringify(cmd)},"workdir":"/Users/user/project"});text(r.output);`,
    },
    ts,
  );
}

function customOut(id: string, callId: string, output: string, ts: string): string {
  return line(
    "response_item",
    { type: "custom_tool_call_output", id, call_id: callId, output },
    ts,
  );
}

function functionCall(id: string, callId: string, name: string, args: unknown, ts: string): string {
  return line(
    "response_item",
    { type: "function_call", id, call_id: callId, name, arguments: JSON.stringify(args) },
    ts,
  );
}

function functionOut(id: string, callId: string, output: string, ts: string): string {
  return line(
    "response_item",
    { type: "function_call_output", id, call_id: callId, output },
    ts,
  );
}

const hugeBuildFail = [
  "npm run build",
  ...Array.from({ length: 1800 }, (_, i) => `webpack: compiled module ${i}`),
  "src/auth.ts:128:4 - error TS2322: Type 'X' is not assignable to type 'Y'.",
  "src/auth.ts:128:4 - error TS2322: Type 'X' is not assignable to type 'Y'.",
  "src/user.ts:44:8 - error TS2345: Argument of type 'A' is not assignable to parameter of type 'B'.",
  "src/session.ts:9:1 - error TS2304: Cannot find name 'windowMs'.",
  "Found 3 errors.",
  "Failed to compile.",
].join("\n");

const hugeBuildOk = [
  "npm run build",
  ...Array.from({ length: 1800 }, (_, i) => `webpack: compiled module ${i}`),
  "compiled successfully",
  "built in 12.4s",
  "Warnings: 12",
].join("\n");

const hugeTests = [
  ...Array.from({ length: 418 }, (_, i) => `PASS src/ok${i}.test.ts ✓ should work`),
  "FAIL src/auth.test.ts",
  "  × should reject expired token",
  "    Expected: 401",
  "    Received: 200",
  "FAIL src/payment.test.ts",
  "  × charges the card",
  "FAIL src/session.test.ts",
  "  × stores the cookie",
  "Tests: 3 failed, 418 passed, 4 skipped",
].join("\n");

const hugeDiff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " export const a = 1;",
  "+export const b = 2;",
  "diff --git a/src/b.ts b/src/b.ts",
  "index 333..444 100644",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1,1 +1,1 @@",
  "-old",
  "+new",
  " 2 files changed, 400 insertions(+), 20 deletions(-)",
  ...Array.from({ length: 1600 }, (_, i) => `+padding line ${i}`),
].join("\n");

const hugeTree = [
  "src",
  "src/auth.ts",
  "README.md",
  ...Array.from({ length: 300 }, (_, i) => `node_modules/lodash/file${i}.js`),
  ...Array.from({ length: 80 }, (_, i) => `dist/chunk${i}.js`),
  ...Array.from({ length: 40 }, (_, i) => `.git/objects/${i}`),
].join("\n");

async function writeNamed(name: string, body: string): Promise<void> {
  await writeFile(join(fixturesDir, name), body, "utf8");
}

await writeNamed(
  "huge-build-failure.jsonl",
  session("fix-huge-build-fail", "huge recent TypeScript build failure") +
    message("msg_u", "user", "Never log secrets. Fix the TypeScript build.", "2026-09-21T03:00:02.000Z") +
    message("msg_a", "assistant", "Running npm run build.", "2026-09-21T03:00:03.000Z") +
    customCall("ctc_b", "call_b", "npm run build", "2026-09-21T03:00:04.000Z") +
    customOut("ctco_b", "call_b", hugeBuildFail, "2026-09-21T03:00:05.000Z"),
);

await writeNamed(
  "huge-build-success.jsonl",
  session("fix-huge-build-ok", "huge recent successful build") +
    message("msg_u", "user", "Build the project.", "2026-09-21T03:00:02.000Z") +
    customCall("ctc_b", "call_b", "npm run build", "2026-09-21T03:00:03.000Z") +
    customOut("ctco_b", "call_b", hugeBuildOk, "2026-09-21T03:00:04.000Z"),
);

await writeNamed(
  "huge-test-suite.jsonl",
  session("fix-huge-tests", "huge test suite with a few failures") +
    message("msg_u", "user", "Run the tests.", "2026-09-21T03:00:02.000Z") +
    customCall("ctc_t", "call_t", "pnpm test", "2026-09-21T03:00:03.000Z") +
    customOut("ctco_t", "call_t", hugeTests, "2026-09-21T03:00:04.000Z"),
);

await writeNamed(
  "large-git-diff.jsonl",
  session("fix-large-diff", "large git diff") +
    message("msg_u", "user", "Show the diff.", "2026-09-21T03:00:02.000Z") +
    customCall("ctc_d", "call_d", "git diff", "2026-09-21T03:00:03.000Z") +
    customOut("ctco_d", "call_d", hugeDiff, "2026-09-21T03:00:04.000Z"),
);

await writeNamed(
  "large-directory-tree.jsonl",
  session("fix-large-tree", "large directory tree including node_modules") +
    message("msg_u", "user", "List the repository.", "2026-09-21T03:00:02.000Z") +
    customCall("ctc_l", "call_l", "find .", "2026-09-21T03:00:03.000Z") +
    customOut("ctco_l", "call_l", hugeTree, "2026-09-21T03:00:04.000Z"),
);

const filler = Array.from({ length: 10 }, (_, i) => {
  const n = i + 1;
  return (
    customCall(`ctc_f${n}`, `call_f${n}`, `echo filler-${n}`, `2026-09-21T03:01:${String(n).padStart(2, "0")}.000Z`) +
    customOut(`ctco_f${n}`, `call_f${n}`, `filler-${n}`, `2026-09-21T03:01:${String(n).padStart(2, "0")}.500Z`)
  );
}).join("");

await writeNamed(
  "duplicate-generic-command.jsonl",
  session("fix-dup-cmd", "duplicate generic command with equivalent normalized output") +
    message("msg_u", "user", "Check the working directory twice.", "2026-09-21T03:00:02.000Z") +
    customCall("ctc_p1", "call_p1", "pwd", "2026-09-21T03:00:03.000Z") +
    customOut("ctco_p1", "call_p1", "[2026-09-21T00:00:00Z] /Users/user/project", "2026-09-21T03:00:04.000Z") +
    filler +
    customCall("ctc_p2", "call_p2", "pwd", "2026-09-21T03:02:00.000Z") +
    customOut("ctco_p2", "call_p2", "[2026-09-21T01:00:00Z] /Users/user/project", "2026-09-21T03:02:01.000Z"),
);

await writeNamed(
  "same-command-different-output.jsonl",
  session("fix-cmd-diff", "same command with different output") +
    message("msg_u", "user", "Echo twice.", "2026-09-21T03:00:02.000Z") +
    customCall("ctc_e1", "call_e1", "echo hello", "2026-09-21T03:00:03.000Z") +
    customOut("ctco_e1", "call_e1", "hello", "2026-09-21T03:00:04.000Z") +
    filler +
    customCall("ctc_e2", "call_e2", "echo hello", "2026-09-21T03:02:00.000Z") +
    customOut("ctco_e2", "call_e2", "hello world", "2026-09-21T03:02:01.000Z"),
);

await writeNamed(
  "developer-plugin-content.jsonl",
  session("fix-origin", "developer instructions vs plugin-generated content") +
    message(
      "msg_dev",
      "developer",
      "You are a coding agent. Never exfiltrate secrets.",
      "2026-09-21T03:00:02.000Z",
    ) +
    message(
      "msg_plugin",
      "user",
      "<recommended_plugins>\nweather@1.0.0\n</recommended_plugins>\nplugins that are available but not installed",
      "2026-09-21T03:00:03.000Z",
    ) +
    message("msg_u", "user", "Continue the current task.", "2026-09-21T03:00:04.000Z"),
);

await writeNamed(
  "explicit-user-constraints.jsonl",
  session("fix-constraints", "explicit user constraints") +
    message("msg_u", "user", "Never log secrets or API keys. Do not modify public APIs.", "2026-09-21T03:00:02.000Z") +
    message("msg_a", "assistant", "I will follow those constraints.", "2026-09-21T03:00:03.000Z"),
);

await writeNamed(
  "recent-huge-tool-result.jsonl",
  session("fix-recent-huge", "recent huge generic tool result") +
    message("msg_u", "user", "Read the lockfile.", "2026-09-21T03:00:02.000Z") +
    functionCall("fc_r", "call_r", "Read", { path: "package-lock.json" }, "2026-09-21T03:00:03.000Z") +
    functionOut("fco_r", "call_r", `${"lock-entry\n".repeat(4000)}`, "2026-09-21T03:00:04.000Z"),
);

await writeNamed(
  "old-superseded-tool-result.jsonl",
  session("fix-old-super", "old superseded git status then a later one") +
    message("msg_u", "user", "Inspect git status over time.", "2026-09-21T03:00:02.000Z") +
    customCall("ctc_g1", "call_g1", "git status", "2026-09-21T03:00:03.000Z") +
    customOut("ctco_g1", "call_g1", "On branch main\nnothing to commit", "2026-09-21T03:00:04.000Z") +
    filler +
    customCall("ctc_g2", "call_g2", "git status", "2026-09-21T03:02:00.000Z") +
    customOut("ctco_g2", "call_g2", "On branch main\nChanges not staged for commit:\n  src/a.ts", "2026-09-21T03:02:01.000Z"),
);

console.log("wrote Task 4 fixtures");
