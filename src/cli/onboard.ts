#!/usr/bin/env node
// src/cli/onboard.ts — interactive onboarding wizard
// Standalone CLI using Node.js built-in readline (no new dependencies)

import { initDb } from '../db/schema.js';
import {
  companionExists,
  loadCompanion,
  createCompanion,
  rescueCompanion,
  writeBuddyStatus,
} from '../lib/companion.js';
import { renderCard, hatchAnimation, rescueAnimation } from '../lib/card.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { type OldBuddy, parseOldBuddy, deriveSpecies } from '../lib/oldBuddy.js';

import { RESET, DIM, CYAN, YELLOW, GREEN, MAGENTA, BOLD } from '../lib/ansi.js';

// ── Args ──

const args = process.argv.slice(2);
const nonInteractive = args.includes('--non-interactive');
const noColor = args.includes('--no-color');

function c(color: string, text: string): string {
  return noColor ? text : `${color}${text}${RESET}`;
}

// ── Import old buddy from ~/.claude.json ──

function importOldBuddy(): OldBuddy | null {
  try {
    const claudeJsonPath = join(homedir(), '.claude.json');
    const raw = readFileSync(claudeJsonPath, 'utf-8');
    return parseOldBuddy(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ── Arrow-key menu ──

interface MenuChoice {
  label: string;
  value: string;
}

function arrowMenu(prompt: string, choices: MenuChoice[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    // Can't do raw mode if not a TTY
    if (!stdin.isTTY) {
      resolve(choices[0].value);
      return;
    }

    let selectedIndex = 0;

    function render() {
      // Move cursor up to redraw (only after first render)
      if (rendered) {
        stdout.write(`\x1b[${choices.length}A`);
      }
      for (let i = 0; i < choices.length; i++) {
        const prefix = i === selectedIndex
          ? c(CYAN, '  > ')
          : '    ';
        const label = i === selectedIndex
          ? c(BOLD, choices[i].label)
          : c(DIM, choices[i].label);
        stdout.write(`\x1b[2K${prefix}${label}\n`);
      }
    }

    let rendered = false;
    stdout.write(`\n${c(YELLOW, prompt)}\n\n`);
    render();
    rendered = true;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    }

    function onData(key: string) {
      // Ctrl-C
      if (key === '\x03') {
        cleanup();
        stdout.write('\n');
        process.exit(0);
      }

      // Enter
      if (key === '\r' || key === '\n') {
        cleanup();
        stdout.write('\n');
        resolve(choices[selectedIndex].value);
        return;
      }

      // Arrow keys (escape sequences)
      if (key === '\x1b[A' || key === 'k') {
        // Up
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        render();
      } else if (key === '\x1b[B' || key === 'j') {
        // Down
        selectedIndex = (selectedIndex + 1) % choices.length;
        render();
      }
    }

    stdin.on('data', onData);
  });
}

// ── Main ──

async function main() {
  // Initialize database
  initDb();

  // Check if companion already exists — refresh status file and exit
  const existing = companionExists();
  if (existing) {
    const companion = loadCompanion(existing);
    if (companion) {
      writeBuddyStatus(companion);
      console.log(`\n  ${c(GREEN, 'Already have')} ${c(CYAN, companion.name)} the ${c(MAGENTA, companion.species)}!\n`);
      process.exit(0);
    }
  }

  // Try to import old buddy
  const oldBuddy = importOldBuddy();

  // Normalize the species via the shared resolution ladder. This runs even
  // when a species is already set because the legacy Claude Code config used
  // short names ("turtle", "cat") that need to be mapped to canonical list
  // entries ("Shell Turtle", "Void Cat") for the menu label to read correctly.
  if (oldBuddy) {
    const derived = deriveSpecies(oldBuddy);
    if (derived) oldBuddy.species = derived;
  }

  // Build menu choices
  const choices: MenuChoice[] = [];
  if (oldBuddy) {
    const label = oldBuddy.species 
      ? `Rescue ${oldBuddy.name} the ${oldBuddy.species}`
      : `Rescue ${oldBuddy.name}`;
    choices.push({
      label,
      value: 'rescue',
    });
  }
  choices.push({ label: 'Hatch New Buddy', value: 'hatch' });
  choices.push({ label: 'Maybe later', value: 'skip' });

  // Choose action
  let action: string;
  const isTTY = process.stdin.isTTY && process.stdout.isTTY;

  if (nonInteractive || !isTTY) {
    // Non-interactive (curl | bash, piped installs): auto-rescue or auto-hatch.
    // Users expect a buddy after install — don't leave them empty-handed.
    action = oldBuddy ? 'rescue' : 'hatch';
    console.log(`\n  ${c(DIM, `Auto-selecting: ${action}`)}`);
  } else {
    action = await arrowMenu('What would you like to do?', choices);
  }

  // Execute
  if (action === 'skip') {
    console.log(`\n  ${c(DIM, 'No problem. Say "hatch a buddy" in your CLI to start later.')}\n`);
    process.exit(0);
  }

  if (action === 'rescue' && oldBuddy) {
    const { companion } = rescueCompanion(oldBuddy);
    console.log(rescueAnimation(companion));
    process.exit(0);
  }

  // Default: hatch
  const { companion } = createCompanion();
  console.log(hatchAnimation(companion));
  process.exit(0);
}

main().catch((err) => {
  console.error('Onboarding error:', err);
  process.exit(1);
});
