import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  COMPLETION_REGEX,
  ONGOING_REGEX,
  handleStop,
  writeCompletionReaction,
  type StopInput,
} from '../hooks/stop-handler.js';

// ---------------------------------------------------------------------------
// COMPLETION_REGEX
// ---------------------------------------------------------------------------

describe('COMPLETION_REGEX', () => {
  describe('true positives', () => {
    it('matches "I have implemented"', () => {
      expect(COMPLETION_REGEX.test("I have implemented the feature")).toBe(true);
    });
    it('matches "I\'ve fixed"', () => {
      expect(COMPLETION_REGEX.test("I've fixed the null pointer bug")).toBe(true);
    });
    it('matches "tests pass"', () => {
      expect(COMPLETION_REGEX.test("All tests pass now")).toBe(true);
    });
    it('matches "tests passed"', () => {
      expect(COMPLETION_REGEX.test("The tests passed after the refactor")).toBe(true);
    });
    it('matches "successfully deployed"', () => {
      expect(COMPLETION_REGEX.test("I've successfully deployed the service")).toBe(true);
    });
    it('matches "build succeeded"', () => {
      expect(COMPLETION_REGEX.test("The build succeeded with no warnings")).toBe(true);
    });
    it('matches "I\'ve committed"', () => {
      expect(COMPLETION_REGEX.test("I've committed the changes")).toBe(true);
    });
    it('matches "the fix is in place"', () => {
      expect(COMPLETION_REGEX.test("The fix is in place and working")).toBe(true);
    });
  });

  describe('false positives — should NOT match', () => {
    it('rejects "I will implement"', () => {
      expect(COMPLETION_REGEX.test("I will implement this next")).toBe(false);
    });
    it('rejects "implementing"', () => {
      expect(COMPLETION_REGEX.test("I am implementing the feature")).toBe(false);
    });
    it('rejects "tests are failing"', () => {
      expect(COMPLETION_REGEX.test("The tests are failing right now")).toBe(false);
    });
    it('rejects short planning sentence', () => {
      expect(COMPLETION_REGEX.test("Let me check the error")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// ONGOING_REGEX
// ---------------------------------------------------------------------------

describe('ONGOING_REGEX', () => {
  it('matches "I\'ll "', () => {
    expect(ONGOING_REGEX.test("I'll look into this")).toBe(true);
  });
  it('matches "Let me "', () => {
    expect(ONGOING_REGEX.test("Let me read the file first")).toBe(true);
  });
  it('matches "I\'m going to"', () => {
    expect(ONGOING_REGEX.test("I'm going to refactor this")).toBe(true);
  });
  it('does not match completion sentences', () => {
    expect(ONGOING_REGEX.test("I've implemented the feature")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleStop integration
// ---------------------------------------------------------------------------

describe('handleStop', () => {
  let statusPath: string;

  const baseStatus = {
    name: 'TestBuddy',
    species: 'Mushroom',
    level: 3,
    xp: 42,
    mood: 'happy',
  };

  beforeEach(() => {
    const dir = join(tmpdir(), 'buddy-stop-test-' + Date.now());
    mkdirSync(dir, { recursive: true });
    statusPath = join(dir, 'buddy-status.json');
    writeFileSync(statusPath, JSON.stringify(baseStatus));
  });

  afterEach(() => {
    try { unlinkSync(statusPath); } catch { /* cleanup */ }
  });

  it('writes excited reaction when last_assistant_message has completion signal', () => {
    const input: StopInput = {
      last_assistant_message: "I've implemented the authentication module and all tests pass.",
    };
    const result = handleStop(input, statusPath);
    expect(result).toBe(true);

    const status = JSON.parse(readFileSync(statusPath, 'utf-8'));
    expect(status.reaction).toBe('excited');
    expect(status.reaction_eye).toBe('^');
    expect(status.reaction_expires).toBeGreaterThan(Date.now());
    expect(status.name).toBe('TestBuddy');
  });

  it('does NOT fire when message is too short', () => {
    const input: StopInput = { last_assistant_message: "Done." };
    expect(handleStop(input, statusPath)).toBe(false);
  });

  it('does NOT fire on ongoing work', () => {
    const input: StopInput = {
      last_assistant_message: "I'll implement this feature by modifying the auth module and running the tests afterwards.",
    };
    expect(handleStop(input, statusPath)).toBe(false);
  });

  it('does NOT fire when no completion signal', () => {
    const input: StopInput = {
      last_assistant_message: "Here is a long explanation of why this approach is better than the alternatives we discussed earlier.",
    };
    expect(handleStop(input, statusPath)).toBe(false);
  });

  it('does NOT overwrite active reaction', () => {
    const status = JSON.parse(readFileSync(statusPath, 'utf-8'));
    status.reaction = 'concerned';
    status.reaction_text = 'uh oh';
    status.reaction_expires = Date.now() + 30_000;
    writeFileSync(statusPath, JSON.stringify(status));

    const input: StopInput = {
      last_assistant_message: "I've fixed the bug and all tests pass now successfully.",
    };
    expect(handleStop(input, statusPath)).toBe(false);

    const updated = JSON.parse(readFileSync(statusPath, 'utf-8'));
    expect(updated.reaction).toBe('concerned');
  });

  it('handles missing status file gracefully', () => {
    const input: StopInput = {
      last_assistant_message: "I've implemented the feature and tests are passing.",
    };
    expect(handleStop(input, '/tmp/nonexistent-buddy-stop-test.json')).toBe(false);
  });

  it('handles missing input gracefully', () => {
    expect(handleStop({}, statusPath)).toBe(false);
  });
});
