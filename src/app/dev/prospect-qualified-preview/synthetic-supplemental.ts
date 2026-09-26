import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";

// Synthetic local-preview-only states. The Zarei fixture uses its verified
// production identity pair so the acceptance check protects the exact lookup.
export const SYNTHETIC_SUPPLEMENTAL_GBP_PROSPECTS: ReconciledGtaProspect[] = [
  { id: "synthetic-gbp-supported", firmName: "Synthetic GBP supported", value: true, originalStatus: "held" },
  { id: "synthetic-gbp-needs", firmName: "Synthetic GBP needs evidence", value: false, originalStatus: "rejected" },
  { id: "synthetic-gbp-unassessed", firmName: "Synthetic GBP unassessed", value: null, originalStatus: "incomplete" },
  { id: "synthetic-not-selected", firmName: "Synthetic not selected", value: null, originalStatus: "not_selected" },
].map(({ id, firmName, value, originalStatus }) => ({
  id, firmName, recordOrigin: "reviewed_fixture", city: "Toronto", officeCities: ["Toronto"],
  websiteUrl: null, practiceAreas: ["Family law"], observedLawyerCount: 2,
  observedLawyerCountQualifier: "exact", observedLawyerCountDisplay: null,
  rosterSourceUrl: null, rosterCheckedAt: "2026-09-24",
  reconciliationStatus: "new_pending_identity", legacyClusterLawyerCount: null,
  legacyCrosswalk: null, reconciliationNote: "Synthetic display verification only.",
  advertisingEvidence: "unknown", advertisingSourceUrl: null, gbpEvidence: "unknown", gbpSourceUrl: null,
  supplementalEvidence: { identity: null, websiteIntake: { channels: [{ kind: "web-form", sourceUrl: "https://synthetic.example.test/contact", visibleFields: ["Name", "Email", "Phone", "Service", "Message", "Consent"] }], opportunityState: "not_established", observedOn: "2026-09-24" }, qualification: {
    state: "needs_evidence", cohort: "synthetic-ui-only", assessedOn: "2026-09-24",
    criteria: { originalStatus, gbpEvidence: value, richEvidence: { observedOn: "2026-09-24", missingGates: ["synthetic-gap"] } },
  } },
}));

export const SYNTHETIC_ZAREI_PROFILE_LINK: ReconciledGtaProspect = {
  id: "q50-zarei-law-professional-corporation",
  firmName: "Zarei Law Professional Corporation",
  recordOrigin: "reviewed_fixture", city: "Toronto", officeCities: ["Toronto"],
  websiteUrl: "https://www.zareilaw.com/", canonicalDomain: "www.zareilaw.com",
  practiceAreas: ["Family law"], observedLawyerCount: 2,
  observedLawyerCountQualifier: "exact", observedLawyerCountDisplay: null,
  rosterSourceUrl: "https://www.zareilaw.com/", rosterCheckedAt: "2026-09-25",
  reconciliationStatus: "provisional_new", legacyClusterLawyerCount: null,
  legacyCrosswalk: null, reconciliationNote: "Local acceptance fixture for the exact applied production firm identity.",
  advertisingEvidence: "unknown", advertisingSourceUrl: null, gbpEvidence: "unknown", gbpSourceUrl: null,
  databaseFirmId: "a9989dca-8626-4a6e-93ca-797a1cb7eed2",
  firmId: "FIRM-B86CCFA6A9972ED76D7A934695",
  supplementalEvidence: { identity: { matchState: "confirmed", observedOn: "2026-09-25", confidence: "high", source: "stable_identity_registry" }, websiteIntake: null, qualification: {
    state: "qualified", cohort: "q50_whole_firm_2026_09_25_v1", assessedOn: "2026-09-25",
    criteria: { sourceRecordKey: "q50-zarei-law-professional-corporation", originalStatus: "not_selected", adminProspectsReadback: { state: "admin-prospects-readback-failed" } },
  } },
};

export const SYNTHETIC_SAME_NAME_UNLINKED: ReconciledGtaProspect = {
  ...SYNTHETIC_ZAREI_PROFILE_LINK,
  id: "synthetic-same-name-no-verified-link",
  databaseFirmId: undefined,
  firmId: null,
  canonicalDomain: null,
  supplementalEvidence: { identity: null, websiteIntake: null, qualification: {
    state: "qualified", cohort: "q50_whole_firm_2026_09_25_v1", assessedOn: "2026-09-25",
    criteria: { sourceRecordKey: "synthetic-unlinked-same-name-record", originalStatus: "not_selected", adminProspectsReadback: { state: "admin-prospects-readback-failed" } },
  } },
  reconciliationNote: "Same displayed name; no exact applied database identity link.",
};
