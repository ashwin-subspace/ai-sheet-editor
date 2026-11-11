import { formatRange, normalizeSelection, type NormRange } from "./address";
import { evaluationCache } from "./formula";
import { SNAPSHOT_LINE_CAP, type Selection, type Workbook } from "./types";
import { cellView, formulaBarText } from "./workbook";

export const SYSTEM_PROMPT = `You edit a spreadsheet by replying with one JSON object and nothing else.
Shape: {"message": string, "operations": array}
operations may be empty when you are only answering a question.
Allowed operations:
- {"op":"write_range","start":"A1","rows":[["Category","Budget","Actual","Difference"],["Rent",1000,900,"=C2-B2"]]}
Each inner list in rows is one sheet row from left to right. Do not put each value in its own list.
If the user asks for a table, put each column name in its own cell on row 1, then add a sample row. Never put the user's sentence into one cell.
- {"op":"set_formula","cell":"B3","formula":"=SUM(B2:B2)"}
- {"op":"format_range","range":"A1:C1","bold":true,"fill":"#FFF2CC","numberFormat":"0.00"}
- {"op":"insert_rows","at":3,"count":1} inserts blank rows only. To add rows with values, use write_range at the first empty row and put every new row in rows. Do not put count on write_range.
- {"op":"insert_columns","at":"D","count":1}
- {"op":"clear_range","range":"C2:C5"}
- {"op":"set_column_width","column":"A","width":18}
- {"op":"highlight_greater","leftRange":"C2:C6","rightRange":"B2:B6","fill":"#F4C7C3"}
Formulas start with = and may use only SUM, AVERAGE, COUNT, IF, + - * /, comparisons, cell refs, and ranges.
No other functions. No other sheets. Columns are A-Z and rows are 1-200.
Do not add fields that are not listed.
Examples:
User: Set A1 to Hello. -> {"message":"Set A1.","operations":[{"op":"write_range","start":"A1","rows":[["Hello"]]}]}
User: Add 3 more rows like row 2 starting at A3. -> {"message":"Added 3 rows.","operations":[{"op":"write_range","start":"A3","rows":[["Food",400,350,"=C3-B3"],["Transport",200,180,"=C4-B4"],["Power",150,160,"=C5-B5"]]}]}
User: What is in A1? -> {"message":"A1 contains Hello.","operations":[]}`;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export function sheetSnapshot(workbook: Workbook, selection: NormRange | null): { text: string; omitted: boolean } {
  const cache = evaluationCache();
  const lines: string[] = [];
  const addresses = Object.keys(workbook.cells).sort(compareAddress);
  const content = addresses.filter((address) => {
    const cell = workbook.cells[address];
    return cell?.value !== undefined || Boolean(cell?.formula);
  });
  if (content.length <= SNAPSHOT_LINE_CAP) {
    for (const address of content) lines.push(lineFor(workbook, address, cache));
    return { text: lines.join("\n") || "(empty sheet)", omitted: false };
  }
  const row1 = content.filter((address) => /[A-Z]+1$/.test(address));
  const selected = selection
    ? content.filter((address) => addressInRangeLoose(address, selection) && !row1.includes(address))
    : [];
  for (const address of [...row1, ...selected].slice(0, SNAPSHOT_LINE_CAP)) {
    lines.push(lineFor(workbook, address, cache));
  }
  return { text: lines.join("\n"), omitted: true };
}

function lineFor(workbook: Workbook, address: string, cache: ReturnType<typeof evaluationCache>): string {
  const cell = workbook.cells[address];
  const bar = formulaBarText(cell);
  const view = cellView(workbook, address, cache);
  if (cell?.formula) return `${address}: ${bar} => ${view.text}`;
  return `${address}: ${bar}`;
}

function addressInRangeLoose(address: string, selection: NormRange): boolean {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match) return false;
  let col = 0;
  for (const char of match[1]) col = col * 26 + (char.charCodeAt(0) - 64);
  const row = Number(match[2]);
  return col >= selection.c1 && col <= selection.c2 && row >= selection.r1 && row <= selection.r2;
}

function compareAddress(a: string, b: string): number {
  const ar = Number(a.replace(/[A-Z]/g, ""));
  const br = Number(b.replace(/[A-Z]/g, ""));
  if (ar !== br) return ar - br;
  return a.localeCompare(b);
}

export function buildChatMessages(input: {
  workbook: Workbook;
  selection: Selection | null;
  history: ChatTurn[];
  prompt: string;
}): { role: "system" | "user" | "assistant"; content: string }[] {
  const range = input.selection ? normalizeSelection(input.selection.anchor, input.selection.end) : null;
  const snapshot = sheetSnapshot(input.workbook, range);
  const selectionText = range ? formatRange(range) : "none";
  const recent = input.history.slice(-2).map((turn) => ({ role: turn.role, content: turn.text }));
  const omitted = snapshot.omitted ? "\nOther cells were omitted." : "";
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...recent,
    {
      role: "user",
      content: `Sheet:\n${snapshot.text}${omitted}\nSelection: ${selectionText}\n\n${input.prompt}`,
    },
  ];
}
