import { describe, expect, it } from "vitest";
import { formatRateLimitSummary, parseRateLimitHeaders, usageNoteFromResponse } from "./rate-limits";

function headers(map: Record<string, string>): Headers {
  return new Headers(map);
}

describe("rate-limits", () => {
  it("parses Groq-style x-ratelimit headers", () => {
    const limits = parseRateLimitHeaders(
      headers({
        "x-ratelimit-remaining-requests": "14370",
        "x-ratelimit-limit-requests": "14400",
        "x-ratelimit-reset-requests": "2m59.56s",
        "x-ratelimit-remaining-tokens": "17997",
        "x-ratelimit-limit-tokens": "18000",
        "x-ratelimit-reset-tokens": "7.66s",
      }),
    );
    expect(limits.remainingRequests).toBe(14370);
    expect(limits.limitRequests).toBe(14400);
    expect(limits.remainingTokens).toBe(17997);
    expect(formatRateLimitSummary(limits)).toMatch(/14,370 requests left today/);
    expect(formatRateLimitSummary(limits)).toMatch(/17,997 tokens\/min left/);
  });

  it("returns empty summary when headers are absent", () => {
    expect(formatRateLimitSummary(parseRateLimitHeaders(headers({})))).toBe("");
    expect(usageNoteFromResponse({ headers: headers({}) })).toBe("");
  });

  it("supports partial header sets", () => {
    const note = formatRateLimitSummary(parseRateLimitHeaders(headers({ "x-ratelimit-remaining-tokens": "500" })));
    expect(note).toBe("~500 tokens/min left");
  });
});
