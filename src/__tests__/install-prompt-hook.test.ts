// Regression guard for the bug that shipped the re-injection feature inert:
// the UserPromptSubmit prompt hook was registered `async: true`, and Claude Code
// does not fold an async hook's stdout into context. These assert the installers
// register it SYNCHRONOUSLY and upgrade any pre-existing async registration.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

for (const f of ['install.sh', 'install.ps1']) {
  describe(`prompt hook registration in ${f}`, () => {
    const src = readFileSync(f, 'utf-8');

    it('registers the prompt hook synchronously (no async:true on the prompt hook)', () => {
      expect(src).toMatch(/command: promptHookCommand, timeout: PROMPT_SYNC_TIMEOUT/);
      expect(src).not.toMatch(/promptHookCommand,\s*async:\s*true/);
    });

    it('upgrades a pre-existing async registration in place', () => {
      expect(src).toContain('if (h.async) { delete h.async');
      expect(src).toMatch(/PROMPT_SYNC_TIMEOUT\s*=\s*10/);
    });

    // Cross-host: the same re-injection hook must also reach Codex, whose
    // UserPromptSubmit stdout goes to model context just like Claude Code's.
    it('wires the prompt hook into the Codex UserPromptSubmit config', () => {
      expect(src).toContain('config.hooks.UserPromptSubmit');
      expect(src).toMatch(/command: promptHookCommand, timeout: 10/);
    });
  });
}
