#!/usr/bin/env node
// src/cli/doctor-cli.ts — CLI entry point for buddy-doctor
// Usage: node dist/cli/doctor-cli.js
//   or:  buddy-doctor (if installed globally via npm)

import { initDb } from '../db/schema.js';
import { runDiagnostics, formatReport } from '../lib/doctor.js';

initDb();
const checks = runDiagnostics();
console.log(formatReport(checks));

// Exit with non-zero if any checks failed
const hasFail = checks.some(c => c.status === 'fail');
process.exit(hasFail ? 1 : 0);
