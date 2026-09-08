import { describe, expect, it } from "vitest";
import { downtownCohortDisposition, isDowntownTorontoCohortEligible } from "@/lib/downtown-toronto-cohort";

const inside = { status: "inside" as const };

describe("Downtown Toronto cohort rules", () => {
  it("requires an inside boundary result and an exact 1–10 lawyer count", () => {
    expect(downtownCohortDisposition({ observedLawyerCount: 4, observedLawyerCountQualifier: "exact" }, inside)).toBe("eligible_for_research");
    expect(isDowntownTorontoCohortEligible({ observedLawyerCount: 10, observedLawyerCountQualifier: "exact" }, inside)).toBe(true);
  });

  it("keeps imprecise geography and roster observations out of the qualified cohort", () => {
    expect(downtownCohortDisposition({ observedLawyerCount: 3, observedLawyerCountQualifier: "at_least" }, inside)).toBe("needs_exact_roster");
    expect(downtownCohortDisposition({ observedLawyerCount: 3, observedLawyerCountQualifier: "exact" }, { status: "needs_manual_review" })).toBe("needs_geography_review");
    expect(downtownCohortDisposition({ observedLawyerCount: 11, observedLawyerCountQualifier: "exact" }, inside)).toBe("outside_size");
  });
});
