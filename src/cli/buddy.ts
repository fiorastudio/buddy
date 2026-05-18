#!/usr/bin/env node

const subcommand = process.argv[2];

if (!subcommand || subcommand === '--help' || subcommand === '-h') {
  console.log(`Usage: buddy <command>

Commands:
  pet       Pet your buddy and earn XP
  doctor    Run diagnostics on your Buddy installation
  graph     Generate an interactive reasoning graph
  onboard   Interactive onboarding wizard`);
  process.exit(0);
}

if (subcommand === 'pet') {
  await import('./pet-cli.js');
} else if (subcommand === 'doctor') {
  await import('./doctor-cli.js');
} else if (subcommand === 'graph') {
  const { runGraphCommand } = await import('./graph-cli.js');
  process.exit(runGraphCommand(process.argv.slice(3)));
} else if (subcommand === 'onboard') {
  await import('./onboard.js');
} else {
  console.error(`Unknown command: ${subcommand}\nRun "buddy --help" for usage.`);
  process.exit(1);
}
