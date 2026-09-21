import type { ContextMessage, Transcript } from "../packages/core/src/types.js";

const LARGE_LOCKFILE = `# yarn lockfile v1\n${"lodash@4.17.21:\n  version \"4.17.21\"\n  resolved \"https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz\"\n\n".repeat(250)}`;

const TSC_ERROR = [
  "src/rate-limit.ts:12:5 - error TS2304: Cannot find name 'windowMs'.",
  "src/rate-limit.ts:18:7 - error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/server.ts:4:1 - error TS6133: 'secret' is declared but its value is never read.",
  "Found 3 errors in 2 files.",
  ...Array.from({ length: 250 }, (_, i) => `note: extra compiler chatter line ${i}`),
].join("\n");

let messageSeq = 0;
let callSeq = 0;

function mid(): string {
  messageSeq += 1;
  return `m${messageSeq}`;
}

function cid(): string {
  callSeq += 1;
  return `c${callSeq}`;
}

function system(content: string): ContextMessage {
  return { id: mid(), role: "system", content };
}

function user(content: string, metadata?: Record<string, unknown>): ContextMessage {
  return {
    id: mid(),
    role: "user",
    content,
    ...(metadata ? { metadata } : {}),
  };
}

function assistant(content: string): ContextMessage {
  return { id: mid(), role: "assistant", content };
}

function toolExchange(
  name: string,
  args: Record<string, unknown> | string,
  result: string,
  extra?: { isError?: boolean; exitCode?: number; assistantText?: string },
): ContextMessage[] {
  const callId = cid();
  const assistantMessage: ContextMessage = {
    id: mid(),
    role: "assistant",
    content: extra?.assistantText ?? "",
    toolCalls: [{ id: callId, name, arguments: args }],
  };
  const metadata: Record<string, unknown> = {};
  if (extra?.isError === true) {
    metadata["isError"] = true;
  }
  if (extra?.exitCode !== undefined) {
    metadata["exitCode"] = extra.exitCode;
  }
  const toolMessage: ContextMessage = {
    id: mid(),
    role: "tool",
    toolCallId: callId,
    name,
    content: result,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
  return [assistantMessage, toolMessage];
}

export function buildCodingSessionTranscript(): Transcript {
  messageSeq = 0;
  callSeq = 0;

  const messages: ContextMessage[] = [
    system(
      "You are a coding assistant working in a local repository. Prefer small, test-backed changes.",
    ),
    user(
      "Add rate limiting to the Express API in src/server.ts. Never log secrets or API keys.\nAcceptance criteria: requests over the limit return 429.",
    ),
    assistant("I'll inspect the repository layout and current git state."),
    ...toolExchange("Shell", { command: "ls" }, "package.json\nsrc\nREADME.md\n"),
    ...toolExchange("Shell", { command: "echo hello" }, "hello\n"),
    ...toolExchange("Shell", { command: "echo hello" }, "hello from a later shell\n"),
    ...toolExchange("Shell", { command: "pwd" }, "/workspace/api\n"),
    ...toolExchange("Shell", { command: "pwd" }, "/workspace/api\n"),
    ...toolExchange(
      "Shell",
      { command: "git status" },
      "On branch main\nChanges not staged for commit:\n  modified: src/server.ts\n",
    ),
    ...toolExchange(
      "Shell",
      { command: "git diff" },
      "diff --git a/src/server.ts b/src/server.ts\n+console.log('boot');\n",
    ),
    ...toolExchange(
      "Read",
      { path: "package.json" },
      '{\n  "name": "api",\n  "scripts": { "test": "vitest run" }\n}\n',
    ),
    ...toolExchange(
      "Read",
      { path: "src/server.ts" },
      "import express from 'express';\nexport const app = express();\napp.get('/health', (_req, res) => res.json({ ok: true }));\n",
    ),
    ...toolExchange(
      "Read",
      { path: "src/server.ts" },
      "import express from 'express';\nexport const app = express();\napp.get('/health', (_req, res) => res.json({ ok: true }));\n",
    ),
    user("Also add a health check if one is missing."),
    assistant("I'll look at the routes and re-check package.json."),
    ...toolExchange("Glob", { glob: "src/**" }, "src/server.ts\nsrc/routes.ts\n"),
    ...toolExchange(
      "Read",
      { path: "src/routes.ts" },
      "export function registerRoutes(app) {\n  app.get('/items', listItems);\n}\n",
    ),
    ...toolExchange(
      "Read",
      { path: "package.json" },
      '{\n  "name": "api",\n  "scripts": { "test": "vitest run", "lint": "eslint ." }\n}\n',
    ),
    ...toolExchange(
      "Shell",
      { command: "git status" },
      "On branch main\nmodified: src/server.ts\nmodified: src/routes.ts\n",
    ),
    ...toolExchange(
      "Shell",
      { command: "git diff" },
      "diff --git a/src/routes.ts b/src/routes.ts\n+// health lives on server\n",
    ),
    ...toolExchange(
      "Shell",
      { command: "ls" },
      "package.json\npackage-lock.json\nsrc\nREADME.md\n",
    ),
    ...toolExchange("Read", { path: "package-lock.json" }, LARGE_LOCKFILE),
    ...toolExchange(
      "Shell",
      { command: "npm run lint" },
      "error: Unexpected console statement at src/server.ts:3\n",
      { isError: true, exitCode: 1 },
    ),
    assistant("I'll add rate-limit middleware next to the server entrypoint."),
    ...toolExchange(
      "Read",
      { path: "src/rate-limit.ts" },
      "export function rateLimit() { return (req, res, next) => next(); }\n",
    ),
    ...toolExchange(
      "Write",
      { path: "src/rate-limit.ts", contents: "export function rateLimit() { return limiter; }" },
      "Wrote src/rate-limit.ts",
    ),
    ...toolExchange(
      "Read",
      { path: "src/rate-limit.ts" },
      "export function rateLimit() { return limiter; }\n",
    ),
    user("continue"),
    ...toolExchange(
      "Shell",
      { command: "pnpm test" },
      "FAIL src/rate-limit.test.ts\n  1 failed, 2 passed\n",
      { isError: true, exitCode: 1 },
    ),
    user("yes"),
    ...toolExchange(
      "Shell",
      { command: "tsc -p tsconfig.json" },
      TSC_ERROR,
      { isError: true, exitCode: 1 },
    ),
    user("fix that error"),
    assistant("The limiter was a no-op and the compile error is a missing identifier."),
    ...toolExchange(
      "Write",
      {
        path: "src/rate-limit.ts",
        contents: "export function rateLimit() { const windowMs = 60_000; return limiter(windowMs); }",
      },
      "Wrote src/rate-limit.ts",
    ),
    ...toolExchange(
      "Shell",
      { command: "tsc -p tsconfig.json" },
      "Found 0 errors.\n",
      { exitCode: 0 },
    ),
    ...toolExchange(
      "Read",
      { path: "src/rate-limit.ts" },
      "export function rateLimit() { const windowMs = 60_000; return limiter(windowMs); }\n",
    ),
    ...toolExchange(
      "Shell",
      { command: "pnpm test" },
      "FAIL src/rate-limit.test.ts\n  1 failed, 2 passed\nAssertionError: expected 429, got 200\n",
      { isError: true, exitCode: 1 },
    ),
    assistant("I'll enforce a window and retry-after header."),
    ...toolExchange(
      "Write",
      {
        path: "src/rate-limit.ts",
        contents: "export function rateLimit() { /* token bucket */ }",
      },
      "Wrote src/rate-limit.ts",
    ),
    ...toolExchange(
      "Shell",
      { command: "pnpm test" },
      "PASS src/rate-limit.test.ts\n  3 passed, 0 failed\n",
      { exitCode: 0 },
    ),
    ...toolExchange(
      "Shell",
      { command: "git status" },
      "On branch main\nmodified: src/rate-limit.ts\nmodified: src/server.ts\n",
    ),
    ...toolExchange(
      "Shell",
      { command: "git diff" },
      "diff --git a/src/rate-limit.ts b/src/rate-limit.ts\n+export function rateLimit() { /* window */ }\n",
    ),
    user("Make sure the tests still pass and re-read the limiter."),
    assistant("Re-running the suite and re-reading the limiter."),
    ...toolExchange(
      "Shell",
      { command: "pnpm test" },
      "PASS src/rate-limit.test.ts\n  3 passed, 0 failed\n",
      { exitCode: 0 },
    ),
    ...toolExchange(
      "Shell",
      { command: "ls" },
      "package.json\npackage-lock.json\nsrc\nREADME.md\n",
    ),
    ...toolExchange(
      "Read",
      { path: "src/rate-limit.ts" },
      "export function rateLimit() {\n  return function limit(req, res, next) {\n    /* token bucket */\n    next();\n  };\n}\n",
    ),
  ];

  return {
    sessionId: "coding-session-rate-limit",
    messages,
  };
}

export const codingSessionTranscript: Transcript = buildCodingSessionTranscript();
