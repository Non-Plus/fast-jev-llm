#!/usr/bin/env node
import { runCursorHookCli } from "./hook.js";

await runCursorHookCli(process.argv.slice(2));
process.exit(0);
