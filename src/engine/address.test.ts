import { describe, expect, it } from "vitest";
import {
  normalizeSelection,
  parseAddress,
  parseAddressLoose,
  parseRange,
  parseRangeLoose,
} from "./address";

describe("address parsing", () => {
  it("accepts lowercase and normalizes through parseAddress", () => {
    expect(parseAddress("a1")).toEqual({ col: 1, row: 1 });
    expect(parseAddress("A1")).toEqual({ col: 1, row: 1 });
  });

  it("rejects out-of-sheet addresses", () => {
    expect(parseAddress("AA1")).toBeNull();
    expect(parseAddress("A0")).toBeNull();
    expect(parseAddress("A201")).toBeNull();
    expect(parseAddress("")).toBeNull();
  });

  it("parses loose addresses beyond the sheet cap", () => {
    expect(parseAddressLoose("AA1")).toEqual({ col: 27, row: 1 });
    expect(parseAddressLoose("A201")).toEqual({ col: 1, row: 201 });
  });

  it("normalizes inverted ranges", () => {
    expect(parseRange("C3:A1")).toEqual({ c1: 1, r1: 1, c2: 3, r2: 3 });
    expect(parseRangeLoose("Z200:A1")).toEqual({ c1: 1, r1: 1, c2: 26, r2: 200 });
  });

  it("rejects ranges outside the sheet", () => {
    expect(parseRange("A1:AA2")).toBeNull();
    expect(parseRange("A1:A0")).toBeNull();
  });

  it("normalizes selection only when both corners are in bounds", () => {
    expect(normalizeSelection("B2", "D4")).toEqual({ c1: 2, r1: 2, c2: 4, r2: 4 });
    expect(normalizeSelection("A1", "AA1")).toBeNull();
  });
});
