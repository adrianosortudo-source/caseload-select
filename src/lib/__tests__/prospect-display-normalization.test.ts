import { describe, expect, it } from "vitest";
import {
  normalizedCityLabel,
  normalizedPracticeAreaLabel,
  uniqueNormalizedLabels,
} from "../prospect-display-normalization";

describe("prospect display normalization", () => {
  it("consolidates documented city spelling and casing variants", () => {
    expect(uniqueNormalizedLabels(["TORONTO", "toronto", "Toronto", "Mississaauga", "MISSISSAUGA"], normalizedCityLabel)).toEqual(["Mississauga", "Toronto"]);
    expect(normalizedCityLabel("Richmond Hil")).toBe("Richmond Hill");
    expect(normalizedCityLabel("Thronhill")).toBe("Thornhill");
  });

  it("uses stable human labels for equivalent practice-area values", () => {
    expect(uniqueNormalizedLabels(["family", "Family law", "wills_estates", "Wills and estates"], normalizedPracticeAreaLabel)).toEqual(["Family law", "Wills and estates"]);
    expect(normalizedPracticeAreaLabel("Estates")).toBe("Estates");
  });
});
