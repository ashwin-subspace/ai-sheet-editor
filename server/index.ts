import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { backupIfExists } from "./backup";
import { modelReplyText } from "./model-reply";
import { bufferToWorkbook, workbookToBuffer } from "./xlsx";
import type { Workbook } from "../src/engine/types";

const PORT = 8787;
const LM_BASE = process.env.LM_STUDIO_URL ?? "http://127.0.0.1:1234/v1";
const defaultDirectory = path.join(process.cwd(), "workbooks");

interface ChatFile {
  messages: { role: string; text: string }[];
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/config") {
      await fs.mkdir(defaultDirectory, { recursive: true });
      return send(res, 200, { directory: defaultDirectory });
    }
    if (req.method === "GET" && url.pathname === "/api/files") {
      const directory = url.searchParams.get("directory") || defaultDirectory;
      const resolved = path.resolve(directory);
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".xlsx"))
        .map((entry) => ({ name: entry.name, path: path.join(resolved, entry.name) }));
      return send(res, 200, { directory: resolved, files });
    }
    if (req.method === "POST" && url.pathname === "/api/open") {
      const body = await readJson<{ path?: string }>(req);
      const filePath = xlsxPath(body.path);
      if (!filePath) return send(res, 400, { error: "Choose an .xlsx file." });
      const loaded = await bufferToWorkbook(await fs.readFile(filePath));
      const chat = await readChat(chatPath(filePath));
      return send(res, 200, { ...loaded, path: filePath, chat });
    }
    if (req.method === "POST" && url.pathname === "/api/open-upload") {
      const body = await readJson<{ fileName?: string; dataBase64?: string }>(req);
      if (!body.dataBase64) return send(res, 400, { error: "Missing file data." });
      const loaded = await bufferToWorkbook(Buffer.from(body.dataBase64, "base64"));
      const safeName = path.basename(body.fileName || "Uploaded.xlsx").replace(/[^\w.\- ()]+/g, "");
      const fileName = safeName.toLowerCase().endsWith(".xlsx") ? safeName : `${safeName}.xlsx`;
      return send(res, 200, { ...loaded, path: null, fileName, chat: { messages: [] } });
    }
    if (req.method === "POST" && url.pathname === "/api/save") {
      const body = await readJson<{ path?: string; workbook?: Workbook; chat?: ChatFile }>(req);
      const filePath = xlsxPath(body.path);
      if (!filePath || !body.workbook) return send(res, 400, { error: "Choose a file name ending in .xlsx." });
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const backup = await backupIfExists(filePath);
      await fs.writeFile(filePath, await workbookToBuffer(body.workbook));
      await fs.writeFile(chatPath(filePath), JSON.stringify(body.chat ?? { messages: [] }, null, 2));
      return send(res, 200, { path: filePath, backup });
    }
    if (req.method === "POST" && url.pathname === "/api/ai") {
      const body = await readJson<Record<string, unknown>>(req);
      const result = await proxyModel(body);
      return send(res, result.status, result.payload);
    }
    send(res, 404, { error: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The file helper failed.";
    send(res, 500, { error: message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`File helper listening on http://127.0.0.1:${PORT}`);
  console.log(`Workbook folder: ${defaultDirectory}`);
});

async function proxyModel(body: Record<string, unknown>): Promise<{ status: number; payload: unknown }> {
  try {
    const model = await loadedModel();
    const response = await fetch(`${LM_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lm-studio",
      },
      body: JSON.stringify({
        model,
        messages: body.messages,
        temperature: body.temperature ?? 0.1,
        max_tokens: body.max_tokens ?? 1200,
        stream: false,
        response_format: body.response_format,
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      const schemaRejected = Boolean(body.response_format) && isSchemaRejection(response.status, text);
      return {
        status: schemaRejected ? 400 : response.status,
        payload: {
          error: text.slice(0, 500) || "LM Studio rejected the request. The sheet was not changed.",
          schemaRejected,
        },
      };
    }
    const json = JSON.parse(text) as {
      choices?: { message?: { content?: unknown; reasoning_content?: unknown } }[];
    };
    const content = modelReplyText(json.choices?.[0]?.message);
    if (!content) {
      return { status: 502, payload: { error: "LM Studio returned no message. The sheet was not changed." } };
    }
    return { status: 200, payload: { content } };
  } catch {
    return {
      status: 503,
      payload: { error: "LM Studio is not running at http://localhost:1234. The sheet was not changed." },
    };
  }
}

function isSchemaRejection(status: number, body: string): boolean {
  if (status === 400 || status === 422) return true;
  return /schema|grammar|response_format|structured/i.test(body);
}

let modelId = "";

async function loadedModel(): Promise<string> {
  if (modelId) return modelId;
  const response = await fetch(`${LM_BASE}/models`);
  if (!response.ok) throw new Error("models failed");
  const json = (await response.json()) as { data?: { id?: string }[] };
  const id = json.data?.find((item) => item.id)?.id;
  if (!id) throw new Error("no model");
  modelId = id;
  return id;
}

function xlsxPath(input: string | undefined): string | null {
  if (!input) return null;
  const resolved = path.resolve(input);
  if (!resolved.toLowerCase().endsWith(".xlsx")) return null;
  if (resolved.includes("\0")) return null;
  return resolved;
}

function chatPath(filePath: string): string {
  return filePath.replace(/\.xlsx$/i, ".chat.json");
}

async function readChat(filePath: string): Promise<ChatFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as ChatFile;
    if (!Array.isArray(parsed.messages)) return { messages: [] };
    return parsed;
  } catch {
    return { messages: [] };
  }
}

function readJson<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 20_000_000) {
        reject(new Error("Upload is larger than 20 MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? (JSON.parse(text) as T) : ({} as T));
      } catch {
        reject(new Error("Request was not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
