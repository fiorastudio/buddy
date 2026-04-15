// src/lib/bubble.ts

/**
 * Renders a speech bubble next to buddy art.
 * Bubble on left, art on right, with dash connector.
 */

function wrapText(text: string, width: number): string[] {
  // Split on explicit newlines first, then word-wrap each paragraph
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (para.trim() === '') {
      lines.push(''); // preserve empty lines for spacing
      continue;
    }
    const words = para.split(' ');
    let cur = '';
    for (const w of words) {
      if (cur.length + w.length + 1 > width && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = cur ? `${cur} ${w}` : w;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

export function renderSpeechBubble(
  text: string,
  artLines: string[],
  buddyName: string,
  bubbleWidth = 30,
): string {
  const innerWidth = bubbleWidth - 4; // account for "| " and " |"
  const wrapped = wrapText(text, innerWidth);

  // Build bubble lines
  const topBorder = '.' + '_'.repeat(bubbleWidth - 2) + '.';
  const bottomBorder = "'" + '_'.repeat(bubbleWidth - 2) + "'";

  const bubbleLines: string[] = [topBorder];
  for (const line of wrapped) {
    bubbleLines.push('| ' + line.padEnd(bubbleWidth - 4) + ' |');
  }
  bubbleLines.push(bottomBorder);

  // Merge bubble (left) with art (right)
  // Art connects at the vertical middle of the bubble
  const artStart = Math.max(0, Math.floor(bubbleLines.length / 2) - Math.floor(artLines.length / 2));
  const totalLines = Math.max(bubbleLines.length, artStart + artLines.length + 1); // +1 for name

  const output: string[] = [];
  const gutter = '  ';
  const connector = '  -  ';

  for (let i = 0; i < totalLines; i++) {
    const bubblePart = i < bubbleLines.length
      ? bubbleLines[i].padEnd(bubbleWidth)
      : ' '.repeat(bubbleWidth);

    const artIdx = i - artStart;
    if (artIdx >= 0 && artIdx < artLines.length) {
      // Art line — use connector on first art line, gutter on rest
      const sep = artIdx === 0 ? connector : gutter + '  ';
      output.push(bubblePart + sep + artLines[artIdx]);
    } else if (artIdx === artLines.length) {
      // Name line — below art
      output.push(bubblePart + gutter + '  ' + '  ' + buddyName);
    } else {
      output.push(bubblePart);
    }
  }

  return output.join('\n');
}
