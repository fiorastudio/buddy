// The npm package leaves out worker-only modules (package.json `files`
// negations). Guard that nothing that DOES ship imports one of them at
// runtime — that would only show up as a crash after publishing.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const SRC = join(ROOT, 'src');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { files: string[] };

// `!dist/lib/world/x.js` → src/lib/world/x.ts
const excluded = pkg.files
  .filter((f) => /^!dist\/lib\/world\/[\w-]+\.js$/.test(f))
  .map((f) => join(SRC, f.slice('!dist/'.length).replace(/\.js$/, '.ts')));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []
  );
}

// Every source file that compiles into the package.
const shipped = walk(SRC).filter((f) => {
  const rel = relative(SRC, f).split(sep).join('/');
  return !rel.startsWith('__tests__/') && !rel.startsWith('world/') && !rel.endsWith('.test.ts') && !excluded.includes(f);
});

// Relative imports that survive compilation. Conservative: `import type` and
// `export type` are skipped, anything else counts.
function runtimeImports(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const specs: string[] = [];
  const patterns = [
    /^\s*import\s+(?!type\s)[^'"]*?from\s*['"](\.[^'"]+)['"]/gm,
    /^\s*export\s+(?!type\s)[^'"]*?from\s*['"](\.[^'"]+)['"]/gm,
    /^\s*import\s*['"](\.[^'"]+)['"]/gm,
    /import\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) specs.push(m[1]);
  return specs.map((s) => join(dirname(file), s.replace(/\.js$/, '.ts')));
}

describe('npm package files', () => {
  it('excludes worker-only dist/lib/world modules that exist in src', () => {
    expect(excluded.length).toBeGreaterThan(0);
    for (const f of excluded) expect(existsSync(f), f).toBe(true);
    // The client side's own modules must keep shipping.
    for (const keep of ['client', 'schema-sql', 'towns']) {
      expect(pkg.files).not.toContain(`!dist/lib/world/${keep}.js`);
    }
  });

  it('no shipped module imports an excluded one at runtime', () => {
    const offenders: string[] = [];
    for (const f of shipped) {
      for (const dep of runtimeImports(f)) {
        if (excluded.includes(dep)) offenders.push(`${relative(ROOT, f)} → ${relative(ROOT, dep)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
