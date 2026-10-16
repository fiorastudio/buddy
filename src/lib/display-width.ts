// src/lib/display-width.ts — terminal column width of a string.
//
// `String.prototype.length` / `padEnd` count UTF-16 code units, which is not
// what a terminal draws: emoji + VS16 (🛡️ = U+1F6E1 U+FE0F) is 3 units but 2
// columns, CJK ideographs are 1 unit but 2 columns, combining marks are 1 unit
// but 0 columns. Padding by .length leaves a boxed line's right border ragged.

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const MARK_OR_CONTROL = /^[\p{M}\p{Cc}\p{Cf}]+$/u;

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function clusterWidth(cluster: string): number {
  if (MARK_OR_CONTROL.test(cluster)) return 0;
  // Emoji (incl. flags, ZWJ sequences, and text-default symbols forced to emoji
  // presentation with VS16) occupy two columns as one unit.
  if (EMOJI_PRESENTATION.test(cluster) || (PICTOGRAPHIC.test(cluster) && cluster.includes('️'))) {
    return 2;
  }
  return isWide(cluster.codePointAt(0)!) ? 2 : 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  if (segmenter) {
    for (const { segment } of segmenter.segment(text)) width += clusterWidth(segment);
  } else {
    for (const ch of text) width += clusterWidth(ch);
  }
  return width;
}

/** Right-pad with spaces to `width` terminal columns (never truncates). */
export function padEndWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

/**
 * Cut `text` to at most `width` columns, ending in an ellipsis if it was cut.
 * Whole grapheme clusters only, so an emoji is never split.
 */
export function truncateToWidth(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  const parts = segmenter ? Array.from(segmenter.segment(text), s => s.segment) : Array.from(text);
  let out = '';
  let used = 0;
  for (const part of parts) {
    const w = clusterWidth(part);
    if (used + w > width - 1) break;
    out += part;
    used += w;
  }
  return out + '…';
}
