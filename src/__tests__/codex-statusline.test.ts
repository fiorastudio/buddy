import { describe, expect, it } from 'vitest';
import { renderCodexStatusline, type CodexBuddyStatus } from '../lib/codex-statusline.js';

const baseStatus: CodexBuddyStatus = {
  name: 'Rustbot',
  species: 'Goose',
  level: 3,
  xp: 42,
  mood: 'happy',
  rarity: 'rare',
};

describe('renderCodexStatusline', () => {
  it('renders two footer-safe lines', () => {
    const lines = renderCodexStatusline(baseStatus, 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Rustbot');
    expect(lines[0]).toContain('Goose');
    expect(lines[1]).toContain('happy');
    expect(lines[1]).toContain('XP:42');
  });

  it('shows active reaction text when present', () => {
    const lines = renderCodexStatusline({
      ...baseStatus,
      reaction_indicator: '♥',
      reaction_text: '*tolerates petting with dignity*',
      reaction_expires: 10_000,
    }, 5_000);
    expect(lines[0]).toContain('Rustbot');
    expect(lines[1]).toContain('♥');
    expect(lines[1]).toContain('tolerates petting');
  });

  it('falls back to XP progress when reaction is expired', () => {
    const lines = renderCodexStatusline({
      ...baseStatus,
      reaction_text: 'old reaction',
      reaction_expires: 10,
    }, 20);
    expect(lines[1]).toContain('XP:42');
    expect(lines[1]).not.toContain('old reaction');
  });
});
