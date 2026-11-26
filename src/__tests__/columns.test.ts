import { describe, it, expect } from 'vitest';
import { joinColumns } from '../lib/columns.js';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('joinColumns', () => {
  it('places the next column at the widest row plus the gutter', () => {
    expect(joinColumns([['ab', 'cdef'], ['1', '2']], 3)).toEqual([
      'ab     1',
      'cdef   2',
    ]);
  });

  it('starts every row of a column at the same offset', () => {
    const rows = joinColumns([['a', 'bbbb'], ['x', 'y']], 2);
    expect(rows[0].indexOf('x')).toBe(rows[1].indexOf('y'));
  });

  it('ignores ANSI codes when measuring width', () => {
    const rows = joinColumns([[`${DIM}ab${RESET}`], ['x']], 3);
    expect(strip(rows[0])).toBe('ab   x');
  });

  it('does not let rows that trail past every other column set the width', () => {
    // The buddy's name and mood lines sit below the usage panel; letting them
    // widen the column would shove the panel off a narrow terminal.
    const buddy = ['sprite', 'sprite', 'a very long trailing mood line'];
    const rows = joinColumns([buddy, ['ctx', '5h']], 3);
    expect(rows[0]).toBe('sprite   ctx');
    expect(rows[1]).toBe('sprite   5h');
    expect(rows[2]).toBe('a very long trailing mood line');
  });

  it('strips trailing padding inside a cell instead of stacking it on the gutter', () => {
    const rows = joinColumns([[`bubble${' '.repeat(8)}${RESET}`], ['ctx']], 3);
    expect(strip(rows[0])).toBe('bubble   ctx');
  });

  it('collapses an empty column to its gutter', () => {
    // Buddy has always been indented by the gutter when no HUD is installed;
    // keep that placement rather than snapping it to column zero.
    expect(joinColumns([[], ['solo', 'lines'], []], 3)).toEqual(['   solo', '   lines']);
  });

  it('keeps a single column untouched', () => {
    expect(joinColumns([['just', 'me']], 3)).toEqual(['just', 'me']);
  });

  it('returns nothing when every column is empty', () => {
    expect(joinColumns([[], []], 3)).toEqual([]);
  });

  it('shields a padding-only row from a host that re-indents on trimStart', () => {
    // The usage panel outliving the buddy block leaves rows that are pure
    // padding up to their first visible character.
    const rows = joinColumns([[], ['art', 'art'], ['one', 'two', 'three']], 3);
    expect(rows[2].startsWith(`   ${RESET}`)).toBe(true);
    expect(strip(rows[2]).indexOf('three')).toBe(strip(rows[1]).indexOf('two'));

    // Only the bare gutter is exposed to the trim, so re-indenting the row by
    // that same gutter reproduces the original layout.
    const reindent = (row: string) => '   ' + row.trimStart();
    expect(strip(reindent(rows[2])).indexOf('three')).toBe(strip(reindent(rows[1])).indexOf('two'));

    // Rows that only carry the gutter keep their plain indentation.
    expect(rows[0].startsWith(RESET)).toBe(false);
  });

  it('never leaves trailing whitespace on a rendered row', () => {
    for (const row of joinColumns([['a', 'bb'], ['x', '']], 3)) {
      expect(row).toBe(row.trimEnd());
    }
  });
});
