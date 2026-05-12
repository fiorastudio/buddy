import { describe, it, expect } from 'vitest';
import { deriveSessionId } from '../../lib/reasoning/session.js';
import { resolveSessionTrace } from '../../lib/reasoning/session-trace.js';

describe('resolveSessionTrace', () => {
  it('parses session id shape even when no metadata file is found', () => {
    const trace = resolveSessionTrace('0123456789abcdef-20260512');
    expect(trace.sessionId).toBe('0123456789abcdef-20260512');
    expect(trace.cwdHash).toBe('0123456789abcdef');
    expect(trace.dateBucket).toBe('20260512');
  });

  it('can resolve the current buddy workspace via Codex metadata when present', () => {
    const sessionId = deriveSessionId('/Users/steven.wu/Documents/buddy', Date.UTC(2026, 4, 12, 12, 0, 0));
    const trace = resolveSessionTrace(sessionId);
    expect(trace.cwdHash).toHaveLength(16);
    if (trace.source === 'codex') {
      expect(trace.cwd).toBe('/Users/steven.wu/Documents/buddy');
      expect(trace.codexSessionFile).toContain('.codex/sessions');
    }
  });
});
