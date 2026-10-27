import { formatAddress, parseAddressLoose } from "./address";
import { ALLOWED_FUNCTIONS, COL_COUNT, ROW_COUNT, type CellPos, type CellRuntime, type Workbook } from "./types";

const FUNCTIONS = new Set<string>(ALLOWED_FUNCTIONS);

export interface CellRef {
  col: number;
  row: number;
  absCol: boolean;
  absRow: boolean;
}

type Expr =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "ref"; ref: CellRef }
  | { kind: "range"; start: CellRef; end: CellRef }
  | { kind: "neg"; expr: Expr }
  | { kind: "bin"; op: string; left: Expr; right: Expr }
  | { kind: "call"; name: string; args: Expr[] };

export type FormulaCheck =
  | { ok: true }
  | { ok: false; kind: "syntax" | "unsupported" | "sheet" | "bounds"; error: string; functionName?: string };

class Parser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): Expr {
    this.skip();
    if (this.peek() !== "=") throw new SyntaxError("formula must start with =");
    this.index += 1;
    const expr = this.parseComparison();
    this.skip();
    if (this.index < this.source.length) throw new SyntaxError("formula cannot be read");
    return expr;
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();
    while (true) {
      this.skip();
      const op = this.matchComparison();
      if (!op) break;
      const right = this.parseAdditive();
      left = { kind: "bin", op, left, right };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (true) {
      this.skip();
      if (this.peek() !== "+" && this.peek() !== "-") break;
      const op = this.source[this.index];
      this.index += 1;
      const right = this.parseMultiplicative();
      left = { kind: "bin", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (true) {
      this.skip();
      if (this.peek() !== "*" && this.peek() !== "/") break;
      const op = this.source[this.index];
      this.index += 1;
      const right = this.parseUnary();
      left = { kind: "bin", op, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    this.skip();
    if (this.peek() === "+") {
      this.index += 1;
      return this.parseUnary();
    }
    if (this.peek() === "-") {
      this.index += 1;
      return { kind: "neg", expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    this.skip();
    const char = this.peek();
    if (char === "(") {
      this.index += 1;
      const inner = this.parseComparison();
      this.skip();
      if (this.peek() !== ")") throw new SyntaxError("formula cannot be read");
      this.index += 1;
      return inner;
    }
    if (char === '"') return { kind: "str", value: this.parseString() };
    if (this.isDigit(char) || (char === "." && this.isDigit(this.source[this.index + 1] ?? ""))) {
      return { kind: "num", value: this.parseNumber() };
    }
    const ident = this.parseIdent();
    if (!ident) throw new SyntaxError("formula cannot be read");
    this.skip();
    if (this.peek() === "(") {
      return { kind: "call", name: ident.toUpperCase(), args: this.parseArgs() };
    }
    if (ident.toUpperCase() === "TRUE") return { kind: "bool", value: true };
    if (ident.toUpperCase() === "FALSE") return { kind: "bool", value: false };
    const ref = identToRef(ident);
    if (!ref) throw new SyntaxError("formula cannot be read");
    this.skip();
    if (this.peek() === ":") {
      this.index += 1;
      this.skip();
      const endIdent = this.parseIdent();
      const end = endIdent ? identToRef(endIdent) : null;
      if (!end) throw new SyntaxError("formula cannot be read");
      return { kind: "range", start: ref, end };
    }
    return { kind: "ref", ref };
  }

  private parseArgs(): Expr[] {
    if (this.peek() !== "(") throw new SyntaxError("formula cannot be read");
    this.index += 1;
    const args: Expr[] = [];
    this.skip();
    if (this.peek() === ")") {
      this.index += 1;
      return args;
    }
    while (true) {
      args.push(this.parseComparison());
      this.skip();
      if (this.peek() === ",") {
        this.index += 1;
        continue;
      }
      if (this.peek() === ")") {
        this.index += 1;
        return args;
      }
      throw new SyntaxError("formula cannot be read");
    }
  }

  private parseString(): string {
    this.index += 1;
    let out = "";
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === '"') {
        if (this.source[this.index + 1] === '"') {
          out += '"';
          this.index += 2;
          continue;
        }
        this.index += 1;
        return out;
      }
      out += char;
      this.index += 1;
    }
    throw new SyntaxError("formula cannot be read");
  }

  private parseNumber(): number {
    const start = this.index;
    while (this.isDigit(this.peek())) this.index += 1;
    if (this.peek() === ".") {
      this.index += 1;
      while (this.isDigit(this.peek())) this.index += 1;
    }
    const value = Number(this.source.slice(start, this.index));
    if (!Number.isFinite(value)) throw new SyntaxError("formula cannot be read");
    return value;
  }

  private parseIdent(): string {
    const start = this.index;
    if (this.peek() === "$") this.index += 1;
    const letters = this.index;
    while (/[A-Za-z]/.test(this.peek())) this.index += 1;
    if (this.index === letters && this.source[start] !== "$") {
      this.index = start;
      return "";
    }
    if (this.peek() === "$") this.index += 1;
    while (this.isDigit(this.peek())) this.index += 1;
    return this.source.slice(start, this.index);
  }

  private matchComparison(): string | null {
    const two = this.source.slice(this.index, this.index + 2);
    if (two === ">=" || two === "<=" || two === "<>") {
      this.index += 2;
      return two;
    }
    const one = this.peek();
    if (one === ">" || one === "<" || one === "=") {
      this.index += 1;
      return one;
    }
    return null;
  }

  private skip(): void {
    while (this.peek() === " " || this.peek() === "\t") this.index += 1;
  }

  private peek(): string {
    return this.source[this.index] ?? "";
  }

  private isDigit(char: string): boolean {
    return char >= "0" && char <= "9";
  }
}

function identToRef(ident: string): CellRef | null {
  const match = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)$/.exec(ident);
  if (!match) return null;
  const pos = parseAddressLoose(`${match[2]}${match[4]}`);
  if (!pos) return null;
  return { col: pos.col, row: pos.row, absCol: match[1] === "$", absRow: match[3] === "$" };
}

function refOutOfBounds(ref: CellRef): boolean {
  return ref.col < 1 || ref.col > COL_COUNT || ref.row < 1 || ref.row > ROW_COUNT;
}

function walk(expr: Expr, visit: (expr: Expr) => void): void {
  visit(expr);
  if (expr.kind === "neg") walk(expr.expr, visit);
  if (expr.kind === "bin") {
    walk(expr.left, visit);
    walk(expr.right, visit);
  }
  if (expr.kind === "call") expr.args.forEach((arg) => walk(arg, visit));
}

export function checkFormula(formula: string): FormulaCheck {
  const text = formula.trim();
  if (!text.startsWith("=")) return { ok: false, kind: "syntax", error: "formula must start with =" };
  if (text.includes("!")) {
    return { ok: false, kind: "sheet", error: "refers to another sheet" };
  }
  let ast: Expr;
  try {
    ast = new Parser(text).parse();
  } catch {
    return { ok: false, kind: "syntax", error: "formula cannot be read" };
  }
  let unsupported: string | undefined;
  let bounds = false;
  walk(ast, (expr) => {
    if (expr.kind === "call" && !FUNCTIONS.has(expr.name)) unsupported = expr.name;
    if (expr.kind === "ref" && refOutOfBounds(expr.ref)) bounds = true;
    if (expr.kind === "range" && (refOutOfBounds(expr.start) || refOutOfBounds(expr.end))) bounds = true;
    if (expr.kind === "call" && expr.name === "IF" && expr.args.length !== 3) {
      unsupported = unsupported ?? "";
    }
  });
  if (unsupported) {
    if (unsupported === "") {
      return { ok: false, kind: "syntax", error: "IF needs 3 arguments" };
    }
    return {
      ok: false,
      kind: "unsupported",
      functionName: unsupported,
      error: `uses ${unsupported}, which is not allowed. Allowed functions: SUM, AVERAGE, COUNT, IF.`,
    };
  }
  const badCall = findBadCall(ast);
  if (badCall) return { ok: false, kind: "syntax", error: badCall };
  if (bounds) return { ok: false, kind: "bounds", error: "refers to a cell outside the sheet" };
  return { ok: true };
}

function findBadCall(expr: Expr): string | null {
  if (expr.kind === "call") {
    if ((expr.name === "SUM" || expr.name === "AVERAGE" || expr.name === "COUNT") && expr.args.length < 1) {
      return `${expr.name} needs at least 1 argument`;
    }
    for (const arg of expr.args) {
      const inner = findBadCall(arg);
      if (inner) return inner;
    }
  }
  if (expr.kind === "neg") return findBadCall(expr.expr);
  if (expr.kind === "bin") return findBadCall(expr.left) ?? findBadCall(expr.right);
  return null;
}

export interface ShiftResult {
  formula: string;
  overflow: boolean;
}

function refText(ref: CellRef): string {
  const letters = formatAddress(ref.col, ref.row).replace(/\d+$/, "");
  return `${ref.absCol ? "$" : ""}${letters}${ref.absRow ? "$" : ""}${ref.row}`;
}

/**
 * Shifts A1-style references. An inserted row or column expands a range when
 * only the end point moves, which matches the usual spreadsheet rule.
 * Text inside quotes is left alone. Absolute markers are kept, but inserts
 * still move them, same as Excel.
 */
export function shiftFormula(formula: string, shift: (ref: CellRef) => CellRef | null): ShiftResult {
  let out = "";
  let i = 0;
  let overflow = false;
  while (i < formula.length) {
    const char = formula[i];
    if (char === '"') {
      const start = i;
      i += 1;
      while (i < formula.length) {
        if (formula[i] === '"' && formula[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (formula[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      out += formula.slice(start, i);
      continue;
    }
    const match = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)/.exec(formula.slice(i));
    if (match && (i === 0 || !/[A-Za-z0-9_]/.test(formula[i - 1] ?? ""))) {
      const ref = identToRef(match[0]);
      if (ref) {
        const next = shift(ref);
        if (!next) overflow = true;
        out += next ? refText(next) : match[0];
        i += match[0].length;
        continue;
      }
    }
    out += char;
    i += 1;
  }
  return { formula: out, overflow };
}

export type EvalCache = Map<string, CellRuntime | "working">;

export function evaluationCache(): EvalCache {
  return new Map();
}

export function evaluateCell(workbook: Workbook, address: string, cache?: EvalCache): CellRuntime {
  const store = cache ?? evaluationCache();
  return readCell(workbook, address.toUpperCase(), store);
}

function readCell(workbook: Workbook, address: string, cache: EvalCache): CellRuntime {
  const known = cache.get(address);
  if (known === "working") return { kind: "err", value: "#CYCLE!" };
  if (known) return known;
  const cell = workbook.cells[address];
  if (!cell) {
    const blank: CellRuntime = { kind: "blank" };
    cache.set(address, blank);
    return blank;
  }
  if (cell.formula && !cell.unsupported) {
    cache.set(address, "working");
    const value = evaluateFormula(cell.formula, workbook, cache);
    cache.set(address, value);
    return value;
  }
  if (cell.unsupported) {
    const value = scalarToRuntime(cell.cached);
    cache.set(address, value);
    return value;
  }
  const value = scalarToRuntime(cell.value);
  cache.set(address, value);
  return value;
}

function scalarToRuntime(value: string | number | boolean | undefined): CellRuntime {
  if (value === undefined) return { kind: "blank" };
  if (typeof value === "number") return { kind: "num", value };
  if (typeof value === "boolean") return { kind: "bool", value };
  return { kind: "str", value };
}

export function evaluateFormula(
  formula: string,
  workbook: Workbook,
  cache?: EvalCache,
): CellRuntime {
  const store = cache ?? evaluationCache();
  let ast: Expr;
  try {
    ast = new Parser(formula.trim()).parse();
  } catch {
    return { kind: "err", value: "#VALUE!" };
  }
  return evalExpr(ast, workbook, store);
}

function evalExpr(expr: Expr, workbook: Workbook, cache: EvalCache): CellRuntime {
  if (expr.kind === "num") return { kind: "num", value: expr.value };
  if (expr.kind === "str") return { kind: "str", value: expr.value };
  if (expr.kind === "bool") return { kind: "bool", value: expr.value };
  if (expr.kind === "ref") {
    if (refOutOfBounds(expr.ref)) return { kind: "err", value: "#REF!" };
    return readCell(workbook, formatAddress(expr.ref.col, expr.ref.row), cache);
  }
  if (expr.kind === "range") return { kind: "err", value: "#VALUE!" };
  if (expr.kind === "neg") {
    const inner = evalExpr(expr.expr, workbook, cache);
    if (inner.kind === "err") return inner;
    const num = toNumber(inner, true);
    if (num === null) return { kind: "err", value: "#VALUE!" };
    return { kind: "num", value: -num };
  }
  if (expr.kind === "bin") {
    const left = evalExpr(expr.left, workbook, cache);
    if (left.kind === "err") return left;
    const right = evalExpr(expr.right, workbook, cache);
    if (right.kind === "err") return right;
    return evalBinary(expr.op, left, right);
  }
  return evalCall(expr.name, expr.args, workbook, cache);
}

function evalCall(name: string, args: Expr[], workbook: Workbook, cache: EvalCache): CellRuntime {
  if (!FUNCTIONS.has(name)) return { kind: "err", value: "#NAME?" };
  if (name === "IF") {
    if (args.length !== 3) return { kind: "err", value: "#VALUE!" };
    const cond = evalExpr(args[0], workbook, cache);
    if (cond.kind === "err") return cond;
    const truth = conditionTrue(cond);
    if (truth === null) return { kind: "err", value: "#VALUE!" };
    return evalExpr(truth ? args[1] : args[2], workbook, cache);
  }
  const values: CellRuntime[] = [];
  for (const arg of args) {
    const flattened = flattenArg(arg, workbook, cache);
    if ("error" in flattened) return flattened.error;
    values.push(...flattened.values);
  }
  const numbers: number[] = [];
  for (const value of values) {
    if (value.kind === "err") return value;
    if (value.kind === "blank" || value.kind === "str") continue;
    if (value.kind === "bool") {
      if (name === "COUNT") continue;
      numbers.push(value.value ? 1 : 0);
      continue;
    }
    numbers.push(value.value);
  }
  if (name === "COUNT") return { kind: "num", value: numbers.length };
  if (name === "SUM") {
    return { kind: "num", value: numbers.reduce((sum, item) => sum + item, 0) };
  }
  if (numbers.length === 0) return { kind: "err", value: "#DIV/0!" };
  const total = numbers.reduce((sum, item) => sum + item, 0);
  return { kind: "num", value: total / numbers.length };
}

function flattenArg(
  expr: Expr,
  workbook: Workbook,
  cache: EvalCache,
): { values: CellRuntime[] } | { error: CellRuntime } {
  if (expr.kind === "range") {
    if (refOutOfBounds(expr.start) || refOutOfBounds(expr.end)) {
      return { error: { kind: "err", value: "#REF!" } };
    }
    const c1 = Math.min(expr.start.col, expr.end.col);
    const c2 = Math.max(expr.start.col, expr.end.col);
    const r1 = Math.min(expr.start.row, expr.end.row);
    const r2 = Math.max(expr.start.row, expr.end.row);
    const values: CellRuntime[] = [];
    for (let row = r1; row <= r2; row += 1) {
      for (let col = c1; col <= c2; col += 1) {
        values.push(readCell(workbook, formatAddress(col, row), cache));
      }
    }
    return { values };
  }
  return { values: [evalExpr(expr, workbook, cache)] };
}

function evalBinary(op: string, left: CellRuntime, right: CellRuntime): CellRuntime {
  if (op === "+" || op === "-" || op === "*" || op === "/") {
    const a = toNumber(left, true);
    const b = toNumber(right, true);
    if (a === null || b === null) return { kind: "err", value: "#VALUE!" };
    if (op === "+") return { kind: "num", value: a + b };
    if (op === "-") return { kind: "num", value: a - b };
    if (op === "*") return { kind: "num", value: a * b };
    if (b === 0) return { kind: "err", value: "#DIV/0!" };
    return { kind: "num", value: a / b };
  }
  const compared = compare(left, right);
  if (compared === null) return { kind: "err", value: "#VALUE!" };
  const truth =
    (op === "=" && compared === 0) ||
    (op === "<>" && compared !== 0) ||
    (op === ">" && compared > 0) ||
    (op === "<" && compared < 0) ||
    (op === ">=" && compared >= 0) ||
    (op === "<=" && compared <= 0);
  return { kind: "bool", value: truth };
}

function compare(left: CellRuntime, right: CellRuntime): number | null {
  const a = compareKey(left);
  const b = compareKey(right);
  if (!a || !b) return null;
  if (a.kind === "num" && b.kind === "num") return a.value - b.value;
  if (a.kind === "str" && b.kind === "str") {
    const as = a.value.toLowerCase();
    const bs = b.value.toLowerCase();
    if (as === bs) return 0;
    return as < bs ? -1 : 1;
  }
  if (a.kind === "num" && b.kind === "str") return -1;
  if (a.kind === "str" && b.kind === "num") return 1;
  return null;
}

function compareKey(value: CellRuntime): { kind: "num"; value: number } | { kind: "str"; value: string } | null {
  if (value.kind === "err") return null;
  if (value.kind === "blank") return { kind: "num", value: 0 };
  if (value.kind === "bool") return { kind: "num", value: value.value ? 1 : 0 };
  if (value.kind === "num") return { kind: "num", value: value.value };
  const asNumber = /^-?\d+(\.\d+)?$/.test(value.value) ? Number(value.value) : null;
  if (asNumber !== null) return { kind: "num", value: asNumber };
  return { kind: "str", value: value.value };
}

function toNumber(value: CellRuntime, blankIsZero: boolean): number | null {
  if (value.kind === "num") return value.value;
  if (value.kind === "bool") return value.value ? 1 : 0;
  if (value.kind === "blank") return blankIsZero ? 0 : null;
  return null;
}

function conditionTrue(value: CellRuntime): boolean | null {
  if (value.kind === "bool") return value.value;
  if (value.kind === "num") return value.value !== 0;
  if (value.kind === "blank") return false;
  return null;
}

export function runtimeIsCycle(value: CellRuntime): boolean {
  return value.kind === "err" && value.value === "#CYCLE!";
}

export function displayRuntime(value: CellRuntime): string {
  if (value.kind === "blank") return "";
  if (value.kind === "num") return String(value.value);
  if (value.kind === "str") return value.value;
  if (value.kind === "bool") return value.value ? "TRUE" : "FALSE";
  return value.value;
}

export function hasCycle(workbook: Workbook): boolean {
  const cache = evaluationCache();
  for (const [address, cell] of Object.entries(workbook.cells)) {
    if (!cell.formula || cell.unsupported) continue;
    const value = readCell(workbook, address, cache);
    if (runtimeIsCycle(value)) return true;
  }
  return false;
}

export function rowShift(ref: CellRef, at: number, count: number): CellRef | null {
  const row = ref.row >= at ? ref.row + count : ref.row;
  if (row < 1 || row > ROW_COUNT) return null;
  return { ...ref, row };
}

export function colShift(ref: CellRef, at: number, count: number): CellRef | null {
  const col = ref.col >= at ? ref.col + count : ref.col;
  if (col < 1 || col > COL_COUNT) return null;
  return { ...ref, col };
}

export function movePos(pos: CellPos, rowAt: number | null, rowCount: number, colAt: number | null, colCount: number): CellPos | null {
  let row = pos.row;
  let col = pos.col;
  if (rowAt !== null && row >= rowAt) row += rowCount;
  if (colAt !== null && col >= colAt) col += colCount;
  if (row < 1 || row > ROW_COUNT || col < 1 || col > COL_COUNT) return null;
  return { col, row };
}
