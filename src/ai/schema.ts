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
            type: "object",
            additionalProperties: false,
            required: ["op"],
            properties: {
              op: {
                type: "string",
                enum: [
                  "write_range",
                  "set_formula",
                  "format_range",
                  "insert_rows",
                  "insert_columns",
                  "clear_range",
                  "set_column_width",
                  "highlight_greater",
                ],
              },
              start: { type: "string" },
              rows: { type: "array" },
              cell: { type: "string" },
              formula: { type: "string" },
              range: { type: "string" },
              bold: { type: "boolean" },
              fill: { type: "string" },
              numberFormat: { type: "string" },
              at: {},
              count: { type: "number" },
              column: { type: "string" },
              width: { type: "number" },
              leftRange: { type: "string" },
              rightRange: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;
