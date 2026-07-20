import { describe, it, expect } from "vitest";
import {
  resolveDestinationIdentity,
  type ConfiguredDestinationIdentity,
  type ObservedExternalIdentity,
} from "../destination-identity";

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

function activeIdentity(overrides: Partial<ConfiguredDestinationIdentity> = {}): ConfiguredDestinationIdentity {
  return {
    firmId: FIRM_ID,
    platform: "linkedin",
    accountOrLocationId: "urn:li:organization:drg-law-company-page",
    destinationSurface: "linkedin_company_page_profile",
    status: "active",
    hasAuthorizedHistoryAccess: true,
    ...overrides,
  };
}

describe("resolveDestinationIdentity — no configured identity", () => {
  it("no configured identity at all -> destination_identity_unresolved, with no substitute lookup", () => {
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "linkedin",
      versionId: "v1",
      configuredIdentity: null,
      observedIdentity: null,
    });
    expect(result.kind).toBe("destination_identity_unresolved");
    expect(result.canVerifyPublished).toBe(false);
    expect(result.canDeclareAbsent).toBe(false);
    expect(result.evidenceSourceConsulted).toBeNull();
    expect(result.reason).toMatch(/No destination identity is configured/);
    expect(result.reason).toMatch(/Never substitute/);
  });

  it("even when an observedIdentity is somehow supplied, an unconfigured firm still resolves unresolved -- never a substitute match", () => {
    const observed: ObservedExternalIdentity = {
      platform: "linkedin",
      accountOrLocationId: "urn:li:organization:drg-law-company-page",
      surface: "linkedin_company_page_profile",
    };
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "linkedin",
      versionId: "v1",
      configuredIdentity: null,
      observedIdentity: observed,
    });
    expect(result.kind).toBe("destination_identity_unresolved");
  });

  it("inactive configured identity -> destination_identity_unresolved, distinct reason naming the actual status", () => {
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "linkedin",
      versionId: "v1",
      configuredIdentity: activeIdentity({ status: "inactive" }),
      observedIdentity: null,
    });
    expect(result.kind).toBe("destination_identity_unresolved");
    expect(result.reason).toMatch(/"inactive"/);
  });

  it("revoked configured identity -> destination_identity_unresolved, distinct reason naming the actual status", () => {
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "google_business_profile",
      versionId: "v1",
      configuredIdentity: activeIdentity({ platform: "google_business_profile", status: "revoked" }),
      observedIdentity: null,
    });
    expect(result.kind).toBe("destination_identity_unresolved");
    expect(result.reason).toMatch(/"revoked"/);
  });

  it("configuredIdentity belongs to a DIFFERENT firm than the one being evaluated -> destination_identity_unresolved, never confirmed merely because SOME record was supplied", () => {
    const otherFirmId = "11111111-1111-1111-1111-111111111111";
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "linkedin",
      versionId: "v1",
      configuredIdentity: activeIdentity({ firmId: otherFirmId }),
      observedIdentity: null,
    });
    expect(result.kind).toBe("destination_identity_unresolved");
    expect(result.canVerifyPublished).toBe(false);
    expect(result.canDeclareAbsent).toBe(false);
    expect(result.evidenceSourceConsulted).toBeNull();
    expect(result.reason).toMatch(new RegExp(otherFirmId));
    expect(result.reason).toMatch(new RegExp(FIRM_ID));
  });

  it("configuredIdentity is configured for a DIFFERENT platform than the one being evaluated -> destination_identity_unresolved, even with no observedIdentity to catch the mismatch downstream", () => {
    // No observedIdentity supplied -- the caller is only asking "may I
    // proceed," which is exactly the case a platform-mismatched record
    // must not silently clear, since there is no downstream comparison to
    // catch it otherwise.
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "linkedin",
      versionId: "v1",
      configuredIdentity: activeIdentity({ platform: "google_business_profile" }),
      observedIdentity: null,
    });
    expect(result.kind).toBe("destination_identity_unresolved");
    expect(result.canVerifyPublished).toBe(false);
    expect(result.canDeclareAbsent).toBe(false);
    expect(result.reason).toMatch(/"google_business_profile"/);
    expect(result.reason).toMatch(/"linkedin"/);
  });

  it("wrong-firm and wrong-platform checks run BEFORE status/history, so an inactive or history-incapable record for the wrong firm/platform still reports the identity mismatch, not the status/history reason", () => {
    const otherFirmId = "11111111-1111-1111-1111-111111111111";
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "linkedin",
      versionId: "v1",
      configuredIdentity: activeIdentity({ firmId: otherFirmId, status: "inactive", hasAuthorizedHistoryAccess: false }),
      observedIdentity: null,
    });
    expect(result.kind).toBe("destination_identity_unresolved");
    expect(result.reason).not.toMatch(/"inactive"/);
    expect(result.reason).toMatch(new RegExp(otherFirmId));
  });
});

describe("resolveDestinationIdentity — history access", () => {
  it("known, active target but no authorized manager/API history access -> external_history_unavailable, not 'unpublished'", () => {
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "google_business_profile",
      versionId: "v1",
      configuredIdentity: activeIdentity({
        platform: "google_business_profile",
        accountOrLocationId: "locations/1234567890",
        destinationSurface: "google_business_profile_location",
        hasAuthorizedHistoryAccess: false,
      }),
      observedIdentity: null,
    });
    expect(result.kind).toBe("external_history_unavailable");
    expect(result.canVerifyPublished).toBe(false);
    expect(result.canDeclareAbsent).toBe(false);
    expect(result.evidenceSourceConsulted).toBeNull();
    expect(result.reason).toMatch(/public listing or page view/);
    expect(result.reason).not.toMatch(/unpublished/);
  });

  it("history access unavailable takes priority over a mismatched observed identity -- the more fundamental gap is reported", () => {
    const mismatched: ObservedExternalIdentity = {
      platform: "google_business_profile",
      accountOrLocationId: "locations/9999999999",
      surface: "google_business_profile_location",
    };
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "google_business_profile",
      versionId: "v1",
      configuredIdentity: activeIdentity({
        platform: "google_business_profile",
        accountOrLocationId: "locations/1234567890",
        destinationSurface: "google_business_profile_location",
        hasAuthorizedHistoryAccess: false,
      }),
      observedIdentity: mismatched,
    });
    expect(result.kind).toBe("external_history_unavailable");
  });
});

describe("resolveDestinationIdentity — target mismatch", () => {
  it("LinkedIn: a personal profile observed where the configured target is the Company Page -> external_verification_target_mismatch, never 'absent'", () => {
    const personalProfile: ObservedExternalIdentity = {
      platform: "linkedin",
      accountOrLocationId: "urn:li:person:damaris-guimaraes",
      surface: "linkedin_personal_profile",
    };
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "linkedin",
      versionId: "v1",
      configuredIdentity: activeIdentity(),
      observedIdentity: personalProfile,
    });
    expect(result.kind).toBe("external_verification_target_mismatch");
    expect(result.canVerifyPublished).toBe(false);
    expect(result.canDeclareAbsent).toBe(false);
    expect(result.reason).toMatch(/does not exactly match/);
    expect(result.reason.toLowerCase()).not.toContain("absent");
  });

  it("Google Business Profile: a different location id observed than the configured one -> external_verification_target_mismatch", () => {
    const wrongLocation: ObservedExternalIdentity = {
      platform: "google_business_profile",
      accountOrLocationId: "locations/0000000000",
      surface: "google_business_profile_location",
    };
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "google_business_profile",
      versionId: "v1",
      configuredIdentity: activeIdentity({
        platform: "google_business_profile",
        accountOrLocationId: "locations/1234567890",
        destinationSurface: "google_business_profile_location",
      }),
      observedIdentity: wrongLocation,
    });
    expect(result.kind).toBe("external_verification_target_mismatch");
  });

  it("same account, but the wrong surface within it (e.g. company page profile vs. native article surface) -> mismatch", () => {
    const wrongSurface: ObservedExternalIdentity = {
      platform: "linkedin",
      accountOrLocationId: "urn:li:organization:drg-law-company-page",
      surface: "linkedin_native_article",
    };
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "linkedin",
      versionId: "v1",
      configuredIdentity: activeIdentity({ destinationSurface: "linkedin_company_page_profile" }),
      observedIdentity: wrongSurface,
    });
    expect(result.kind).toBe("external_verification_target_mismatch");
  });
});

describe("resolveDestinationIdentity — confirmed, the only positive path", () => {
  it("exact match on account and surface, with authorized history access -> destination_identity_confirmed, both capability flags true", () => {
    const exactMatch: ObservedExternalIdentity = {
      platform: "linkedin",
      accountOrLocationId: "urn:li:organization:drg-law-company-page",
      surface: "linkedin_company_page_profile",
    };
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "linkedin",
      versionId: "v1",
      configuredIdentity: activeIdentity(),
      observedIdentity: exactMatch,
    });
    expect(result.kind).toBe("destination_identity_confirmed");
    expect(result.canVerifyPublished).toBe(true);
    expect(result.canDeclareAbsent).toBe(true);
    expect(result.evidenceSourceConsulted).toMatch(/authorized manager\/API history surface/);
  });

  it("no observation attempted yet, but identity is fully configured and history-capable -> also confirmed (clears the caller to query, not a query result itself)", () => {
    const result = resolveDestinationIdentity({
      firmId: FIRM_ID,
      platform: "linkedin",
      versionId: "v1",
      configuredIdentity: activeIdentity(),
      observedIdentity: null,
    });
    expect(result.kind).toBe("destination_identity_confirmed");
    expect(result.canVerifyPublished).toBe(true);
    expect(result.canDeclareAbsent).toBe(true);
  });

  it("only destination_identity_confirmed ever sets both capability flags true -- every other kind sets both false", () => {
    const cases: Array<[typeof resolveDestinationIdentity extends (i: infer I) => unknown ? I : never, string]> = [
      [{ firmId: FIRM_ID, platform: "linkedin", versionId: "v1", configuredIdentity: null, observedIdentity: null }, "destination_identity_unresolved"],
      [
        {
          firmId: FIRM_ID,
          platform: "linkedin",
          versionId: "v1",
          configuredIdentity: activeIdentity({ hasAuthorizedHistoryAccess: false }),
          observedIdentity: null,
        },
        "external_history_unavailable",
      ],
      [
        {
          firmId: FIRM_ID,
          platform: "linkedin",
          versionId: "v1",
          configuredIdentity: activeIdentity(),
          observedIdentity: { platform: "linkedin", accountOrLocationId: "urn:li:person:someone-else", surface: "linkedin_personal_profile" },
        },
        "external_verification_target_mismatch",
      ],
    ];
    for (const [input, expectedKind] of cases) {
      const result = resolveDestinationIdentity(input);
      expect(result.kind).toBe(expectedKind);
      expect(result.canVerifyPublished).toBe(false);
      expect(result.canDeclareAbsent).toBe(false);
    }
  });
});
