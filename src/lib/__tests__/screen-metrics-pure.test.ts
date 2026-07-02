import { describe, it, expect } from "vitest";
import { computeScreenMetrics, type MetricsRow } from "@/lib/screen-metrics-pure";

function row(overrides: Partial<MetricsRow> = {}): MetricsRow {
  return {
    band: "B",
    status: "declined",
    matter_type: "corporate_general",
    channel: "web",
    score_confidence: "high",
    score_completeness: 0.9,
    matter_type_provenance: "deterministic",
    missing_field_count: 0,
    utm_source: null,
    submitted_at: "2026-06-01T00:00:00.000Z",
    status_changed_at: "2026-06-02T00:00:00.000Z",
    question_count: 10,
    ...overrides,
  };
}

describe("computeScreenMetrics", () => {
  it("computes contact-capture rate from leads vs unconfirmed inquiries", () => {
    const m = computeScreenMetrics([row(), row(), row()], 1);
    expect(m.totalLeads).toBe(3);
    expect(m.unconfirmedCount).toBe(1);
    expect(m.contactCaptureRate).toBeCloseTo(0.75, 5);
  });

  it("returns null contact-capture rate when there is no data at all", () => {
    const m = computeScreenMetrics([], 0);
    expect(m.contactCaptureRate).toBeNull();
  });

  it("buckets band distribution including unrated (null band)", () => {
    const m = computeScreenMetrics(
      [row({ band: "A" }), row({ band: "A" }), row({ band: "D" }), row({ band: null })],
      0,
    );
    expect(m.bandDistribution.A).toBe(2);
    expect(m.bandDistribution.D).toBe(1);
    expect(m.bandDistribution.unrated).toBe(1);
    expect(m.bandDistribution.B).toBe(0);
  });

  it("cross-tabs action by band (take/pass/refer/declined/triaging)", () => {
    const m = computeScreenMetrics(
      [
        row({ band: "A", status: "taken" }),
        row({ band: "A", status: "declined" }),
        row({ band: "D", status: "referred" }),
      ],
      0,
    );
    expect(m.actionByBand.A.taken).toBe(1);
    expect(m.actionByBand.A.declined).toBe(1);
    expect(m.actionByBand.D.referred).toBe(1);
  });

  it("computes thin-brief rate only over confidence-scored rows", () => {
    const m = computeScreenMetrics(
      [
        row({ score_confidence: "low" }),
        row({ score_confidence: "low" }),
        row({ score_confidence: "high" }),
        row({ score_confidence: null }), // excluded from denominator
      ],
      0,
    );
    expect(m.thinBriefScoredCount).toBe(3);
    expect(m.thinBriefRate).toBeCloseTo(2 / 3, 5);
  });

  it("computes inferred-classification rate only over provenance-tagged rows", () => {
    const m = computeScreenMetrics(
      [
        row({ matter_type_provenance: "llm_inferred" }),
        row({ matter_type_provenance: "deterministic" }),
        row({ matter_type_provenance: "user_routing_answer" }),
        row({ matter_type_provenance: null }),
      ],
      0,
    );
    expect(m.provenanceTaggedCount).toBe(3);
    expect(m.inferredClassificationRate).toBeCloseTo(1 / 3, 5);
  });

  it("computes missing-critical-fact rate over completeness-scored rows", () => {
    const m = computeScreenMetrics(
      [
        row({ score_completeness: 0.9, missing_field_count: 0 }),
        row({ score_completeness: 0.2, missing_field_count: 3 }),
        row({ score_completeness: null, missing_field_count: 5 }), // excluded
      ],
      0,
    );
    expect(m.missingCriticalFactRate).toBeCloseTo(0.5, 5);
  });

  it("surfaces the channel questions-asked gap (audit F2/F6)", () => {
    const m = computeScreenMetrics(
      [
        row({ channel: "web", question_count: 18 }),
        row({ channel: "web", question_count: 10 }),
        row({ channel: "voice", question_count: 0 }),
        row({ channel: "voice", question_count: 0 }),
      ],
      0,
    );
    const web = m.channelMix.find((c) => c.channel === "web")!;
    const voice = m.channelMix.find((c) => c.channel === "voice")!;
    expect(web.avgQuestionsAsked).toBeCloseTo(14, 5);
    expect(voice.avgQuestionsAsked).toBe(0);
  });

  it("treats null channel as web (matches slot_answers hydration default)", () => {
    const m = computeScreenMetrics([row({ channel: null })], 0);
    expect(m.channelMix.find((c) => c.channel === "web")?.count).toBe(1);
  });

  it("computes band A/B rate per channel and per utm source", () => {
    const m = computeScreenMetrics(
      [
        row({ channel: "web", band: "A", utm_source: "google" }),
        row({ channel: "web", band: "C", utm_source: "google" }),
        row({ channel: "voice", band: "C", utm_source: null }),
      ],
      0,
    );
    const web = m.channelMix.find((c) => c.channel === "web")!;
    expect(web.bandARate).toBeCloseTo(0.5, 5);
    const google = m.sourceQuality.find((s) => s.source === "google")!;
    expect(google.bandABRate).toBeCloseTo(0.5, 5);
    const none = m.sourceQuality.find((s) => s.source === "none")!;
    expect(none.count).toBe(1);
  });

  it("computes average response hours only over decided (non-triaging) rows with a status_changed_at", () => {
    const m = computeScreenMetrics(
      [
        row({
          status: "taken",
          submitted_at: "2026-06-01T00:00:00.000Z",
          status_changed_at: "2026-06-01T12:00:00.000Z",
        }),
        row({
          status: "declined",
          submitted_at: "2026-06-01T00:00:00.000Z",
          status_changed_at: "2026-06-03T00:00:00.000Z",
        }),
        row({ status: "triaging", status_changed_at: null }), // excluded
      ],
      0,
    );
    expect(m.decidedCount).toBe(2);
    expect(m.avgResponseHours).toBeCloseTo((12 + 48) / 2, 5);
  });

  it("ignores a status_changed_at that predates submitted_at (bad data guard)", () => {
    const m = computeScreenMetrics(
      [
        row({
          status: "declined",
          submitted_at: "2026-06-02T00:00:00.000Z",
          status_changed_at: "2026-06-01T00:00:00.000Z",
        }),
      ],
      0,
    );
    expect(m.decidedCount).toBe(0);
    expect(m.avgResponseHours).toBeNull();
  });

  it("returns all-null rates on a fully empty dataset without throwing", () => {
    const m = computeScreenMetrics([], 5);
    expect(m.thinBriefRate).toBeNull();
    expect(m.inferredClassificationRate).toBeNull();
    expect(m.missingCriticalFactRate).toBeNull();
    expect(m.avgResponseHours).toBeNull();
    expect(m.channelMix).toEqual([]);
    expect(m.sourceQuality).toEqual([]);
  });
});
