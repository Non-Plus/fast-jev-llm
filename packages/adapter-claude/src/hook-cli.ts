#!/usr/bin/env node
import { runClaudeHookCli } from "./hook.js";

await runClaudeHookCli(process.argv.slice(2));
process.exit(0);
