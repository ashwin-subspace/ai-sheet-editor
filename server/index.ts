import http from "node:http";
import path from "node:path";
import { dispatchRoute } from "./handler";
import { readJson } from "./read-json";
import { settingsPath } from "./settings-store";

const PORT = 8787;
const defaultDirectory = process.env.WORKBOOK_DIR
  ? path.resolve(process.env.WORKBOOK_DIR)
  : path.join(process.cwd(), "workbooks");

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const needsBody = req.method === "POST";
    const body = needsBody ? await readJson(req) : undefined;
    const result = await dispatchRoute(
      req.method ?? "GET",
      url.pathname,
      url.searchParams,
      body,
      { defaultDirectory },
    );
    send(res, result.status, result.payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The file helper failed.";
    send(res, 500, { error: message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`File helper listening on http://127.0.0.1:${PORT}`);
  console.log(`Model settings: ${settingsPath}`);
  console.log(`Workbook folder: ${defaultDirectory}`);
});

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
