import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainModule } from '../lib/is-main.js';

describe('isMainModule', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  function setup() {
    dir = mkdtempSync(join(tmpdir(), 'is-main-'));
    const real = join(dir, 'real');
    mkdirSync(real);
    const file = join(real, 'world-cli.js');
    writeFileSync(file, '');
    return { real, file, url: pathToFileURL(file).href };
  }

  it('is true when argv[1] is the module file', () => {
    const { file, url } = setup();
    expect(isMainModule(url, file)).toBe(true);
  });

  it('is true when argv[1] reaches the module through a linked directory (npm bin / installer link)', () => {
    const { real, url } = setup();
    const link = join(dir, 'bin');
    // 'junction' needs no admin rights on Windows; ignored on POSIX.
    symlinkSync(real, link, 'junction');
    expect(isMainModule(url, join(link, 'world-cli.js'))).toBe(true);
  });

  it('is false for a different entrypoint, such as the test runner', () => {
    const { real, url } = setup();
    const other = join(real, 'vitest.mjs');
    writeFileSync(other, '');
    expect(isMainModule(url, other)).toBe(false);
  });

  it('is false when argv[1] is missing or does not exist', () => {
    const { url } = setup();
    expect(isMainModule(url, undefined)).toBe(false);
    expect(isMainModule(url, join(dir, 'nope.js'))).toBe(false);
  });
});
