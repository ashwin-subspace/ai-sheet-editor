import { describe, expect, it } from "vitest";
import {
  CURATED_DROPDOWN_MAX,
  isCuratedSheetModel,
  listCuratedModels,
  pickDefaultModel,
  shouldAutoSwitchModel,
} from "./sheet-models";

describe("curated models", () => {
  const ollamaIds = [
    "nemotron-3-nano:4b",
    "llama3.1:8b",
    "llama3.2:latest",
    "nomic-embed-text",
    "whisper-large",
    "qwen2.5:7b",
  ];

  it("excludes embed and whisper from curated Ollama list", () => {
    const curated = listCuratedModels(ollamaIds, "ollama");
    expect(curated).not.toContain("nomic-embed-text");
    expect(curated).not.toContain("whisper-large");
    expect(curated.length).toBeLessThanOrEqual(CURATED_DROPDOWN_MAX);
  });

  it("prefers llama over nano for default", () => {
    expect(pickDefaultModel(ollamaIds, "ollama")).toMatch(/llama3/i);
    expect(shouldAutoSwitchModel("nemotron-3-nano:4b", "ollama")).toBe(true);
    expect(isCuratedSheetModel("llama3.1:8b", "ollama")).toBe(true);
  });

  it("returns empty curated when only bad models exist", () => {
    expect(listCuratedModels(["whisper-large", "nomic-embed-text"], "ollama")).toEqual([]);
  });
});
