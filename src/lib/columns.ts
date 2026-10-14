// src/lib/columns.ts — side-by-side layout for the statusline's blocks

import { RESET, stripAnsi } from "./ansi.js";

/** Drop the run of spaces that only ANSI codes follow, so padding is not doubled. */
const trimCell = (cell: string): string => cell.replace(/[ \t]+(?=(?:\x1b\[[0-9;]*m)*$)/, "");

const visibleLength = (cell: string): number => stripAnsi(cell).length;

/**
 * Lay blocks out side by side, padding each column so the next one starts at a
 * fixed offset.
 *
 * A column is only widened by the rows where something is actually printed to
 * its right. Rows that trail past every other column — the name and mood lines
 * under a speech bubble, say — stand alone, so letting them set the column
 * width would shove the shorter rows far to the right and push the rightmost
 * block off a narrow terminal.
 */
export function joinColumns(columns: string[][], gutter: number): string[] {
  const height = Math.max(0, ...columns.map((col) => col.length));
  if (height === 0) return [];

  const hasContentRight = (row: number, col: number): boolean =>
    columns.slice(col + 1).some((other) => (stripAnsi(other[row] || "")).trim() !== "");

  const widths = columns.map((col, index) =>
    Math.max(0, ...col.map((cell, row) => (hasContentRight(row, index) ? visibleLength(trimCell(cell)) : 0))),
  );

  const rows: string[] = [];
  for (let row = 0; row < height; row++) {
    let line = "";
    for (let col = 0; col < columns.length; col++) {
      const cell = trimCell(columns[col][row] || "");
      line += cell;
      if (col < columns.length - 1) {
        line += " ".repeat(Math.max(0, widths[col] + gutter - visibleLength(cell)));
      }
    }
    // A row whose left columns are all empty — the usage panel running past the
    // bottom of the buddy, say — is nothing but padding up to its first visible
    // character. Claude Code re-indents each statusline row as
    // `indent + row.trimStart()`, which swallows that padding whole and drops
    // the row back to column zero. Every other row survives because its own
    // padding ends at a colour escape the trim stops on, so give these rows the
    // same shape: leave the gutter bare for the host to reclaim, then a reset,
    // then the rest of the padding. Output is visually identical either way.
    const laidOut = line.trimEnd();
    const indent = laidOut.length - laidOut.trimStart().length;
    rows.push(indent > gutter ? laidOut.slice(0, gutter) + RESET + laidOut.slice(gutter) : laidOut);
  }
  return rows;
}
