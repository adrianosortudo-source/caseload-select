import { describe, expect, it, vi } from "vitest";
import GeneColmanScreenPage, { metadata } from "@/app/tools/screen/gene-colman/page";
import { ProspectDemoClient } from "@/components/prospect-demo/ProspectDemoClient";
vi.mock("@/components/prospect-demo/ProspectDemoClient", () => ({ ProspectDemoClient: () => null }));

describe("Gene Colman SCREEN preview route", () => {
  it("opens only the shipped sample without an operator library", () => {
    const page = GeneColmanScreenPage();
    expect(page.type).toBe(ProspectDemoClient);
    expect(page.props).toEqual({ profileId: "gene-colman", sampleOnly: true });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
