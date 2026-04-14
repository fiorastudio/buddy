import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  ERROR_REGEX,
  handlePostToolUse,
  hasActiveReaction,
  writeConcernedReaction,
  type PostToolUseInput,
} from '../hooks/post-tool-handler.js';

// ---------------------------------------------------------------------------
// Error Regex
// ---------------------------------------------------------------------------

describe('ERROR_REGEX', () => {
  describe('true positives — should match', () => {
    it('matches "exit code 1"', () => {
      expect(ERROR_REGEX.test('Command failed with exit code 1')).toBe(true);
    });

    it('matches "exit code 2"', () => {
      expect(ERROR_REGEX.test('Process exited with exit code 2')).toBe(true);
    });

    it('matches "Error: ENOENT"', () => {
      expect(ERROR_REGEX.test('Error: ENOENT: no such file or directory')).toBe(true);
    });

    it('matches "EACCES"', () => {
      expect(ERROR_REGEX.test('Error: EACCES: permission denied')).toBe(true);
    });

    it('matches "FAILED"', () => {
      expect(ERROR_REGEX.test('Tests: 3 FAILED, 10 passed')).toBe(true);
    });

    it('matches "panicked at"', () => {
      expect(ERROR_REGEX.test("thread 'main' panicked at 'index out of bounds'")).toBe(true);
    });

    it('matches "error:" with word boundary', () => {
      expect(ERROR_REGEX.test('src/main.rs:5 error: expected expression')).toBe(true);
    });

    it('matches case-insensitive "Error:"', () => {
      expect(ERROR_REGEX.test('TypeError: Cannot read properties')).toBe(true);
    });
  });

  describe('false positives — should NOT match', () => {
    it('rejects "error handling added"', () => {
      // "error" followed by space, not colon — no word boundary match on "error:"
      expect(ERROR_REGEX.test('Added error handling for edge cases')).toBe(false);
    });

    it('rejects "0 errors"', () => {
      expect(ERROR_REGEX.test('Build completed: 0 errors, 0 warnings')).toBe(false);
    });

    it('rejects "no failures"', () => {
      expect(ERROR_REGEX.test('All tests passed with no failures')).toBe(false);
    });

    it('rejects "exit code 0"', () => {
      expect(ERROR_REGEX.test('Process exited with exit code 0')).toBe(false);
    });

    it('rejects normal output', () => {
      expect(ERROR_REGEX.test('npm install completed successfully')).toBe(false);
    });

    it('rejects "errorCount" (no colon after error)', () => {
      expect(ERROR_REGEX.test('errorCount: 0')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// handlePostToolUse integration
// ---------------------------------------------------------------------------

describe('handlePostToolUse', () => {
  let statusPath: string;

  beforeEach(() => {
    // Create a temp status file
    const dir = join(tmpdir(), 'buddy-hook-test-' + Date.now());
    mkdirSync(dir, { recursive: true });
    statusPath = join(dir, 'buddy-status.json');
    writeFileSync(statusPath, JSON.stringify({
      name: 'TestBuddy',
      species: 'Mushroom',
      level: 3,
      xp: 42,
      mood: 'happy',
      rarity: 'common',
      eye: 'o',
    }));
  });

  afterEach(() => {
    try { unlinkSync(statusPath); } catch { /* cleanup */ }
  });

  it('writes concerned reaction on Bash error', () => {
    const input: PostToolUseInput = {
      tool_name: 'Bash',
      tool_response: 'npm ERR! error: ENOENT: no such file',
    };

    const result = handlePostToolUse(input, statusPath);
    expect(result).toBe(true);

    const status = JSON.parse(readFileSync(statusPath, 'utf-8'));
    expect(status.reaction).toBe('concerned');
    expect(status.reaction_indicator).toBe('?');
    expect(status.reaction_expires).toBeGreaterThan(Date.now());
    // Original data preserved
    expect(status.name).toBe('TestBuddy');
    expect(status.species).toBe('Mushroom');
  });

  it('does NOT act on non-Bash tools', () => {
    const input: PostToolUseInput = {
      tool_name: 'Read',
      tool_response: 'error: file not found',
    };

    const result = handlePostToolUse(input, statusPath);
    expect(result).toBe(false);

    const status = JSON.parse(readFileSync(statusPath, 'utf-8'));
    expect(status.reaction).toBeUndefined();
  });

  it('does NOT act on Bash without errors', () => {
    const input: PostToolUseInput = {
      tool_name: 'Bash',
      tool_response: 'Build succeeded. 0 errors, 0 warnings.',
    };

    const result = handlePostToolUse(input, statusPath);
    expect(result).toBe(false);
  });

  it('does NOT overwrite active reaction (race protection)', () => {
    // Write an active reaction first
    const status = JSON.parse(readFileSync(statusPath, 'utf-8'));
    status.reaction = 'excited';
    status.reaction_text = 'Nice commit!';
    status.reaction_expires = Date.now() + 30_000; // 30s from now
    writeFileSync(statusPath, JSON.stringify(status));

    const input: PostToolUseInput = {
      tool_name: 'Bash',
      tool_response: 'error: compilation failed',
    };

    const result = handlePostToolUse(input, statusPath);
    expect(result).toBe(false);

    // Original reaction preserved
    const updated = JSON.parse(readFileSync(statusPath, 'utf-8'));
    expect(updated.reaction).toBe('excited');
    expect(updated.reaction_text).toBe('Nice commit!');
  });

  it('DOES write reaction when previous reaction expired', () => {
    // Write an expired reaction
    const status = JSON.parse(readFileSync(statusPath, 'utf-8'));
    status.reaction = 'amused';
    status.reaction_text = 'old reaction';
    status.reaction_expires = Date.now() - 5_000; // 5s ago
    writeFileSync(statusPath, JSON.stringify(status));

    const input: PostToolUseInput = {
      tool_name: 'Bash',
      tool_response: 'FAILED: 2 tests failed',
    };

    const result = handlePostToolUse(input, statusPath);
    expect(result).toBe(true);

    const updated = JSON.parse(readFileSync(statusPath, 'utf-8'));
    expect(updated.reaction).toBe('concerned');
  });

  it('handles missing status file gracefully', () => {
    const bogusPath = join(tmpdir(), 'nonexistent-buddy-status.json');
    const input: PostToolUseInput = {
      tool_name: 'Bash',
      tool_response: 'error: something broke',
    };

    // Should not throw
    const result = handlePostToolUse(input, bogusPath);
    expect(result).toBe(false);
  });

  it('handles empty tool_response', () => {
    const input: PostToolUseInput = {
      tool_name: 'Bash',
      tool_response: '',
    };

    const result = handlePostToolUse(input, statusPath);
    expect(result).toBe(false);
  });

  it('handles undefined tool_response', () => {
    const input: PostToolUseInput = {
      tool_name: 'Bash',
    };

    const result = handlePostToolUse(input, statusPath);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasActiveReaction
// ---------------------------------------------------------------------------

describe('hasActiveReaction', () => {
  let statusPath: string;

  beforeEach(() => {
    const dir = join(tmpdir(), 'buddy-hook-test-active-' + Date.now());
    mkdirSync(dir, { recursive: true });
    statusPath = join(dir, 'buddy-status.json');
  });

  afterEach(() => {
    try { unlinkSync(statusPath); } catch { /* cleanup */ }
  });

  it('returns true when reaction is active', () => {
    writeFileSync(statusPath, JSON.stringify({
      name: 'Buddy',
      reaction_expires: Date.now() + 10_000,
    }));
    expect(hasActiveReaction(statusPath)).toBe(true);
  });

  it('returns false when reaction is expired', () => {
    writeFileSync(statusPath, JSON.stringify({
      name: 'Buddy',
      reaction_expires: Date.now() - 1_000,
    }));
    expect(hasActiveReaction(statusPath)).toBe(false);
  });

  it('returns false when no reaction_expires', () => {
    writeFileSync(statusPath, JSON.stringify({ name: 'Buddy' }));
    expect(hasActiveReaction(statusPath)).toBe(false);
  });

  it('returns false for missing file', () => {
    expect(hasActiveReaction('/tmp/nonexistent-buddy-test.json')).toBe(false);
  });
});
