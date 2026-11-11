import { describe, expect, it } from "vitest";
import { formatUserError, userErrorFromMessage } from "./user-errors";

describe("userErrorFromMessage", () => {
  it("maps Ollama connection refused", () => {
    const err = userErrorFromMessage("connect ECONNREFUSED Ollama on 127.0.0.1");
    expect(err.headline).toMatch(/Ollama/i);
    expect(err.fixSteps.length).toBeGreaterThan(0);
  });

  it("maps API key failures", () => {
    const err = userErrorFromMessage("401 invalid API key");
    expect(err.headline).toMatch(/API key/i);
  });

  it("formats multi-line fix steps", () => {
    const err = userErrorFromMessage("401 invalid API key");
    expect(formatUserError(err)).toMatch(/1\./);
  });
});
