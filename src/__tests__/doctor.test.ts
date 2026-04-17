import { describe, it, expect } from 'vitest';
import { runDiagnostics, formatReport, PROMPT_SENTINEL_V2 } from '../lib/doctor.js';

describe('Doctor — runDiagnostics', () => {
  it('returns an array of checks', () => {
    const checks = runDiagnostics();
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBe(15);
  });

  it('every check has required fields', () => {
    const checks = runDiagnostics();
    for (const c of checks) {
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('status');
      expect(c).toHaveProperty('label');
      expect(c).toHaveProperty('detail');
      expect(['ok', 'warn', 'fail', 'skip']).toContain(c.status);
    }
  });

  it('env.node check reports current node version', () => {
    const checks = runDiagnostics();
    const nodeCheck = checks.find(c => c.id === 'env.node');
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.detail).toContain(process.version);
  });

  it('env.platform reports current platform', () => {
    const checks = runDiagnostics();
    const platCheck = checks.find(c => c.id === 'env.platform');
    expect(platCheck).toBeDefined();
    expect(platCheck!.detail).toContain(process.platform);
  });

  it('pkg.version reports a version string', () => {
    const checks = runDiagnostics();
    const verCheck = checks.find(c => c.id === 'pkg.version');
    expect(verCheck).toBeDefined();
    expect(verCheck!.detail).toMatch(/@fiorastudio\/buddy v/);
  });

  it('db.exists check runs without throwing', () => {
    const checks = runDiagnostics();
    const dbCheck = checks.find(c => c.id === 'db.exists');
    expect(dbCheck).toBeDefined();
    // Test DB exists (vitest.config.ts sets BUDDY_DB_PATH to temp)
    expect(['ok', 'warn', 'fail']).toContain(dbCheck!.status);
  });

  it('db.tables check finds expected tables', () => {
    const checks = runDiagnostics();
    const tablesCheck = checks.find(c => c.id === 'db.tables');
    expect(tablesCheck).toBeDefined();
    expect(tablesCheck!.detail).toContain('companions');
    expect(tablesCheck!.detail).toContain('memories');
  });

  it('failed checks include suggestions', () => {
    const checks = runDiagnostics();
    for (const c of checks) {
      if (c.status === 'fail' || c.status === 'warn') {
        // Not all warns need suggestions (e.g. no companion is just informational)
        // but fails should always have one
        if (c.status === 'fail') {
          expect(c.suggestion).toBeDefined();
        }
      }
    }
  });
});

describe('Doctor — formatReport', () => {
  it('produces a string with section headers', () => {
    const checks = runDiagnostics();
    const report = formatReport(checks);
    expect(report).toContain('Buddy Doctor');
    expect(report).toContain('ENVIRONMENT');
    expect(report).toContain('COMPANION');
    expect(report).toContain('DATABASE');
    expect(report).toContain('STATUS FILE');
    expect(report).toContain('CLAUDE CODE INTEGRATION');
    expect(report).toContain('SUMMARY');
  });

  it('includes check count in header', () => {
    const checks = runDiagnostics();
    const report = formatReport(checks);
    expect(report).toContain('15 checks:');
  });

  it('includes ISO timestamp', () => {
    const checks = runDiagnostics();
    const report = formatReport(checks);
    // Should contain a date-like string
    expect(report).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('Doctor — sentinel constant', () => {
  it('exports the v2 sentinel string', () => {
    expect(PROMPT_SENTINEL_V2).toBe('buddy-companion v2');
  });
});

describe('Doctor — failure paths', () => {
  it('companion.active returns warn/skip when no companion exists in test DB', () => {
    // Test DB starts empty (unless prior tests created one)
    const checks = runDiagnostics();
    const active = checks.find(c => c.id === 'companion.active');
    expect(active).toBeDefined();
    // Either 'ok' (prior test created one) or 'warn' (empty DB)
    expect(['ok', 'warn']).toContain(active!.status);
  });

  it('companion.details returns skip when no companion exists', () => {
    const checks = runDiagnostics();
    const details = checks.find(c => c.id === 'companion.details');
    expect(details).toBeDefined();
    // Either 'ok' (has companion) or 'skip' (no companion)
    expect(['ok', 'skip']).toContain(details!.status);
  });

  it('status.file check handles missing file gracefully', () => {
    const checks = runDiagnostics();
    const status = checks.find(c => c.id === 'status.file');
    expect(status).toBeDefined();
    // In test env, status file likely doesn't exist
    expect(['ok', 'warn']).toContain(status!.status);
    if (status!.status === 'warn') {
      expect(status!.detail).toContain('not found');
    }
  });

  it('mcp.registered check handles missing config files gracefully', () => {
    const checks = runDiagnostics();
    const mcp = checks.find(c => c.id === 'mcp.registered');
    expect(mcp).toBeDefined();
    // Should not throw — either finds config or reports fail with suggestion
    expect(['ok', 'fail']).toContain(mcp!.status);
    if (mcp!.status === 'fail') {
      expect(mcp!.suggestion).toBeDefined();
      expect(mcp!.suggestion).toContain('claude mcp add');
    }
  });

  it('config.statusline check handles missing settings.json gracefully', () => {
    const checks = runDiagnostics();
    const sl = checks.find(c => c.id === 'config.statusline');
    expect(sl).toBeDefined();
    expect(['ok', 'warn', 'fail']).toContain(sl!.status);
  });

  it('config.statusline.refresh check exists and handles all states gracefully', () => {
    const checks = runDiagnostics();
    const refresh = checks.find(c => c.id === 'config.statusline.refresh');
    expect(refresh).toBeDefined();
    expect(['ok', 'warn', 'skip']).toContain(refresh!.status);
    if (refresh!.status === 'warn') {
      expect(refresh!.suggestion).toBeDefined();
      expect(refresh!.suggestion).toContain('refreshInterval');
    }
    if (refresh!.status === 'skip') {
      expect(refresh!.detail).toContain('not configured');
    }
  });

  it('config.hooks check handles missing hooks gracefully', () => {
    const checks = runDiagnostics();
    const hooks = checks.find(c => c.id === 'config.hooks');
    expect(hooks).toBeDefined();
    expect(['ok', 'warn']).toContain(hooks!.status);
  });

  it('prompt.injected check handles missing CLAUDE.md gracefully', () => {
    const checks = runDiagnostics();
    const prompt = checks.find(c => c.id === 'prompt.injected');
    expect(prompt).toBeDefined();
    expect(['ok', 'warn']).toContain(prompt!.status);
  });

  it('formatReport handles all-fail scenario without crashing', () => {
    const fakeChecks = [
      { id: 'test.fail1', status: 'fail' as const, label: 'Test 1', detail: 'broken', suggestion: 'fix it' },
      { id: 'test.fail2', status: 'fail' as const, label: 'Test 2', detail: 'also broken', suggestion: 'fix this too' },
      { id: 'test.warn1', status: 'warn' as const, label: 'Test 3', detail: 'iffy' },
      { id: 'test.ok1', status: 'ok' as const, label: 'Test 4', detail: 'fine' },
      { id: 'test.skip1', status: 'skip' as const, label: 'Test 5', detail: 'n/a' },
    ];
    const report = formatReport(fakeChecks);
    expect(report).toContain('2 fail');
    expect(report).toContain('1 warn');
    expect(report).toContain('1 ok');
    expect(report).toContain('1 skip');
    expect(report).toContain('fix it');
    expect(report).toContain('fix this too');
  });
});
