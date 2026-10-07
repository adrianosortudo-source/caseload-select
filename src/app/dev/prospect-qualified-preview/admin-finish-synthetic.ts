import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";
import { attachGtaProspectCanonicalServices } from "@/lib/gta-prospect-service-reader";
import { SYNTHETIC_ZAREI_PROFILE_LINK } from "./synthetic-supplemental";

// Preview-only regression data. Identity constants protect the exact Adil link;
// filler records and evidence are synthetic and never imported into the ledger.
const adil: ReconciledGtaProspect = {
  ...SYNTHETIC_ZAREI_PROFILE_LINK,
  id: "q50-adillaw-ca", firmName: "Adil Law",
  databaseFirmId: "de1e6289-836f-487c-9e98-913f88c3db73",
  firmId: "FIRM-104E1V0P5A10C4P69D8B84YJQ7",
  websiteUrl: "https://adillaw.ca/", canonicalDomain: "adillaw.ca",
  city: "Milton", officeCities: ["Milton", "Mississauga"], practiceAreas: ["Corporate Matters"],
  reconciliationNote: "Synthetic acceptance data for the scoped Admin finish.",
  supplementalEvidence: { identity: { matchState: "confirmed", observedOn: "2026-09-27", confidence: "high", source: "stable_identity_registry" }, websiteIntake: null, qualification: null },
};
const filler: ReconciledGtaProspect[] = Array.from({ length: 100 }, (_, index) => ({
  ...adil, id: `synthetic-admin-finish-${index}`, firmName: `Synthetic finish firm ${index}`,
  databaseFirmId: undefined, firmId: null, canonicalDomain: null,
  supplementalEvidence: { identity: null, websiteIntake: null, qualification: null },
}));
const twin: ReconciledGtaProspect = { ...adil, id: "synthetic-adil-unlinked-twin", databaseFirmId: undefined, firmId: null, canonicalDomain: null, city: "Toronto", officeCities: ["Toronto"], practiceAreas: [], supplementalEvidence: { identity: null, websiteIntake: null, qualification: null } };
export const SYNTHETIC_ADMIN_FINISH_PROSPECTS = attachGtaProspectCanonicalServices([...filler, adil, twin], [
  { id: "a3209764-f370-40ed-b177-b2b2ad14d2a7", firmId: adil.databaseFirmId!, name: "Notary availability" },
  { id: "84000000-0000-4000-8000-000000000001", firmId: adil.databaseFirmId!, name: "CORPORATE MATTERS" },
]);
