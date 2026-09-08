import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";

/**
 * Reviewed GTA firm additions and corrections, observed 2026-09-06.
 *
 * `update_existing` means a matching legacy cluster remains separate until a
 * later, reviewed database migration. `new_pending_identity` keeps a candidate
 * out of automatic merge or import while its identity is resolved.
 */
export const RECONCILED_GTA_PROSPECTS: readonly ReconciledGtaProspect[] = [
  record("aastha-lawyers-mississauga", "Aastha Lawyers", "Mississauga", "https://www.aasthalaw.ca/", 4, "exact", null, "https://www.aasthalaw.ca/", "provisional_new"),
  record("dhillon-murthi-law-mississauga", "Dhillon Murthi Law", "Mississauga", "https://dhillonmurthilaw.ca/", 6, "exact", null, "https://dhillonmurthilaw.ca/about-us/our-team/", "update_existing", legacyAddressClusterAssociation()),
  record("rashidy-associates-mississauga", "Rashidy & Associates LLP Lawyers", "Mississauga", "https://rashidylaw.com/", 5, "exact", null, "https://rashidylaw.com/team/", "update_existing", legacyAddressClusterAssociation()),
  record("kpa-lawyers-mississauga", "KPA Lawyers Professional Corporation", "Mississauga", "https://kpalawyers.ca/", 6, "exact", null, "https://kpalawyers.ca/team-members/", "update_existing", { ...legacyAddressClusterAssociation("KPA's public site identifies Bluestar-group and licence trade-name relationships; do not merge those related firms automatically."), advertisingEvidence: "observed", advertisingSourceUrl: "https://adstransparency.google.com/advertiser/AR18160649533254533121?region=CA", gbpEvidence: "observed", gbpSourceUrl: "https://www.google.com/maps/place/KPA+Lawyers/@43.5972025,-79.635947,17z/data=!3m1!4b1!4m6!3m5!1s0x882b418dd301a06f:0x253dba460248ff19!8m2!3d43.5972025!4d-79.635947!16s%2Fg%2F11v0vrskkc?entry=ttu" }),
  record("carson-chousky-lein-toronto", "Carson Chousky Lein LLP", "Toronto", "https://www.cclfamilylaw.com/", 5, "exact", null, "https://www.cclfamilylaw.com/firm", "update_existing", { ...legacyAddressClusterAssociation(), practiceAreas: ["Family law"] }),
  record("maleki-liew-toronto", "Maleki Liew LLP", "Toronto", "https://malekiliew.com/", 6, "exact", null, "https://malekiliew.com/", "provisional_new", { practiceAreas: ["Family law"] }),
  record("rosen-sack-toronto", "Rosen Sack LLP", "Toronto", "https://www.rosensack.com/", 7, "exact", null, "https://www.rosensack.com/team", "update_existing", { ...legacyAddressClusterAssociation(), practiceAreas: ["Family law", "Estates"] }),
  record("angrove-law-toronto", "Angrove Law", "Toronto", "https://www.angrovelaw.ca/", 4, "exact", null, "https://www.angrovelaw.ca/about-us/", "provisional_new", { practiceAreas: ["Family law", "Business law", "Wills and estates"], advertisingEvidence: "observed", advertisingSourceUrl: "https://adstransparency.google.com/?region=CA&domain=angrovelaw.ca", gbpEvidence: "observed", gbpSourceUrl: "https://www.google.com/maps/search/?api=1&query=Angrove%20Law%2C%2015%20Wellesley%20St%20W%2C%20Toronto%2C%20ON" }),
  record("heft-law-markham", "Heft Law", "Markham", "https://heftlaw.ca/", 4, "exact", null, "https://heftlaw.ca/team/", "provisional_new", { practiceAreas: ["Family law", "Mediation", "Arbitration"], advertisingEvidence: "observed", advertisingSourceUrl: "https://adstransparency.google.com/?region=CA&domain=heftlaw.ca", gbpEvidence: "observed", gbpSourceUrl: "https://www.google.com/maps/search/?api=1&query=Heft%20Law%2C%2060%20Renfrew%20Dr%2C%20Markham%2C%20ON" }),
  record("john-g-cox-family-law-oakville", "John G. Cox Family Law", "Oakville", "https://www.jgcoxfamilylaw.com/", 5, "exact", null, "https://www.jgcoxfamilylaw.com/", "provisional_new", { practiceAreas: ["Family law"] }),
  record("henry-k-hui-richmond-hill", "Henry K. Hui & Associates", "Richmond Hill", "https://www.hkhlawyers.com/", 4, "exact", null, "https://www.hkhlawyers.com/", "provisional_new"),
  record("vakili-law-group-vaughan", "Vakili Law Group", "Vaughan", "https://vakililaw.com/", 3, "at_least", "3 core + counsel", "https://vakililaw.com/our-attorneys/", "update_existing", legacyAddressClusterAssociation("The roster count includes counsel context and remains an at-least count.")),
  record("lockyer-hein-brampton", "Lockyer + Hein", "Brampton", "https://lhlaw.ca/", 8, "exact", null, "https://lhlaw.ca/lawyers/", "new_pending_identity", { reconciliationNote: "Identity requires a reviewed match before any baseline merge or import." }),
  record("alves-law-oakville", "Alves Law", "Oakville", "https://www.alveslaw.ca/", 5, "exact", null, "https://www.alveslaw.ca/our-team/", "provisional_new"),
  record("cappellacci-daroza-toronto", "Cappellacci DaRoza", "Toronto", "https://capplaw.ca/", 3, "exact", null, "https://capplaw.ca/our-people/", "provisional_new"),
  record("humber-bay-law-toronto", "Humber Bay Law", "Toronto", "https://www.humberbaylaw.com/", 3, "exact", null, "https://www.humberbaylaw.com/team", "update_existing", legacyAddressClusterAssociation()),
  record("jordan-honickman-barristers-toronto", "Jordan Honickman Barristers", "Toronto", "https://www.jhbarristers.com/", 4, "exact", null, "https://www.jhbarristers.com/", "provisional_new"),
  record("book-erskine-toronto", "Book Erskine", "Toronto", "https://www.be-law.ca/", 4, "at_least", "4+", "https://www.be-law.ca/", "provisional_new"),
  record("will-trial-lawyers-oakville", "Will Trial Lawyers", "Oakville", "https://willtriallawyers.ca/", 4, "exact", null, "https://willtriallawyers.ca/team/", "provisional_new"),
  record("falcone-law-oakville-vaughan", "Falcone Law", "Oakville / Vaughan", "https://falconelaw.ca/", 6, "exact", null, "https://falconelaw.ca/about/", "update_existing", { ...legacyAddressClusterAssociation(), officeCities: ["Oakville", "Vaughan"] }),
];

type RecordOverrides = Pick<Partial<ReconciledGtaProspect>, "officeCities" | "practiceAreas" | "legacyClusterLawyerCount" | "legacyCrosswalk" | "reconciliationNote" | "advertisingEvidence" | "advertisingSourceUrl" | "gbpEvidence" | "gbpSourceUrl">;

function legacyAddressClusterAssociation(extraNote?: string): RecordOverrides {
  const uncertainty = "A legacy address-cluster association was reviewed, but the generated legacy artifact does not retain a stable cluster ID or count for a safe row-level crosswalk.";
  return {
    legacyCrosswalk: "Reviewed legacy address-cluster association; row-level cluster ID unavailable.",
    reconciliationNote: extraNote ? `${extraNote} ${uncertainty}` : uncertainty,
  };
}

function record(
  id: string,
  firmName: string,
  city: string,
  websiteUrl: string,
  observedLawyerCount: number,
  observedLawyerCountQualifier: ReconciledGtaProspect["observedLawyerCountQualifier"],
  observedLawyerCountDisplay: string | null,
  rosterSourceUrl: string,
  reconciliationStatus: ReconciledGtaProspect["reconciliationStatus"],
  overrides: RecordOverrides = {},
): ReconciledGtaProspect {
  return {
    id,
    firmName,
    city,
    officeCities: overrides.officeCities ?? [city],
    websiteUrl,
    practiceAreas: overrides.practiceAreas ?? [],
    observedLawyerCount,
    observedLawyerCountQualifier,
    observedLawyerCountDisplay,
    rosterSourceUrl,
    rosterCheckedAt: "2026-09-06",
    reconciliationStatus,
    legacyClusterLawyerCount: overrides.legacyClusterLawyerCount ?? null,
    legacyCrosswalk: overrides.legacyCrosswalk ?? null,
    reconciliationNote: overrides.reconciliationNote ?? null,
    advertisingEvidence: overrides.advertisingEvidence ?? "unknown",
    advertisingSourceUrl: overrides.advertisingSourceUrl ?? null,
    gbpEvidence: overrides.gbpEvidence ?? "unknown",
    gbpSourceUrl: overrides.gbpSourceUrl ?? null,
  };
}
