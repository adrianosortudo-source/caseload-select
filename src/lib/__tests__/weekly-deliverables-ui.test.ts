import { describe, expect, it } from "vitest";
import {
  canonicalFormat,
  groupByCanonicalFormat,
  languageLabel,
  periodFormatAnchorId,
  type PlanDeliverable,
} from "@/lib/deliverables-pure";
import { buildContentArchiveIndex, searchContentArchive } from "@/lib/content-archive-pure";
import {
  isCompleteStrategyBrief,
  strategyBriefFieldValue,
} from "@/lib/strategy-brief";
import type { ContentPeriod, StrategyBrief } from "@/lib/types";

function deliverable(overrides: Partial<PlanDeliverable> = {}): PlanDeliverable {
  return {
    id: "d-1",
    title: "Untitled deliverable",
    kicker: null,
    status: "in_review",
    content_kind: "text",
    format: null,
    locale: null,
    deliverable_role: null,
    publication_destination: null,
    period_id: "p-1",
    publish_date: null,
    published_at: null,
    requires_individual_review: true,
    ...overrides,
  };
}

function period(overrides: Partial<ContentPeriod> = {}): ContentPeriod {
  return {
    id: "p-1",
    firm_id: "firm-a",
    starts_on: "2026-07-01",
    ends_on: "2026-07-07",
    week_number: 1,
    theme: "Selling a business from leased premises",
    details: "Legacy details remain stored.",
    rationale: "Legacy rationale remains stored.",
    strategyBrief: null,
    sort_index: 0,
    created_at: "2026-07-01T00:00:00Z",
    created_by_role: "operator",
    created_by_id: null,
    updated_at: null,
    readiness_lifecycle: "setup_required",
    ...overrides,
  } as ContentPeriod;
}

describe("weekly deliverables primary slice", () => {
  it("maps every expected alias and metadata destination to the canonical format", () => {
    expect(canonicalFormat({ format: "Counsel Note", locale: "en-CA", deliverable_role: null, publication_destination: null })).toBe("Website articles");
    expect(canonicalFormat({ format: "Análise Jurídica", locale: "pt-BR", deliverable_role: null, publication_destination: null })).toBe("Website articles");
    expect(canonicalFormat({ format: "LinkedIn variation", locale: "en-CA", deliverable_role: null, publication_destination: null })).toBe("LinkedIn");
    expect(canonicalFormat({ format: "anything", locale: "en-CA", deliverable_role: null, publication_destination: "Google Business Profile" })).toBe("Google Business Profile");
    expect(canonicalFormat({ format: "Preparation Artifact", locale: "en-CA", deliverable_role: null, publication_destination: null })).toBe("Checklists & downloadable resources");
    expect(canonicalFormat({ format: "DRG Law Minute", locale: "en-CA", deliverable_role: null, publication_destination: null })).toBe("Email");
    expect(canonicalFormat({ format: "LinkedIn", locale: "en-CA", deliverable_role: "article", publication_destination: "website" })).toBe("Website articles");
  });

  it("keeps unknown formats visible in Other", () => {
    const item = deliverable({ id: "unknown", format: "New channel" });
    expect(groupByCanonicalFormat([item])).toEqual([{ format: "Other", items: [item] }]);
  });

  it("orders explicit bilingual subtypes without comparing titles", () => {
    const grouped = groupByCanonicalFormat([
      deliverable({ id: "pt-clause", format: "Cláusula Comentada", locale: "pt-BR", title: "Completely unrelated title" }),
      deliverable({ id: "en-counsel", format: "Counsel Note", locale: "en-CA" }),
      deliverable({ id: "pt-counsel", format: "Análise Jurídica", locale: "pt-BR" }),
      deliverable({ id: "en-clause", format: "Clause in the Margin", locale: "en-CA" }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].format).toBe("Website articles");
    expect(grouped[0].items.map((item) => item.id)).toEqual([
      "en-counsel",
      "pt-counsel",
      "en-clause",
      "pt-clause",
    ]);
  });

  it("derives compact language labels and unique period-scoped anchors", () => {
    expect(languageLabel("en-CA")).toBe("EN");
    expect(languageLabel("pt-BR")).toBe("PT");
    expect(languageLabel("fr-FR")).toBe("FR-FR");
    expect(periodFormatAnchorId("p-1", "Email")).not.toBe(periodFormatAnchorId("p-2", "Email"));
  });

  it("uses completed strategy values and explanatory guidance for incomplete fields", () => {
    const brief = { readerAndSituation: "A real reader." } as StrategyBrief;
    expect(isCompleteStrategyBrief(brief)).toBe(false);
    expect(strategyBriefFieldValue(brief, "readerAndSituation")).toEqual({ value: "A real reader.", complete: true });
    expect(strategyBriefFieldValue(brief, "whyThisWeek").complete).toBe(false);
    expect(strategyBriefFieldValue(brief, "whyThisWeek").value).toContain("Why the subject matters now");
  });

  it("searches multiple periods only within the current firm", () => {
    const entries = buildContentArchiveIndex(
      "firm-a",
      [period(), period({ id: "p-2", week_number: 2, theme: "Renewal clause" })],
      [
        deliverable({ id: "a", period_id: "p-1", title: "Business sale checklist", format: "Lead Magnet" }),
        deliverable({ id: "b", period_id: "p-2", title: "Renewal clause GBP post", format: "GBP Post", publication_destination: "Google Business Profile" }),
      ],
    );
    expect(searchContentArchive(entries, "firm-a", { query: "renewal" }).map((entry) => entry.deliverable.id)).toEqual(["b"]);
    expect(searchContentArchive([...entries, { ...entries[0], firmId: "firm-b", deliverable: { ...entries[0].deliverable, id: "other-firm" } }], "firm-a", { query: "business" }).map((entry) => entry.deliverable.id)).toEqual(["a"]);
  });

  it("preserves row identity and existing delivery metadata through grouping", () => {
    const item = deliverable({ id: "preserve", status: "approved", published_at: "2026-07-01T12:00:00Z", format: "GBP Post" });
    const grouped = groupByCanonicalFormat([item]);
    expect(grouped[0].items[0]).toMatchObject({ id: "preserve", status: "approved", published_at: "2026-07-01T12:00:00Z" });
  });
});
