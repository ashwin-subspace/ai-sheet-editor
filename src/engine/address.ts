import { COL_COUNT, ROW_COUNT, type CellPos } from "./types";

export function colToIndex(letters: string): number {
  let n = 0;
  for (const char of letters.toUpperCase()) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) return 0;
    n = n * 26 + (code - 64);
  }
  return n;
}

export function indexToCol(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Parses A1 or AA10 without applying the sheet cap. */
export function parseAddressLoose(input: string): CellPos | null {
  const match = /^([A-Za-z]{1,3})([1-9][0-9]*)$/.exec(input.trim());
  if (!match) return null;
  const col = colToIndex(match[1]);
  const row = Number(match[2]);
  if (col < 1 || row < 1) return null;
  return { col, row };
}

export function inBounds(pos: CellPos): boolean {
  return pos.col >= 1 && pos.col <= COL_COUNT && pos.row >= 1 && pos.row <= ROW_COUNT;
}

export function formatAddress(col: number, row: number): string {
  return `${indexToCol(col)}${row}`;
}

export function parseAddress(input: string): CellPos | null {
  const pos = parseAddressLoose(input);
  if (!pos || !inBounds(pos)) return null;
  return pos;
}

export interface NormRange {
  c1: number;
  r1: number;
  c2: number;
  r2: number;
}

export function parseRangeLoose(input: string): NormRange | null {
  const text = input.trim();
  const parts = text.split(":");
  if (parts.length === 1) {
    const pos = parseAddressLoose(parts[0]);
    if (!pos) return null;
    return { c1: pos.col, r1: pos.row, c2: pos.col, r2: pos.row };
  }
  if (parts.length !== 2) return null;
  const a = parseAddressLoose(parts[0]);
  const b = parseAddressLoose(parts[1]);
  if (!a || !b) return null;
  return {
    c1: Math.min(a.col, b.col),
    r1: Math.min(a.row, b.row),
    c2: Math.max(a.col, b.col),
    r2: Math.max(a.row, b.row),
  };
}

export function parseRange(input: string): NormRange | null {
  const range = parseRangeLoose(input);
  if (!range) return null;
  if (
    !inBounds({ col: range.c1, row: range.r1 }) ||
    !inBounds({ col: range.c2, row: range.r2 })
  ) {
    return null;
  }
  return range;
}

export function formatRange(range: NormRange): string {
  const start = formatAddress(range.c1, range.r1);
  const end = formatAddress(range.c2, range.r2);
  return start === end ? start : `${start}:${end}`;
}

export function cellsInRange(range: NormRange): string[] {
  const out: string[] = [];
  for (let row = range.r1; row <= range.r2; row += 1) {
    for (let col = range.c1; col <= range.c2; col += 1) {
      out.push(formatAddress(col, row));
    }
  }
  return out;
}

export function normalizeSelection(anchor: string, end: string): NormRange | null {
  const a = parseAddress(anchor);
  const b = parseAddress(end);
  if (!a || !b) return null;
  return {
    c1: Math.min(a.col, b.col),
    r1: Math.min(a.row, b.row),
    c2: Math.max(a.col, b.col),
    r2: Math.max(a.row, b.row),
  };
}

export function addressInRange(address: string, range: NormRange): boolean {
  const pos = parseAddress(address);
  if (!pos) return false;
  return pos.col >= range.c1 && pos.col <= range.c2 && pos.row >= range.r1 && pos.row <= range.r2;
}
