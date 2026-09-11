/**
 * Stable acceptance cases for the operator-owned GTA prospect importer.
 *
 * The records are deliberately synthetic. They encode the outcomes a real
 * import implementation must produce without giving test data an outreach
 * meaning. `expectedDisposition` is a review/apply outcome, never an identity
 * merge instruction.
 */

export type ImportAcceptanceDisposition =
  | "new"
  | "unchanged"
  | "update"
  | "review_required"
  | "invalid";

export type ProspectImportSourceRow = Readonly<{
  id: string;
  firmName: string;
  city: string;
  officeCities: readonly string[];
  websiteUrl: string | null;
  practiceAreas: readonly string[];
  observedLawyerCount: number | null;
  observedLawyerCountQualifier: "exact" | "at_least" | "unknown";
  observedLawyerCountDisplay: string | null;
  rosterSourceUrl: string | null;
  rosterCheckedAt: string;
  reconciliationStatus: "provisional_new" | "update_existing" | "new_pending_identity" | "duplicate" | "unresolved";
  legacyClusterLawyerCount: number | null;
  legacyCrosswalk: string | null;
  reconciliationNote: string | null;
  advertisingEvidence: "observed" | "unknown";
  advertisingSourceUrl: string | null;
  gbpEvidence: "observed" | "unknown";
  gbpSourceUrl: string | null;
  publicContacts: readonly Readonly<{
    name: string | null;
    relationship: "owner" | "founder" | "principal" | "named_lawyer" | "firm_inbox";
    email: string | null;
    emailKind: "owner" | "named_person" | "general_firm";
    sourceUrl: string;
    observedAt: string;
  }>[];
}>;

export type ProspectImportAcceptanceCase = Readonly<{
  id: string;
  incoming: ProspectImportSourceRow;
  existing: ProspectImportSourceRow | null;
  expectedDisposition: ImportAcceptanceDisposition;
  expectedPreservedFields?: readonly ("websiteUrl" | "publicContacts")[];
  candidateAddress?: string;
  existingAddress?: string;
}>;

const row = (overrides: Partial<ProspectImportSourceRow> & Pick<ProspectImportSourceRow, "id">): ProspectImportSourceRow => ({
  firmName: "Example Advocacy Law",
  city: "Toronto",
  officeCities: ["Toronto"],
  websiteUrl: "https://example-advocacy.test",
  practiceAreas: ["Family law"],
  observedLawyerCount: 3,
  observedLawyerCountQualifier: "exact",
  observedLawyerCountDisplay: "3 lawyers listed",
  rosterSourceUrl: "https://example-advocacy.test/our-team",
  rosterCheckedAt: "2026-09-11",
  reconciliationStatus: "provisional_new",
  legacyClusterLawyerCount: null,
  legacyCrosswalk: null,
  reconciliationNote: "Reviewed public roster evidence.",
  advertisingEvidence: "unknown",
  advertisingSourceUrl: null,
  gbpEvidence: "unknown",
  gbpSourceUrl: null,
  publicContacts: [],
  ...overrides,
  id: overrides.id,
});

export const GTA_PROSPECT_IMPORT_ACCEPTANCE_CASES: readonly ProspectImportAcceptanceCase[] = Object.freeze([
  Object.freeze({
    id: "new-source-key-is-staged-as-new",
    incoming: row({ id: "qa-new-firm" }),
    existing: null,
    expectedDisposition: "new" as const,
  }),
  Object.freeze({
    id: "identical-source-key-and-canonical-record-is-idempotent",
    incoming: row({ id: "qa-repeat-firm" }),
    existing: row({ id: "qa-repeat-firm" }),
    expectedDisposition: "unchanged" as const,
  }),
  Object.freeze({
    id: "same-source-key-with-a-new-roster-observation-is-an-update",
    incoming: row({
      id: "qa-update-firm",
      observedLawyerCount: 5,
      observedLawyerCountDisplay: "5 lawyers listed",
      rosterCheckedAt: "2026-09-12",
    }),
    existing: row({ id: "qa-update-firm" }),
    expectedDisposition: "update" as const,
  }),
  Object.freeze({
    id: "blank-optional-fields-do-not-erase-prior-observations",
    incoming: row({
      id: "qa-preserve-prior-evidence",
      websiteUrl: null,
      publicContacts: [],
      observedLawyerCount: 4,
      observedLawyerCountDisplay: null,
    }),
    existing: row({
      id: "qa-preserve-prior-evidence",
      websiteUrl: "https://prior-site.test",
      publicContacts: [{
        name: "Avery Principal",
        relationship: "principal",
        email: "avery@prior-site.test",
        emailKind: "owner",
        sourceUrl: "https://prior-site.test/team",
        observedAt: "2026-09-01",
      }],
    }),
    expectedDisposition: "update" as const,
    expectedPreservedFields: ["websiteUrl", "publicContacts"],
  }),
  Object.freeze({
    id: "same-domain-or-name-without-a-stable-key-needs-reviewed-identity-decision",
    incoming: row({ id: "qa-shared-domain-candidate", firmName: "Example Advocacy Law LLP" }),
    existing: row({ id: "qa-existing-firm" }),
    expectedDisposition: "review_required" as const,
  }),
  Object.freeze({
    id: "suite-variants-are-never-merged-by-the-importer",
    incoming: row({ id: "qa-suite-200", firmName: "Unit 200 Law", city: "Toronto" }),
    existing: row({ id: "qa-suite-100", firmName: "Unit 100 Law", city: "Toronto" }),
    candidateAddress: "200-342 Queen St W",
    existingAddress: "100-342 Queen Street West",
    expectedDisposition: "new" as const,
  }),
  Object.freeze({
    id: "public-owner-email-retains-source-provenance-only",
    incoming: row({
      id: "qa-public-contact",
      publicContacts: [{
        name: "Avery Founder",
        relationship: "founder",
        email: "avery@example-advocacy.test",
        emailKind: "owner",
        sourceUrl: "https://example-advocacy.test/team",
        observedAt: "2026-09-11",
      }],
    }),
    existing: null,
    expectedDisposition: "new" as const,
  }),
  Object.freeze({
    id: "invalid-record-is-never-staged-or-applied",
    incoming: row({ id: "qa-invalid", rosterSourceUrl: null }),
    existing: null,
    expectedDisposition: "invalid" as const,
  }),
]);
