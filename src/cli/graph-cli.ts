#!/usr/bin/env node
import { initDb } from '../db/schema.js';
import { runBuddyGraphCli } from '../lib/reasoning/graph-viz.js';

try {
  initDb();
} catch (error) {
  console.error(`Failed to initialize Buddy database: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

try {
  const code = runBuddyGraphCli(process.argv.slice(2));
  process.exit(code);
} catch (error) {
  console.error(`Failed to generate Buddy graph: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
