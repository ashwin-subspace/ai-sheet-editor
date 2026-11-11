import { describe, expect, it, vi } from "vitest";
import { checkEngineLocally, runClientReadiness } from "./readiness";

describe("checkEngineLocally", () => {
  it("passes SAMPLE_EDIT", () => {
    expect(checkEngineLocally()).toBe(true);
  });
});

describe("runClientReadiness", () => {
  it("reports helper down when health fails", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "/api/health") return new Response("", { status: 503 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await runClientReadiness(fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.helperUp).toBe(false);
    expect(result.issues.some((i) => i.code === "helper")).toBe(true);
  });

  it("is ok when health and ready succeed", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "/api/health") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (url === "/api/ready") return new Response(JSON.stringify({ ok: true, issues: [] }), { status: 200 });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const result = await runClientReadiness(fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
