#!/usr/bin/env node
// src/cli/doctor-cli.ts — CLI entry point for buddy-doctor
// Usage: node dist/cli/doctor-cli.js
//   or:  buddy-doctor (if installed globally via npm)

try {
  const { initDb } = await import('../db/schema.js');
  initDb();
} catch (e: any) {
  console.error(`\u26A0 Database initialization failed: ${e?.message || 'unknown error'}`);
  console.error(`  DB path: ${process.env.BUDDY_DB_PATH || '~/.buddy/buddy.db'}`);
  console.error('  The doctor will still run but companion/DB checks will fail.\n');
}

const { runDiagnostics, formatReport } = await import('../lib/doctor.js');

const checks = runDiagnostics();
console.log(formatReport(checks));

// Exit with non-zero if any checks failed
const hasFail = checks.some(c => c.status === 'fail');
process.exit(hasFail ? 1 : 0);
