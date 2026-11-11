import { describe, expect, it } from "vitest";
import { normalizeSelection } from "./address";
import { createHistory, redoHistory, undoHistory } from "./history";
import {
  OPERATION_FIELDS,
  parseModelJson,
  reviewModelText,
  sanitizeOperationRecord,
} from "./operations";
import { SAMPLE_EDIT } from "./sample";
import { MAX_OPS, MAX_WRITE_COLS, MAX_WRITE_ROWS, createWorkbook } from "./types";
import { applyUserInput, cellView, sameWorkbook } from "./workbook";
import { evaluationCache } from "./formula";

describe("model replies", () => {
  it("accepts one fenced JSON object", () => {
    const text = '```json\n{"message":"Hi","operations":[]}\n```';
    const review = reviewModelText(text, createWorkbook(), null);
    expect(review.ok).toBe(true);
    if (review.ok) expect(review.message).toBe("Hi");
  });

  it("rejects two JSON objects and prose", () => {
    const two = '{"message":"a","operations":[]}{"message":"b","operations":[]}';
    expect(parseModelJson(two).ok).toBe(false);
    expect(reviewModelText("please do this", createWorkbook(), null).ok).toBe(false);
  });

  it("keeps the object that contains edits when a second empty object is glued on", () => {
    const text = [
      '{"message":"Updated rows.","operations":[{"op":"write_range","start":"A2","rows":[["Rent","1000"]]}]}',
      "}",
      '{"message":"Updated rows.","operations":[]}',
    ].join("\n");
    const review = reviewModelText(text, createWorkbook(), null);
    expect(review.ok).toBe(true);
    if (review.ok) expect(review.operations).toHaveLength(1);
  });

  it("rejects a whole batch when one operation is illegal", () => {
    const book = createWorkbook();
    const text = JSON.stringify({
      message: "mixed",
      operations: [
        { op: "write_range", start: "A1", rows: [["Keep"]] },
        { op: "set_formula", cell: "B1", formula: "=VLOOKUP(A1,B1:C3,2,FALSE)" },
        { op: "write_range", start: "C1", rows: [["No"]] },
      ],
    });
    const review = reviewModelText(text, book, null);
    expect(review.ok).toBe(false);
    expect(sameWorkbook(book, createWorkbook())).toBe(true);
    if (!review.ok) expect(review.error).toMatch(/VLOOKUP/);
  });

  it("rejects circular formulas and keeps the sheet", () => {
    const book = createWorkbook();
    const review = reviewModelText(
      JSON.stringify({
        message: "cycle",
        operations: [{ op: "set_formula", cell: "A1", formula: "=A1+1" }],
      }),
      book,
      null,
    );
    expect(review.ok).toBe(false);
    expect(Object.keys(book.cells)).toHaveLength(0);
  });

  it("shows division by zero in the preview instead of retrying", () => {
    const review = reviewModelText(
      JSON.stringify({
        message: "div",
        operations: [{ op: "set_formula", cell: "A1", formula: "=1/0" }],
      }),
      createWorkbook(),
      null,
    );
    expect(review.ok).toBe(true);
    if (review.ok) expect(cellView(review.workbook, "A1", evaluationCache()).text).toBe("#DIV/0!");
  });

  it("warns when edits fall outside the selection but still applies them", () => {
    const review = reviewModelText(
      JSON.stringify({
        message: "outside",
        operations: [{ op: "write_range", start: "Z1", rows: [["Far"]] }],
      }),
      createWorkbook(),
      normalizeSelection("B2", "B10"),
    );
    expect(review.ok).toBe(true);
    if (review.ok) {
      expect(review.warning).toMatch(/outside the selection/i);
      expect(review.workbook.cells.Z1?.value).toBe("Far");
    }
  });

  it("previews the expense sample, then undo and redo restore it", () => {
    let history = createHistory(createWorkbook());
    const review = reviewModelText(SAMPLE_EDIT, history.present, null);
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.workbook.cells.A2?.value).toBe("Rent");
    expect(review.workbook.cells.A1?.bold).toBe(true);
    expect(review.workbook.cells.A1?.fill).toBe("#FFF2CC");
    expect(cellView(review.workbook, "D2", evaluationCache()).text).toBe("-100");
    expect(sameWorkbook(history.present, createWorkbook())).toBe(true);
    history = undoHistory(history);
    expect(history.present.cells.A2).toBeUndefined();
    history = { ...history, past: [], present: review.workbook, future: [] };
    const accepted = {
      past: [createWorkbook()],
      present: review.workbook,
      future: [],
    };
    const undone = undoHistory(accepted);
    expect(undone.present.cells.A2).toBeUndefined();
    const redone = redoHistory(undone);
    expect(redone.present.cells.A2?.value).toBe("Rent");
  });

  it("shifts formulas when a row is inserted inside a sum", () => {
    let book = createWorkbook();
    book = applyUserInput(book, "A1", "1");
    book = applyUserInput(book, "A2", "2");
    book = applyUserInput(book, "A3", "3");
    book = applyUserInput(book, "A4", "=SUM(A1:A3)");
    const review = reviewModelText(
      JSON.stringify({ message: "insert", operations: [{ op: "insert_rows", at: 2, count: 1 }] }),
      book,
      null,
    );
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.workbook.cells.A5?.formula).toBe("=SUM(A1:A4)");
    expect(cellView(review.workbook, "A5", evaluationCache()).text).toBe("6");
  });

  it("highlights only the greater cells", () => {
    let book = createWorkbook();
    book = applyUserInput(book, "B2", "100");
    book = applyUserInput(book, "C2", "150");
    book = applyUserInput(book, "B3", "100");
    book = applyUserInput(book, "C3", "50");
    const review = reviewModelText(
      JSON.stringify({
        message: "highlight",
        operations: [
          { op: "highlight_greater", leftRange: "C2:C3", rightRange: "B2:B3", fill: "#F4C7C3" },
        ],
      }),
      book,
      null,
    );
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.workbook.cells.C2?.fill).toBe("#F4C7C3");
    expect(review.workbook.cells.C3?.fill).toBeUndefined();
  });

  it("rejects an unknown field", () => {
    const review = reviewModelText(
      JSON.stringify({ message: "no", operations: [], delete_all: true }),
      createWorkbook(),
      null,
    );
    expect(review.ok).toBe(false);
  });

  it("accepts write_range when the model adds count from insert_rows", () => {
    const book = createWorkbook();
    const review = reviewModelText(
      JSON.stringify({
        message: "Added rows.",
        operations: [
          {
            op: "write_range",
            start: "A2",
            count: 10,
            rows: [
              ["Food", 400, 350, "=C2-B2"],
              ["Transport", 200, 180, "=C3-B3"],
            ],
          },
        ],
      }),
      book,
      null,
    );
    expect(review.ok).toBe(true);
    if (review.ok) {
      expect(review.workbook.cells.A2?.value).toBe("Food");
      expect(review.workbook.cells.A3?.value).toBe("Transport");
    }
  });

  it("rejects write_range that only has count and no rows", () => {
    const review = reviewModelText(
      JSON.stringify({
        message: "Added rows.",
        operations: [{ op: "write_range", start: "A3", count: 10 }],
      }),
      createWorkbook(),
      null,
    );
    expect(review.ok).toBe(false);
    if (!review.ok) expect(review.error).toMatch(/rows must be an array/i);
  });
});

describe("sanitizeOperationRecord", () => {
  it("strips cross-op fields for every known operation type", () => {
    const samples: Record<string, Record<string, unknown>> = {
      write_range: { op: "write_range", start: "A1", rows: [["x"]], count: 5, cell: "B1" },
      set_formula: { op: "set_formula", cell: "A1", formula: "=1+1", rows: [[]] },
      format_range: { op: "format_range", range: "A1", bold: true, count: 1 },
      insert_rows: { op: "insert_rows", at: 2, count: 1, start: "A1" },
      insert_columns: { op: "insert_columns", at: "B", count: 1, range: "A1" },
      clear_range: { op: "clear_range", range: "A1:A2", fill: "#FFFFFF" },
      set_column_width: { op: "set_column_width", column: "A", width: 12, at: 1 },
      highlight_greater: {
        op: "highlight_greater",
        leftRange: "C2:C3",
        rightRange: "B2:B3",
        fill: "#F4C7C3",
        count: 2,
      },
    };
    for (const [op, record] of Object.entries(samples)) {
      const sanitized = sanitizeOperationRecord(record);
      const allowed = new Set(OPERATION_FIELDS[op]);
      for (const key of Object.keys(sanitized)) {
        expect(allowed.has(key)).toBe(true);
      }
      for (const key of Object.keys(record)) {
        if (allowed.has(key)) expect(sanitized).toHaveProperty(key);
      }
    }
  });
});

describe("operation field validation", () => {
  const validOps: { name: string; payload: Record<string, unknown> }[] = [
    { name: "write_range", payload: { op: "write_range", start: "A1", rows: [["Hi"]] } },
    { name: "set_formula", payload: { op: "set_formula", cell: "A1", formula: "=SUM(A2:A3)" } },
    { name: "format_range", payload: { op: "format_range", range: "A1", bold: true } },
    {
      name: "insert_rows",
      payload: { op: "insert_rows", at: 2, count: 1 },
    },
    { name: "insert_columns", payload: { op: "insert_columns", at: "B", count: 1 } },
    { name: "clear_range", payload: { op: "clear_range", range: "A1:B2" } },
    { name: "set_column_width", payload: { op: "set_column_width", column: "A", width: 10 } },
    {
      name: "highlight_greater",
      payload: {
        op: "highlight_greater",
        leftRange: "C2:C3",
        rightRange: "B2:B3",
        fill: "#F4C7C3",
      },
    },
  ];

  it.each(validOps)("accepts a minimal valid $name operation", ({ payload }) => {
    const review = reviewModelText(
      JSON.stringify({ message: "ok", operations: [payload] }),
      createWorkbook(),
      null,
    );
    expect(review.ok).toBe(true);
  });

  it.each(validOps)("accepts $name when another op's fields are mixed in", ({ payload }) => {
    const polluted = { ...payload, count: 1, rows: [["noise"]], formula: "=1+1" };
    const review = reviewModelText(
      JSON.stringify({ message: "ok", operations: [polluted] }),
      createWorkbook(),
      null,
    );
    expect(review.ok).toBe(true);
  });
});

describe("illegal operation matrix", () => {
  function rejectCase(label: string, operations: unknown[], root?: Record<string, unknown>) {
    it(`rejects ${label} and keeps the workbook`, () => {
      const book = createWorkbook();
      book.cells.Z1 = { value: "anchor" };
      const payload = root ?? { message: "x", operations };
      const review = reviewModelText(JSON.stringify(payload), book, null);
      expect(review.ok).toBe(false);
      expect(sameWorkbook(book, createWorkbook())).toBe(false);
      expect(book.cells.Z1?.value).toBe("anchor");
    });
  }

  rejectCase("more than 40 operations", Array.from({ length: MAX_OPS + 1 }, () => ({
    op: "write_range",
    start: "A1",
    rows: [["x"]],
  })));

  rejectCase("write_range with 41 rows", [
    {
      op: "write_range",
      start: "A1",
      rows: Array.from({ length: MAX_WRITE_ROWS + 1 }, () => ["a"]),
    },
  ]);

  rejectCase("write_range with 9 columns", [
    {
      op: "write_range",
      start: "A1",
      rows: [Array.from({ length: MAX_WRITE_COLS + 1 }, () => "a")],
    },
  ]);

  rejectCase("write_range at AA1", [{ op: "write_range", start: "AA1", rows: [["x"]] }]);
  rejectCase("write_range at A0", [{ op: "write_range", start: "A0", rows: [["x"]] }]);
  rejectCase("bad fill color", [
    { op: "format_range", range: "A1", bold: true, fill: "#FFF" },
  ]);
  rejectCase("invalid hex fill", [
    { op: "format_range", range: "A1", fill: "#GGGGGG" },
  ]);
  rejectCase("unknown number format", [
    { op: "format_range", range: "A1", numberFormat: "yyyy-mm-dd" },
  ]);
  rejectCase("VLOOKUP in set_formula", [
    { op: "set_formula", cell: "A1", formula: "=VLOOKUP(A2,A1:B2,1)" },
  ]);
  rejectCase("cross-sheet formula", [
    { op: "set_formula", cell: "A1", formula: "=Sheet2!A1" },
  ]);
  rejectCase("insert_rows at 0", [{ op: "insert_rows", at: 0, count: 1 }]);
  rejectCase("insert_rows count 0", [{ op: "insert_rows", at: 2, count: 0 }]);
  rejectCase("insert_columns at AA", [{ op: "insert_columns", at: "AA", count: 1 }]);
  rejectCase("clear_range outside sheet", [{ op: "clear_range", range: "A1:AA2" }]);
  rejectCase("column width 400", [{ op: "set_column_width", column: "A", width: 400 }]);
  rejectCase("column width -1", [{ op: "set_column_width", column: "A", width: -1 }]);
  rejectCase("highlight_greater mismatched ranges", [
    {
      op: "highlight_greater",
      leftRange: "C2:C6",
      rightRange: "B2:B5",
      fill: "#F4C7C3",
    },
  ]);
  rejectCase("empty operations and message", [], { message: "", operations: [] });
  rejectCase("unknown root field delete_all", [], { message: "x", operations: [], delete_all: true });

  it("does not apply op 1 when op 2 is illegal", () => {
    const book = createWorkbook();
    const text = JSON.stringify({
      message: "partial",
      operations: [
        { op: "write_range", start: "A1", rows: [["Applied"]] },
        { op: "format_range", range: "A1:AA2", bold: true },
      ],
    });
    const review = reviewModelText(text, book, null);
    expect(review.ok).toBe(false);
    expect(book.cells.A1).toBeUndefined();
  });
});
