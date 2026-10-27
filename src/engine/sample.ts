export const SAMPLE_EDIT = `{
  "message": "Add an expense header.",
  "operations": [
    {
      "op": "write_range",
      "start": "A1",
      "rows": [
        ["Category", "Budget", "Actual", "Difference"],
        ["Rent", 1000, 900, "=C2-B2"]
      ]
    },
    {
      "op": "format_range",
      "range": "A1:D1",
      "bold": true,
      "fill": "#FFF2CC"
    }
  ]
}`;

export function expenseFixture(): import("./types").Workbook {
  const workbook = { cells: {} as import("./types").Workbook["cells"], columnWidths: {} };
  const rows = [
    ["Category", "Budget", "Actual", "Difference"],
    ["Rent", 1000, 1200, "=C2-B2"],
    ["Food", 400, 350, "=C3-B3"],
    ["Transport", 200, 180, "=C4-B4"],
    ["Power", 150, 160, "=C5-B5"],
    ["Fun", 100, 90, "=C6-B6"],
    ["Total", "=SUM(B2:B6)", "=SUM(C2:C6)", ""],
  ];
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value === "") return;
      const address = `${"ABCD"[c]}${r + 1}`;
      if (typeof value === "string" && value.startsWith("=")) workbook.cells[address] = { formula: value };
      else if (typeof value === "number") workbook.cells[address] = { value };
      else workbook.cells[address] = { value };
    });
  });
  return workbook;
}
