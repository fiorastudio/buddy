import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  FRUSTRATION_REGEX,
  EXCITEMENT_REGEX,
  handlePromptSubmit,
  type PromptInput,
} from '../hooks/prompt-handler.js';

// ---------------------------------------------------------------------------
// FRUSTRATION_REGEX
// ---------------------------------------------------------------------------

describe('FRUSTRATION_REGEX', () => {
  it('matches "wtf"', () => {
    expect(FRUSTRATION_REGEX.test("wtf is happening here")).toBe(true);
  });
  it('matches "not working"', () => {
    expect(FRUSTRATION_REGEX.test("this is not working again")).toBe(true);
  });
  it('matches "still broken"', () => {
    expect(FRUSTRATION_REGEX.test("It's still broken")).toBe(true);
  });
  it('matches "I\'m stuck"', () => {
    expect(FRUSTRATION_REGEX.test("I'm stuck on this for hours")).toBe(true);
  });
  it('matches "so frustrated"', () => {
    expect(FRUSTRATION_REGEX.test("I'm so frustrated with this")).toBe(true);
  });
  it('does not match normal messages', () => {
    expect(FRUSTRATION_REGEX.test("Can you help me refactor this function?")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EXCITEMENT_REGEX
// ---------------------------------------------------------------------------

describe('EXCITEMENT_REGEX', () => {
  it('matches "nailed it"', () => {
    expect(EXCITEMENT_REGEX.test("we nailed it!")).toBe(true);
  });
  it('matches "it\'s working!"', () => {
    expect(EXCITEMENT_REGEX.test("it's working!")).toBe(true);
  });
  it('matches "finally!"', () => {
    expect(EXCITEMENT_REGEX.test("finally!")).toBe(true);
  });
  it('matches "shipped it"', () => {
    expect(EXCITEMENT_REGEX.test("shipped it to prod")).toBe(true);
  });
  it('does not match neutral messages', () => {
    expect(EXCITEMENT_REGEX.test("Can you look at this function?")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handlePromptSubmit integration
// ---------------------------------------------------------------------------

describe('handlePromptSubmit', () => {
  let statusPath: string;

  const baseStatus = {
    name: 'Pixel',
    species: 'Mushroom',
    level: 3,
    xp: 42,
    mood: 'happy',
  };

  beforeEach(() => {
    const dir = join(tmpdir(), 'buddy-prompt-test-' + Date.now());
    mkdirSync(dir, { recursive: true });
    statusPath = join(dir, 'buddy-status.json');
    writeFileSync(statusPath, JSON.stringify(baseStatus));
  });

  afterEach(() => {
    try { unlinkSync(statusPath); } catch { /* cleanup */ }
  });

  it('returns "name" and writes excited reaction when buddy name is mentioned', () => {
    const input: PromptInput = { prompt: "Hey Pixel, what do you think?" };
    const result = handlePromptSubmit(input, statusPath);
    expect(result).toBe('name');

    const status = JSON.parse(readFileSync(statusPath, 'utf-8'));
    expect(status.reaction).toBe('excited');
    expect(status.reaction_eye).toBe('^');
    expect(status.reaction_expires).toBeGreaterThan(Date.now());
  });

  it('name detection is case-insensitive', () => {
    const input: PromptInput = { prompt: "pixel, wake up!" };
    expect(handlePromptSubmit(input, statusPath)).toBe('name');
  });

  it('does not match name as substring of another word', () => {
    const input: PromptInput = { prompt: "I need to fix the pixelation issue" };
    // "Pixel" is embedded in "pixelation" — word boundary should prevent match
    // but "Pixelation" starts with "Pixel" — depends on word boundary position
    // This will match because \bPixel\b at the start of "pixelation" is not a boundary
    // Let's just verify it behaves consistently — no assertion on outcome needed
    // since the regex uses word boundaries (\b)
    const result = handlePromptSubmit(input, statusPath);
    // "pixelation" — \bPixel\b: 'P' is word char, preceding 'I' in "fix the " is space → \b before P
    // but after 'l' comes 'a' (word char) → no \b after 'l'. So \bPixel\b should NOT match.
    expect(result).toBe(false);
  });

  it('returns "frustration" on frustrated prompt', () => {
    const input: PromptInput = { prompt: "wtf is going on with this build" };
    const result = handlePromptSubmit(input, statusPath);
    expect(result).toBe('frustration');

    const status = JSON.parse(readFileSync(statusPath, 'utf-8'));
    expect(status.reaction).toBe('concerned');
    expect(status.reaction_eye).toBe('.');
  });

  it('returns "excitement" on excited prompt', () => {
    const input: PromptInput = { prompt: "we finally got it working!" };
    const result = handlePromptSubmit(input, statusPath);
    expect(result).toBe('excitement');

    const status = JSON.parse(readFileSync(statusPath, 'utf-8'));
    expect(status.reaction).toBe('happy');
  });

  it('name takes priority over frustration', () => {
    const input: PromptInput = { prompt: "Pixel wtf, this is still broken" };
    expect(handlePromptSubmit(input, statusPath)).toBe('name');
  });

  it('returns false for neutral prompt', () => {
    const input: PromptInput = { prompt: "Can you refactor this function?" };
    expect(handlePromptSubmit(input, statusPath)).toBe(false);
  });

  it('reads prompt from "message" field if "prompt" absent', () => {
    const input: PromptInput = { message: "wtf is happening" };
    expect(handlePromptSubmit(input, statusPath)).toBe('frustration');
  });

  it('reads prompt from "user_message" field as final fallback', () => {
    const input: PromptInput = { user_message: "we nailed it!" };
    expect(handlePromptSubmit(input, statusPath)).toBe('excitement');
  });

  it('does NOT overwrite active reaction', () => {
    const status = JSON.parse(readFileSync(statusPath, 'utf-8'));
    status.reaction = 'excited';
    status.reaction_text = 'existing!';
    status.reaction_expires = Date.now() + 30_000;
    writeFileSync(statusPath, JSON.stringify(status));

    const input: PromptInput = { prompt: "wtf broken again" };
    handlePromptSubmit(input, statusPath);

    const updated = JSON.parse(readFileSync(statusPath, 'utf-8'));
    expect(updated.reaction_text).toBe('existing!');
  });

  it('handles missing status file gracefully', () => {
    const input: PromptInput = { prompt: "wtf" };
    expect(() => handlePromptSubmit(input, '/tmp/nonexistent-buddy-prompt-test.json')).not.toThrow();
  });

  it('returns false for empty prompt', () => {
    expect(handlePromptSubmit({ prompt: '' }, statusPath)).toBe(false);
    expect(handlePromptSubmit({}, statusPath)).toBe(false);
  });
});
