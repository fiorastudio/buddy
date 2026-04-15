import { describe, it, expect } from 'vitest';
import { runDiagnostics, formatReport, PROMPT_SENTINEL_V2 } from '../lib/doctor.js';

describe('Doctor — runDiagnostics', () => {
  it('returns an array of checks', () => {
    const checks = runDiagnostics();
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBe(14);
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
    expect(report).toContain('14 checks:');
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
