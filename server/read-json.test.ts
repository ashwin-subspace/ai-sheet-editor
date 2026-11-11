import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type http from "node:http";
import { readJson } from "./read-json";

function mockRequest(chunks: Buffer[]): http.IncomingMessage {
  const req = new EventEmitter() as http.IncomingMessage;
  queueMicrotask(() => {
    for (const chunk of chunks) req.emit("data", chunk);
    req.emit("end");
  });
  return req;
}

describe("readJson", () => {
  it("rejects bodies larger than 20 MB", async () => {
    const huge = Buffer.alloc(20_000_001);
    const req = mockRequest([huge]);
    await expect(readJson(req)).rejects.toThrow(/20 MB/);
  });
});
