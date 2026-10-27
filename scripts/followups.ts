import { modelReplyText } from "../server/model-reply";
import { proposeEdits, type CompletionRequest, type CompletionResult } from "../src/ai/propose";
import type { ChatTurn } from "../src/engine/context";
import { createWorkbook, type Workbook } from "../src/engine/types";
import { sameWorkbook } from "../src/engine/workbook";

const LM = process.env.LM_STUDIO_URL ?? "http://127.0.0.1:1234/v1";

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
  const model = await loadedModel();
  console.log(`Model: ${model}`);
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
      complete: (request) => complete(model, request),
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

async function loadedModel(): Promise<string> {
  const response = await fetch(`${LM}/models`);
  if (!response.ok) throw new Error(`LM Studio returned ${response.status}`);
  const json = (await response.json()) as { data?: { id?: string }[] };
  const id = json.data?.find((item) => item.id && !item.id.includes("embed"))?.id;
  if (!id) throw new Error("No chat model is loaded in LM Studio.");
  return id;
}

async function complete(model: string, request: CompletionRequest): Promise<CompletionResult> {
  try {
    const response = await fetch(`${LM}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer lm-studio" },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: false,
        response_format: request.response_format,
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      const schemaRejected = Boolean(request.response_format) && (response.status === 400 || response.status === 422 || /schema|grammar|response_format/i.test(text));
      return { ok: false, status: response.status, error: text.slice(0, 300), schemaRejected };
    }
    const json = JSON.parse(text) as { choices?: { message?: { content?: unknown; reasoning_content?: unknown } }[] };
    const content = modelReplyText(json.choices?.[0]?.message);
    if (!content) return { ok: false, status: 502, error: "The model returned an empty reply." };
    console.log(`reply: ${content.slice(0, 240).replace(/\s+/g, " ")}`);
    return { ok: true, content };
  } catch (error) {
    return { ok: false, status: 503, error: error instanceof Error ? error.message : "LM Studio is not running" };
  }
}

void main();
