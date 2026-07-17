import { describe, it, expect } from "vitest";
import {
  deriveObservedEvidence,
  compareAttributionStatePriority,
  countByAttributionState,
  emptyAttributionStateCounts,
  hasSufficientSampleSize,
  buildClientSafeAttributionSentences,
  MIN_SAMPLE_FOR_OBSERVATION,
} from "@/lib/content-attribution-pure";

const PLACEMENT_A = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", deliverableId: "d-1" };
const PLACEMENT_B = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", deliverableId: "d-2" };

describe("deriveObservedEvidence", () => {
  it("returns null when there is nothing to normalize", () => {
    const result = deriveObservedEvidence(
      {
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
        referrer: null,
        observedAt: "2026-07-01T00:00:00Z",
      },
      [],
    );
    expect(result).toBeNull();
  });

  it("normalizes UTM data as verified_utm, known_first_touch, unlinked when no placement match", () => {
    const result = deriveObservedEvidence(
      {
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
        referrer: null,
        observedAt: "2026-07-01T00:00:00Z",
      },
      [PLACEMENT_A],
    );
    expect(result).not.toBeNull();
    expect(result?.evidenceMethod).toBe("verified_utm");
    expect(result?.attributionState).toBe("known_first_touch");
    expect(result?.deliverableId).toBeNull();
    expect(result?.placementId).toBeNull();
  });

  it("normalizes referrer-only data as observed_referrer", () => {
    const result = deriveObservedEvidence(
      {
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
        referrer: "https://www.linkedin.com/",
        observedAt: "2026-07-01T00:00:00Z",
      },
      [],
    );
    expect(result?.evidenceMethod).toBe("observed_referrer");
  });

  it("links a placement only on an exact utm_content match against a real placement id", () => {
    const result = deriveObservedEvidence(
      {
        utmSource: "linkedin",
        utmMedium: "social",
        utmCampaign: null,
        utmTerm: null,
        utmContent: PLACEMENT_A.id,
        referrer: null,
        observedAt: "2026-07-01T00:00:00Z",
      },
      [PLACEMENT_A, PLACEMENT_B],
    );
    expect(result?.deliverableId).toBe(PLACEMENT_A.deliverableId);
    expect(result?.placementId).toBe(PLACEMENT_A.id);
  });

  it("links a placement on an exact utm_term match", () => {
    const result = deriveObservedEvidence(
      {
        utmSource: "linkedin",
        utmMedium: "social",
        utmCampaign: null,
        utmTerm: PLACEMENT_B.id,
        utmContent: null,
        referrer: null,
        observedAt: "2026-07-01T00:00:00Z",
      },
      [PLACEMENT_A, PLACEMENT_B],
    );
    expect(result?.placementId).toBe(PLACEMENT_B.id);
  });

  it("never invents a placement link on a near-miss (no fuzzy matching)", () => {
    const result = deriveObservedEvidence(
      {
        utmSource: "linkedin",
        utmMedium: "social",
        utmCampaign: null,
        utmTerm: null,
        utmContent: `${PLACEMENT_A.id}-extra`,
        referrer: null,
        observedAt: "2026-07-01T00:00:00Z",
      },
      [PLACEMENT_A],
    );
    expect(result?.deliverableId).toBeNull();
    expect(result?.placementId).toBeNull();
  });

  it("preserves the raw utm/referrer values in evidencePayload without inventing fields", () => {
    const result = deriveObservedEvidence(
      {
        utmSource: "google",
        utmMedium: "organic",
        utmCampaign: "spring",
        utmTerm: null,
        utmContent: null,
        referrer: "https://google.com/search",
        observedAt: "2026-07-01T00:00:00Z",
      },
      [],
    );
    expect(result?.evidencePayload).toEqual({
      utm_source: "google",
      utm_medium: "organic",
      utm_campaign: "spring",
      utm_term: null,
      utm_content: null,
      referrer: "https://google.com/search",
    });
  });
});

describe("compareAttributionStatePriority", () => {
  it("ranks known_first_touch highest and unknown lowest", () => {
    expect(compareAttributionStatePriority("known_first_touch", "unknown")).toBeLessThan(0);
    expect(compareAttributionStatePriority("unknown", "known_first_touch")).toBeGreaterThan(0);
    expect(compareAttributionStatePriority("self_reported", "offline_referral")).toBeLessThan(0);
  });
});

describe("countByAttributionState", () => {
  it("tallies rows by attribution_state, starting from zero for unseen states", () => {
    const counts = countByAttributionState([
      { attribution_state: "known_first_touch" },
      { attribution_state: "known_first_touch" },
      { attribution_state: "self_reported" },
    ]);
    expect(counts).toEqual({
      ...emptyAttributionStateCounts(),
      known_first_touch: 2,
      self_reported: 1,
    });
  });
});

describe("hasSufficientSampleSize", () => {
  it("matches the documented minimum", () => {
    expect(hasSufficientSampleSize(MIN_SAMPLE_FOR_OBSERVATION - 1)).toBe(false);
    expect(hasSufficientSampleSize(MIN_SAMPLE_FOR_OBSERVATION)).toBe(true);
  });
});

describe("buildClientSafeAttributionSentences", () => {
  it("returns no sentences for all-zero counts", () => {
    expect(buildClientSafeAttributionSentences(emptyAttributionStateCounts())).toEqual([]);
  });

  it("never claims a client was generated -- only an evidence-graded connection", () => {
    const sentences = buildClientSafeAttributionSentences({
      known_first_touch: 2,
      known_assisted: 0,
      self_reported: 1,
      offline_referral: 0,
      unknown: 3,
    });
    for (const s of sentences) {
      expect(s.toLowerCase()).not.toContain("generated");
      expect(s.toLowerCase()).not.toContain("client");
    }
    expect(sentences.some((s) => s.includes("2 enquiries have an observed connection"))).toBe(true);
    expect(sentences.some((s) => s.includes("1 enquiry has a self-reported connection"))).toBe(true);
    expect(sentences.some((s) => s.includes("3 additional enquiries have insufficient evidence"))).toBe(true);
  });

  it("uses singular phrasing for a count of one", () => {
    const sentences = buildClientSafeAttributionSentences({
      ...emptyAttributionStateCounts(),
      self_reported: 1,
    });
    expect(sentences[0]).toBe("1 enquiry has a self-reported connection to this content.");
  });
});
