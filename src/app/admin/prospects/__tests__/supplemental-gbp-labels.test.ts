import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReconciledProspects, { type RecordsResponse } from "../ReconciledProspects";
import { SYNTHETIC_SUPPLEMENTAL_GBP_PROSPECTS } from "@/app/dev/prospect-qualified-preview/synthetic-supplemental";

describe("supplemental GBP evidence labels", () => {
  it.each([
    [0, "Supported evidence"],
    [1, "Needs evidence"],
    [2, "Not assessed"],
  ] as const)("renders the exact recorded three-state meaning for row %i", (index, label) => {
    const html = renderToStaticMarkup(createElement<{ initialData?: RecordsResponse }>(ReconciledProspects, { initialData: { records: [SYNTHETIC_SUPPLEMENTAL_GBP_PROSPECTS[index]], source: "fixture" } }));
    expect(html).toContain("GBP: " + label);
    for (const other of ["Supported evidence", "Needs evidence", "Not assessed"].filter(value => value !== label)) {
      expect(html).not.toContain("GBP: " + other);
    }
  });
});
