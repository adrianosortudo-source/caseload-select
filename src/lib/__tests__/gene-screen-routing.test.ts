import { describe, expect, it, vi } from "vitest";
import GeneColmanScreenPage, { metadata } from "@/app/tools/screen/gene-colman/page";
import { GeneCurrentScreenMockup } from "@/components/prospect-demo/GeneCurrentScreenMockup";
vi.mock("@/components/prospect-demo/GeneCurrentScreenMockup", () => ({ GeneCurrentScreenMockup: () => null }));

describe("Gene Colman SCREEN preview route", () => {
  it("opens only the shipped sample without an operator library", () => {
    const page = GeneColmanScreenPage();
    expect(page.type).toBe(GeneCurrentScreenMockup);
    expect(page.props).toEqual({});
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
