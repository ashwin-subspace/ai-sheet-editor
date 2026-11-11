import fs from "node:fs/promises";
import path from "node:path";
import { backupIfExists } from "./backup";
import { completeWithProvider, listProviderModels, toPublic, type ChatInput } from "./provider";
import { buildReadyPayload } from "./ready";
import { readSettings, updateSettings } from "./settings-store";
import { bufferToWorkbook, workbookToBuffer } from "./xlsx";
import type { Workbook } from "../src/engine/types";

export interface ChatFile {
  messages: { role: string; text: string }[];
}

export interface HandlerDeps {
  defaultDirectory: string;
  readSettings?: typeof readSettings;
  updateSettings?: typeof updateSettings;
  listProviderModels?: typeof listProviderModels;
  completeWithProvider?: typeof completeWithProvider;
}

const defaultDeps = {
  readSettings,
  updateSettings,
  listProviderModels,
  completeWithProvider,
};

export function xlsxPath(input: string | undefined): string | null {
  if (!input) return null;
  const resolved = path.resolve(input);
  if (!resolved.toLowerCase().endsWith(".xlsx")) return null;
  if (resolved.includes("\0")) return null;
  return resolved;
}

export function chatPath(filePath: string): string {
  return filePath.replace(/\.xlsx$/i, ".chat.json");
}

export async function readChat(filePath: string): Promise<ChatFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as ChatFile;
    if (!Array.isArray(parsed.messages)) return { messages: [] };
    return parsed;
  } catch {
    return { messages: [] };
  }
}

export async function dispatchRoute(
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  body: unknown,
  deps: HandlerDeps,
): Promise<{ status: number; payload: unknown }> {
  const merged = { ...defaultDeps, ...deps };
  const defaultDirectory = deps.defaultDirectory;

  if (method === "GET" && pathname === "/api/health") {
    return { status: 200, payload: { ok: true, settingsApi: true } };
  }
  if (method === "GET" && pathname === "/api/ready") {
    const payload = await buildReadyPayload(await merged.readSettings(), merged.listProviderModels);
    return { status: 200, payload };
  }
  if (method === "GET" && pathname === "/api/config") {
    await fs.mkdir(defaultDirectory, { recursive: true });
    return { status: 200, payload: { directory: defaultDirectory } };
  }
  if (method === "GET" && pathname === "/api/files") {
    const directory = searchParams.get("directory") || defaultDirectory;
    const resolved = path.resolve(directory);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".xlsx"))
      .map((entry) => ({ name: entry.name, path: path.join(resolved, entry.name) }));
    return { status: 200, payload: { directory: resolved, files } };
  }
  if (method === "POST" && pathname === "/api/open") {
    const filePath = xlsxPath((body as { path?: string }).path);
    if (!filePath) return { status: 400, payload: { error: "Choose an .xlsx file." } };
    try {
      const loaded = await bufferToWorkbook(await fs.readFile(filePath));
      const chat = await readChat(chatPath(filePath));
      return { status: 200, payload: { ...loaded, path: filePath, chat } };
    } catch {
      return { status: 400, payload: { error: "Could not open that file." } };
    }
  }
  if (method === "POST" && pathname === "/api/open-upload") {
    const record = body as { fileName?: string; dataBase64?: string };
    if (!record.dataBase64) return { status: 400, payload: { error: "Missing file data." } };
    try {
      const loaded = await bufferToWorkbook(Buffer.from(record.dataBase64, "base64"));
      const safeName = path.basename(record.fileName || "Uploaded.xlsx").replace(/[^\w.\- ()]+/g, "");
      const fileName = safeName.toLowerCase().endsWith(".xlsx") ? safeName : `${safeName}.xlsx`;
      return { status: 200, payload: { ...loaded, path: null, fileName, chat: { messages: [] } } };
    } catch {
      return { status: 400, payload: { error: "Could not read that file." } };
    }
  }
  if (method === "POST" && pathname === "/api/save") {
    const record = body as { path?: string; workbook?: Workbook; chat?: ChatFile };
    const filePath = xlsxPath(record.path);
    if (!filePath || !record.workbook) {
      return { status: 400, payload: { error: "Choose a file name ending in .xlsx." } };
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const backup = await backupIfExists(filePath);
    await fs.writeFile(filePath, await workbookToBuffer(record.workbook));
    await fs.writeFile(chatPath(filePath), JSON.stringify(record.chat ?? { messages: [] }, null, 2));
    return { status: 200, payload: { path: filePath, backup } };
  }
  if (method === "GET" && pathname === "/api/settings") {
    return { status: 200, payload: toPublic(await merged.readSettings()) };
  }
  if (method === "POST" && pathname === "/api/settings") {
    const record = body as { provider?: unknown; model?: unknown; apiKey?: unknown };
    return { status: 200, payload: toPublic(await merged.updateSettings(record)) };
  }
  if (method === "GET" && pathname === "/api/models") {
    const result = await merged.listProviderModels(await merged.readSettings());
    return { status: result.status, payload: result.payload };
  }
  if (method === "POST" && pathname === "/api/ai") {
    const result = await merged.completeWithProvider(await merged.readSettings(), body as ChatInput);
    return { status: result.status, payload: result.payload };
  }
  return { status: 404, payload: { error: "Not found." } };
}
