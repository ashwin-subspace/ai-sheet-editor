const writeRangeOp = {
  type: "object",
  additionalProperties: false,
  required: ["op", "start", "rows"],
  properties: {
    op: { type: "string", const: "write_range" },
    start: { type: "string" },
    rows: {
      type: "array",
      maxItems: 40,
      items: {
        type: "array",
        maxItems: 8,
      },
    },
  },
} as const;

const setFormulaOp = {
  type: "object",
  additionalProperties: false,
  required: ["op", "cell", "formula"],
  properties: {
    op: { type: "string", const: "set_formula" },
    cell: { type: "string" },
    formula: { type: "string" },
  },
} as const;

const formatRangeOp = {
  type: "object",
  additionalProperties: false,
  required: ["op", "range"],
  properties: {
    op: { type: "string", const: "format_range" },
    range: { type: "string" },
    bold: { type: "boolean" },
    fill: { type: "string" },
    numberFormat: { type: "string" },
  },
} as const;

const insertRowsOp = {
  type: "object",
  additionalProperties: false,
  required: ["op", "at", "count"],
  properties: {
    op: { type: "string", const: "insert_rows" },
    at: { type: "number" },
    count: { type: "number" },
  },
} as const;

const insertColumnsOp = {
  type: "object",
  additionalProperties: false,
  required: ["op", "at", "count"],
  properties: {
    op: { type: "string", const: "insert_columns" },
    at: { type: "string" },
    count: { type: "number" },
  },
} as const;

const clearRangeOp = {
  type: "object",
  additionalProperties: false,
  required: ["op", "range"],
  properties: {
    op: { type: "string", const: "clear_range" },
    range: { type: "string" },
  },
} as const;

const setColumnWidthOp = {
  type: "object",
  additionalProperties: false,
  required: ["op", "column", "width"],
  properties: {
    op: { type: "string", const: "set_column_width" },
    column: { type: "string" },
    width: { type: "number" },
  },
} as const;

const highlightGreaterOp = {
  type: "object",
  additionalProperties: false,
  required: ["op", "leftRange", "rightRange", "fill"],
  properties: {
    op: { type: "string", const: "highlight_greater" },
    leftRange: { type: "string" },
    rightRange: { type: "string" },
    fill: { type: "string" },
  },
} as const;

export const replySchema = {
  type: "json_schema",
  json_schema: {
    name: "sheet_edit",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["message", "operations"],
      properties: {
        message: { type: "string" },
        operations: {
          type: "array",
          maxItems: 40,
          items: {
            oneOf: [
              writeRangeOp,
              setFormulaOp,
              formatRangeOp,
              insertRowsOp,
              insertColumnsOp,
              clearRangeOp,
              setColumnWidthOp,
              highlightGreaterOp,
            ],
          },
        },
      },
    },
  },
} as const;
