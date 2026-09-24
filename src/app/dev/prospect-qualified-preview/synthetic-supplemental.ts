import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";

// Synthetic, local-preview-only evidence states. No real research or contacts.
export const SYNTHETIC_SUPPLEMENTAL_GBP_PROSPECTS: ReconciledGtaProspect[] = [
  { id: "synthetic-gbp-supported", firmName: "Synthetic GBP supported", value: true },
  { id: "synthetic-gbp-needs", firmName: "Synthetic GBP needs evidence", value: false },
  { id: "synthetic-gbp-unassessed", firmName: "Synthetic GBP unassessed", value: null },
].map(({ id, firmName, value }) => ({
  id, firmName, recordOrigin: "reviewed_fixture", city: "Toronto", officeCities: ["Toronto"],
  websiteUrl: null, practiceAreas: ["Family law"], observedLawyerCount: 2,
  observedLawyerCountQualifier: "exact", observedLawyerCountDisplay: null,
  rosterSourceUrl: null, rosterCheckedAt: "2026-09-24",
  reconciliationStatus: "new_pending_identity", legacyClusterLawyerCount: null,
  legacyCrosswalk: null, reconciliationNote: "Synthetic display verification only.",
  advertisingEvidence: "unknown", advertisingSourceUrl: null, gbpEvidence: "unknown", gbpSourceUrl: null,
  supplementalEvidence: { identity: null, websiteIntake: null, qualification: {
    state: "needs_evidence", cohort: "synthetic-ui-only", assessedOn: "2026-09-24",
    criteria: { gbpEvidence: value, richEvidence: { observedOn: "2026-09-24", missingGates: ["synthetic-gap"] } },
  } },
}));
