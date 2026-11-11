import { completionFromSettings, prepareCliModel } from "../server/cli-model";
import { proposeEdits } from "../src/ai/propose";
import type { ChatTurn } from "../src/engine/context";
import { createWorkbook, type Workbook } from "../src/engine/types";
import { sameWorkbook } from "../src/engine/workbook";

interface Step {
  name: string;
  prompt: string;
  expect: "edit" | "question";
  check: (before: Workbook, after: Workbook) => { pass: boolean; note: string };
}

const steps: Step[] = [
  {
    name: "1 create",
    prompt: "Create an expense tracker. Put Category, Budget, Actual, and Difference in row 1. Put Rent, 1000, and 900 on row 2, and a formula for Actual minus Budget.",
    expect: "edit",
    check: (_before, after) => {
      const texts = values(after);
      const formulas = formulaText(after);
      const pass = /Category/i.test(texts) && /Budget/i.test(texts) && /Rent/i.test(texts) && /-/.test(formulas);
      return { pass, note: pass ? "headers, Rent, and a difference formula" : "missing the first table" };
    },
  },
  {
    name: "2 add rows",
    prompt: "Add three more category rows under the existing ones. Each row needs a budget, an actual, and a difference formula.",
    expect: "edit",
    check: (before, after) => {
      const pass = formulaCount(after) >= formulaCount(before) + 3 && !sameWorkbook(before, after);
      return { pass, note: pass ? `${formulaCount(after)} formulas` : `formulas went from ${formulaCount(before)} to ${formulaCount(after)}` };
    },
  },
  {
    name: "3 bold header",
    prompt: "Make the header row bold.",
    expect: "edit",
    check: (_before, after) => {
      const pass = Object.values(after.cells).some((cell) => cell.bold && /category|budget|actual|difference/i.test(String(cell.value ?? "")));
      return { pass, note: pass ? "a header cell is bold" : "header is not bold" };
    },
  },
  {
    name: "4 question",
    prompt: "What is the Rent budget?",
    expect: "question",
    check: (before, after) => {
      const pass = sameWorkbook(before, after);
      return { pass, note: pass ? "sheet unchanged" : "the question changed the sheet" };
    },
  },
  {
    name: "5 change a value",
    prompt: "Set the Rent budget to 1500.",
    expect: "edit",
    check: (_before, after) => {
      const rent = Object.entries(after.cells).find(([, cell]) => String(cell.value).toLowerCase() === "rent")?.[0];
      const row = rent?.replace(/\D/g, "");
      const budget = row ? after.cells[`B${row}`]?.value : undefined;
      const pass = budget === 1500;
      return { pass, note: pass ? "Rent budget is 1500" : `Rent budget is ${String(budget)}` };
    },
  },
];

async function main(): Promise<void> {
  const prepared = await prepareCliModel();
  console.log(`Model: ${prepared.label}`);
  let workbook = createWorkbook();
  const history: ChatTurn[] = [];
  let failed = 0;
  for (const step of steps) {
    console.log(`\n=== ${step.name} ===`);
    const before = structuredClone(workbook);
    const result = await proposeEdits({
      workbook,
      selection: { anchor: "A1", end: "A1" },
      history,
      prompt: step.prompt,
      complete: completionFromSettings,
    });
    history.push({ role: "user", text: step.prompt });
    if (result.kind === "preview") {
      history.push({ role: "assistant", text: result.review.message || "Proposed an edit." });
      workbook = result.review.workbook;
      console.log(result.review.message);
      console.log(result.review.summaries.join(" | "));
    } else if (result.kind === "message") {
      history.push({ role: "assistant", text: result.message });
      console.log(`Message: ${result.message}`);
    } else {
      console.log(`Error: ${result.message}`);
    }
    const graded = step.check(before, workbook);
    const kindOk = step.expect === "question" ? result.kind === "message" : result.kind === "preview";
    const pass = graded.pass && kindOk;
    if (!pass) failed += 1;
    console.log(`${pass ? "PASS" : "FAIL"} — ${graded.note} (${result.kind})`);
    console.log(dump(workbook));
  }
  console.log(failed === 0 ? "\nAll follow-up prompts passed." : `\n${failed} follow-up prompt(s) failed.`);
  if (failed > 0) process.exitCode = 1;
}

function values(workbook: Workbook): string {
  return Object.values(workbook.cells).map((cell) => String(cell.value ?? "")).join(" ");
}

function formulaText(workbook: Workbook): string {
  return Object.values(workbook.cells).map((cell) => cell.formula ?? "").join(" ");
}

function formulaCount(workbook: Workbook): number {
  return Object.values(workbook.cells).filter((cell) => cell.formula).length;
}

function dump(workbook: Workbook): string {
  const lines = Object.keys(workbook.cells).sort().map((address) => {
    const cell = workbook.cells[address];
    const text = cell.formula ?? cell.value ?? "";
    return `${address}: ${text}${cell.bold ? " bold" : ""}`;
  });
  return lines.join("\n") || "(empty sheet)";
}

void main();
