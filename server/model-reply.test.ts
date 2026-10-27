import { describe, expect, it } from "vitest";
import { modelReplyText } from "./model-reply";

describe("modelReplyText", () => {
  it("uses the reply when the model filled it in", () => {
    expect(modelReplyText({ content: "{\"message\":\"ok\",\"operations\":[]}", reasoning_content: "thinking" })).toBe("{\"message\":\"ok\",\"operations\":[]}");
  });

  it("prefers reasoning when that side has the edits and the reply does not", () => {
    const reply = "{\"message\":\"Done.\",\"operations\":[]}";
    const reasoning = "{\"message\":\"Added a row.\",\"operations\":[{\"op\":\"write_range\",\"start\":\"A2\",\"rows\":[[\"Rent\",1000]]}]}";
    expect(modelReplyText({ content: reply, reasoning_content: reasoning })).toBe(reasoning);
  });

  it("uses the reasoning text when the reply is blank", () => {
    const reasoning = "{\"message\":\"Added Balance.\",\"operations\":[]}";
    expect(modelReplyText({ content: "", reasoning_content: reasoning })).toBe(reasoning);
    expect(modelReplyText({ content: "   ", reasoning_content: reasoning })).toBe(reasoning);
  });

  it("returns null when both parts are empty", () => {
    expect(modelReplyText({ content: "", reasoning_content: "" })).toBeNull();
    expect(modelReplyText(undefined)).toBeNull();
  });
});
