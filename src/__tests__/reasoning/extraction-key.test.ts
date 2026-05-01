import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveExtractionKey, resolveExtractionModel } from '../../lib/reasoning/extraction-key.js';

describe('resolveExtractionKey', () => {
  const originalEnv = { ...process.env };
  let tmpHome: string;
  let tmpProject: string;

  beforeEach(() => {
    delete process.env.BUDDY_EXTRACTION_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_PROJECT_DIR;

    tmpHome = mkdtempSync(join(tmpdir(), 'buddy-key-home-'));
    tmpProject = mkdtempSync(join(tmpdir(), 'buddy-key-proj-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.buddy'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpProject, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  it('returns null when nothing is set', async () => {
    
    
    const out = resolveExtractionKey();
    expect(out.key).toBeNull();
    expect(out.source).toBeNull();
  });

  it('prefers BUDDY_EXTRACTION_KEY over everything', async () => {
    process.env.BUDDY_EXTRACTION_KEY = 'sk-buddy';
    process.env.ANTHROPIC_API_KEY = 'sk-anthropic';
    writeFileSync(join(tmpHome, '.buddy', 'config.json'), JSON.stringify({ extraction: { api_key: 'sk-config' } }));
    
    
    const out = resolveExtractionKey();
    expect(out.key).toBe('sk-buddy');
    expect(out.source).toBe('env_buddy');
  });

  it('falls back to ANTHROPIC_API_KEY when BUDDY_EXTRACTION_KEY is absent', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-anthropic';
    
    
    const out = resolveExtractionKey();
    expect(out.key).toBe('sk-anthropic');
    expect(out.source).toBe('env_anthropic');
  });

  it('reads ~/.buddy/config.json when env vars are absent', async () => {
    writeFileSync(join(tmpHome, '.buddy', 'config.json'), JSON.stringify({ extraction: { api_key: 'sk-config' } }));
    const out = resolveExtractionKey();
    expect(out.key).toBe('sk-config');
    expect(out.source).toBe('config_file');
  });

  it('reads <CLAUDE_PROJECT_DIR>/.env as final fallback', async () => {
    process.env.CLAUDE_PROJECT_DIR = tmpProject;
    writeFileSync(join(tmpProject, '.env'), 'ANTHROPIC_API_KEY=sk-dotenv\nOTHER=ignored\n');
    
    
    const out = resolveExtractionKey();
    expect(out.key).toBe('sk-dotenv');
    expect(out.source).toBe('project_dotenv');
  });

  it('strips quotes from .env values', async () => {
    process.env.CLAUDE_PROJECT_DIR = tmpProject;
    writeFileSync(join(tmpProject, '.env'), 'ANTHROPIC_API_KEY="sk-quoted"\n');
    
    
    const out = resolveExtractionKey();
    expect(out.key).toBe('sk-quoted');
  });

  it('ignores .env comments and unrelated keys', async () => {
    process.env.CLAUDE_PROJECT_DIR = tmpProject;
    writeFileSync(join(tmpProject, '.env'), '# ANTHROPIC_API_KEY=sk-commented\nDATABASE_URL=postgres://...\n');
    
    
    const out = resolveExtractionKey();
    expect(out.key).toBeNull();
  });

  it('treats empty strings as absent', async () => {
    process.env.BUDDY_EXTRACTION_KEY = '';
    process.env.ANTHROPIC_API_KEY = '   ';
    
    
    const out = resolveExtractionKey();
    expect(out.key).toBeNull();
  });

  it('survives malformed config.json silently', async () => {
    writeFileSync(join(tmpHome, '.buddy', 'config.json'), '{ not json');


    const out = resolveExtractionKey();
    expect(out.key).toBeNull();
  });
});

describe('resolveExtractionModel', () => {
  const originalEnv = { ...process.env };
  let tmpHome: string;

  beforeEach(() => {
    delete process.env.BUDDY_EXTRACTION_MODEL;
    tmpHome = mkdtempSync(join(tmpdir(), 'buddy-model-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.buddy'), { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  it('returns null when nothing is set (caller falls back to SDK default)', () => {
    expect(resolveExtractionModel()).toBeNull();
  });

  it('prefers BUDDY_EXTRACTION_MODEL env over config', () => {
    process.env.BUDDY_EXTRACTION_MODEL = 'claude-sonnet-4-6';
    writeFileSync(join(tmpHome, '.buddy', 'config.json'), JSON.stringify({ extraction: { model: 'claude-haiku-4-5' } }));
    expect(resolveExtractionModel()).toBe('claude-sonnet-4-6');
  });

  it('falls back to ~/.buddy/config.json extraction.model', () => {
    writeFileSync(join(tmpHome, '.buddy', 'config.json'), JSON.stringify({ extraction: { model: 'claude-opus-4-7' } }));
    expect(resolveExtractionModel()).toBe('claude-opus-4-7');
  });

  it('treats empty/whitespace strings as absent', () => {
    process.env.BUDDY_EXTRACTION_MODEL = '   ';
    writeFileSync(join(tmpHome, '.buddy', 'config.json'), JSON.stringify({ extraction: { model: '' } }));
    expect(resolveExtractionModel()).toBeNull();
  });
});
