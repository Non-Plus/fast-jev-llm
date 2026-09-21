import type { ContextAction, ContextItem, ContextMessage } from "../src/types.js";

export interface SemanticEvalCase {
  id: string;
  description: string;
  messages: ContextMessage[];
  select: (items: readonly ContextItem[]) => ContextItem | undefined;
  acceptable: ContextAction[];
  unacceptable: ContextAction[];
  requiresRetention?: boolean;
  mockAction?: "KEEP" | "COMPRESS" | "DROP";
  mockRelevance?: number;
  mockConfidence?: number;
  recentItemCount?: number;
}

function user(id: string, content: string): ContextMessage {
  return { id, role: "user", content };
}

function assistant(id: string, content: string): ContextMessage {
  return { id, role: "assistant", content };
}

function system(id: string, content: string): ContextMessage {
  return { id, role: "system", content };
}

function toolPair(
  prefix: string,
  name: string,
  args: Record<string, unknown>,
  content: string,
  metadata?: Record<string, unknown>,
): ContextMessage[] {
  return [
    {
      id: `${prefix}-a`,
      role: "assistant",
      content: "",
      toolCalls: [{ id: `${prefix}-c`, name, arguments: args }],
    },
    {
      id: `${prefix}-t`,
      role: "tool",
      toolCallId: `${prefix}-c`,
      content,
      ...(metadata ? { metadata } : {}),
    },
  ];
}

function frame(middle: ContextMessage[], task = "Implement the auth module."): ContextMessage[] {
  return [
    system("sys", "Follow repository standing instructions."),
    user("u0", `Never delete production data. ${task}`),
    ...middle,
    user("u-end", "Please continue implementing auth."),
  ];
}

function byContent(needle: string) {
  return (items: readonly ContextItem[]) => items.find((item) => item.content.includes(needle));
}

function byToolCommand(needle: string) {
  return (items: readonly ContextItem[]) => items.find((item) => item.tool?.command?.includes(needle));
}

function byToolPath(path: string) {
  return (items: readonly ContextItem[]) => items.find((item) => item.tool?.path === path);
}

const constraints: SemanticEvalCase[] = [
  "Never change the public API of auth.ts",
  "Always keep secrets out of logs",
  "Do not rewrite git history",
  "Must not drop user constraints",
  "Under no circumstances delete migrations",
  "Requirement: preserve the existing schema",
  "Important: stay on the current branch",
  "Don't expose internal tokens",
  "The architecture constraint is hexagonal modules",
  "Always use the existing error type",
].map((text, index) => ({
  id: `constraint-${index + 1}`,
  description: `user architecture/safety constraint: ${text}`,
  messages: [system("sys", "Standing policy."), user("u1", text), assistant("a1", "Understood.")],
  select: byContent(text),
  acceptable: ["PROTECT"],
  unacceptable: ["DROP", "COMPRESS"],
  requiresRetention: true,
  mockAction: "DROP",
  recentItemCount: 0,
}));

const systems: SemanticEvalCase[] = [
  "You are a coding agent. Follow developer instructions.",
  "Developer: never run destructive commands.",
  "System safety policy: do not exfiltrate secrets.",
  "Follow the repository AGENTS.md rules.",
].map((text, index) => ({
  id: `system-${index + 1}`,
  description: "system/developer standing instruction",
  messages: [system("sys", text), user("u1", "Never skip tests. Add a unit test.")],
  select: (items) => items.find((item) => item.role === "system"),
  acceptable: ["PROTECT"],
  unacceptable: ["DROP", "COMPRESS"],
  requiresRetention: true,
  mockAction: "DROP",
  recentItemCount: 0,
}));

const currentTasks: SemanticEvalCase[] = ["Fix the login redirect.", "Add OAuth callback handling.", "Wire session cookies.", "Implement CSRF protection."].map(
  (text, index) => ({
    id: `task-${index + 1}`,
    description: "current user task",
    messages: [
      system("sys", "Follow user constraints."),
      user("old", "Never log secrets. Yesterday we cleaned lint."),
      assistant("a0", "Lint was cleaned."),
      user("cur", text),
    ],
    select: byContent(text),
    acceptable: ["PROTECT"],
    unacceptable: ["DROP", "COMPRESS"],
    requiresRetention: true,
    mockAction: "DROP",
    recentItemCount: 1,
  }),
);

const unresolved: SemanticEvalCase[] = [
  "TypeError: Cannot read properties of undefined",
  "panic: runtime error: invalid memory address",
  "ECONNREFUSED 127.0.0.1:5432",
  "Error: secret provider unavailable",
  "FAILED src/auth.test.ts > login",
  "Exception: token exchange failed",
  "ReferenceError: fetch is not defined",
  "npm ERR! Missing script: start",
].map((error, index) => ({
  id: `unresolved-${index + 1}`,
  description: "unresolved runtime/tool error",
  messages: [
    system("sys", "Follow user constraints."),
    user("u1", "Never ignore failures. Fix the runtime error."),
    ...toolPair(
      `err${index}`,
      "Bash",
      { command: `node src/run-${index}.js` },
      `${error}\n    at Object.<anonymous> (src/run.js:1:1)`,
      { exitCode: 1, isError: true },
    ),
  ],
  select: byToolCommand(`src/run-${index}.js`),
  acceptable: ["KEEP", "PROTECT", "COMPRESS"],
  unacceptable: ["DROP"],
  requiresRetention: true,
  mockAction: "DROP",
  recentItemCount: 8,
}));

const listings: SemanticEvalCase[] = Array.from({ length: 8 }, (_, index) => ({
  id: `ls-${index + 1}`,
  description: "historical ls output unrelated to current task",
  messages: frame([
    ...toolPair(
      `ls${index}`,
      "Bash",
      { command: "ls -la /tmp/unrelated" },
      `total ${index}\ndrwxr-xr-x  2 user staff  64 Jan 1 00:00 .\nfile-${index}.log\n`,
    ),
    assistant(`hist-${index}`, "That listing is leftover from exploration."),
  ]),
  select: byToolCommand("ls -la /tmp/unrelated"),
  acceptable: ["DROP", "COMPRESS"],
  unacceptable: ["PROTECT"],
  mockAction: "DROP",
  mockRelevance: 0.05,
  mockConfidence: 0.92,
  recentItemCount: 2,
}));

const resolvedDebug: SemanticEvalCase[] = Array.from({ length: 6 }, (_, index) => ({
  id: `debug-${index + 1}`,
  description: "old debugging output now resolved",
  messages: frame([
    ...toolPair(
      `dbg${index}`,
      "Bash",
      { command: `pnpm test src/old-${index}.test.ts` },
      `FAIL src/old-${index}.test.ts\nError: stack trace debug ${index}\nAssertionError: expected 1 to be 2`,
      { exitCode: 1, isError: true },
    ),
    ...toolPair(
      `ok${index}`,
      "Bash",
      { command: `pnpm test src/old-${index}.test.ts` },
      `PASS src/old-${index}.test.ts\n  3 passed`,
      { exitCode: 0 },
    ),
  ]),
  select: (items) =>
    items.find(
      (item) =>
        item.tool?.command?.includes(`src/old-${index}.test.ts`) &&
        item.tool.isError === true,
    ),
  acceptable: ["DROP", "COMPRESS"],
  unacceptable: ["PROTECT"],
  mockAction: "DROP",
  mockRelevance: 0.12,
  mockConfidence: 0.9,
  recentItemCount: 2,
}));

const oldReads: SemanticEvalCase[] = Array.from({ length: 6 }, (_, index) => ({
  id: `read-${index + 1}`,
  description: "old file read with no obvious current relationship",
  messages: frame([
    ...toolPair(
      `rd${index}`,
      "Read",
      { path: `docs/changelog-${index}.md` },
      `# Changelog ${index}\n- unrelated historical note\n- leftover docs`,
    ),
    assistant(`note-${index}`, "Changelog is background only."),
  ]),
  select: byToolPath(`docs/changelog-${index}.md`),
  acceptable: ["DROP", "COMPRESS", "KEEP"],
  unacceptable: ["PROTECT"],
  mockAction: "DROP",
  mockRelevance: 0.15,
  mockConfidence: 0.88,
  recentItemCount: 2,
}));

const searches: SemanticEvalCase[] = Array.from({ length: 4 }, (_, index) => ({
  id: `search-${index + 1}`,
  description: "historical exploratory search",
  messages: frame([
    ...toolPair(
      `rg${index}`,
      "Bash",
      { command: `rg TODO /opt/unrelated-${index}` },
      `TODO ${index}: leftover exploratory search output\n`.repeat(20),
    ),
    assistant(`search-note-${index}`, "That search was leftover exploration."),
  ]),
  select: byToolCommand(`rg TODO /opt/unrelated-${index}`),
  acceptable: ["DROP", "COMPRESS"],
  unacceptable: ["PROTECT"],
  mockAction: "DROP",
  mockRelevance: 0.08,
  mockConfidence: 0.93,
  recentItemCount: 2,
}));

export const SEMANTIC_EVAL_CASES: SemanticEvalCase[] = [
  ...constraints,
  ...systems,
  ...currentTasks,
  ...unresolved,
  ...listings,
  ...resolvedDebug,
  ...oldReads,
  ...searches,
];
