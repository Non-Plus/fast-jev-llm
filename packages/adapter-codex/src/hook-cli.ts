#!/usr/bin/env node
import { runCodexHookCli } from "./hook.js";

await runCodexHookCli(process.argv.slice(2));
process.exit(0);
