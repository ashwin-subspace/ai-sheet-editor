import type http from "node:http";

export function readJson<T>(req: http.IncomingMessage, maxBytes = 20_000_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Upload is larger than 20 MB."));
        if (typeof req.destroy === "function") req.destroy();
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
