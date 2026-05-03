#!/usr/bin/env node

const subcommand = process.argv[2];

if (!subcommand || subcommand === '--help' || subcommand === '-h') {
  console.log(`Usage: buddy <command>

Commands:
  doctor    Run diagnostics on your Buddy installation
  onboard   Interactive onboarding wizard`);
  process.exit(0);
}

if (subcommand === 'doctor') {
  await import('./doctor-cli.js');
} else if (subcommand === 'onboard') {
  await import('./onboard.js');
} else {
  console.error(`Unknown command: ${subcommand}\nRun "buddy --help" for usage.`);
  process.exit(1);
}
