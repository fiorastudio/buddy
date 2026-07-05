import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_LINES } from '../lib/jobclass.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('world/public/jobs.json drift guard', () => {
  it('matches JOB_LINES exactly (regenerate via build script if this fails)', () => {
    const onDisk = JSON.parse(readFileSync(join(repoRoot, 'world', 'public', 'jobs.json'), 'utf8'));
    expect(onDisk).toEqual(JOB_LINES);
  });
});
