import { describe, expect, it } from "vitest";
import {
  friendlyProviderError,
  parseProviderErrorBody,
  retryDelaySeconds,
  shouldReduceMaxTokens,
} from "./provider-errors";

describe("provider-errors", () => {
  it("parses Groq rate_limit_exceeded JSON", () => {
    const body = JSON.stringify({
      error: {
        message: "Rate limit reached for model `allam-2-7b`. Please try again in 6.56s.",
        code: "rate_limit_exceeded",
      },
    });
    expect(parseProviderErrorBody(body).code).toBe("rate_limit_exceeded");
    expect(friendlyProviderError("Groq", 429, body)).toMatch(/Wait about 6\.56s/);
    expect(friendlyProviderError("Groq", 429, body)).not.toContain("org_01");
  });

  it("parses Gemini array-shaped 404", () => {
    const body = JSON.stringify([
      {
        error: {
          code: 404,
          message: "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash",
          status: "NOT_FOUND",
        },
      },
    ]);
    const msg = friendlyProviderError("Gemini", 404, body);
    expect(msg).toMatch(/gemini-3\.8-flash/);
    expect(msg).not.toContain("[{");
  });

  it("detects output-token limit errors for max_tokens retry", () => {
    const body = JSON.stringify({
      error: {
        message: "Request too large for model `qwen/qwen3.8-27b` on output tokens per minute (OTPM): Limit 1000, Requested 1091. reduce max_tokens",
        code: "rate_limit_exceeded",
      },
    });
    expect(shouldReduceMaxTokens(429, body)).toBe(true);
    expect(retryDelaySeconds(body, null)).toBe(0);
  });
});
