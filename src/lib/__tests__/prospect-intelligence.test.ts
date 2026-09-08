import { describe, expect, it } from "vitest";
import { applyOwnerCohortUpdates, BRAZILIAN_LAWYER_PROSPECTS, filterBrazilianProspects, isOwnerResearchEligible, isSelectable, isSuppressed, LEGACY_PROSPECT_MANIFEST, type ProspectOwnerCohortUpdate } from "../prospect-intelligence";
import { PUBLIC_CONTACT_SNAPSHOT } from "../brazilian-prospect-contacts.snapshot";
import { BRAZILIAN_OWNER_COHORT_SOURCE_MANIFEST, BRAZILIAN_OWNER_COHORT_UPDATES } from "../brazilian-owner-cohort.snapshot";

describe("Brazilian lawyer prospect overlay", () => {
  it("retains the immutable legacy comparator", () => {
    expect(LEGACY_PROSPECT_MANIFEST).toEqual({
      rows: 5902,
      columns: 21,
      sha256: "f22a91c41ef1165e74207b5925693b1d9edb272806d2dfb7d510428ac6f25ebe",
      fnv1a32: "d8038a36",
      capturedAt: "2026-09-03",
      source: "Claude artifact v13 data snapshot",
    });
  });
  it("preserves the 25-record public-contact snapshot while integrating approved owners", () => {
    expect(BRAZILIAN_LAWYER_PROSPECTS).toHaveLength(29);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter(isSelectable)).toHaveLength(12);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.bucket === "portuguese")).toHaveLength(10);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.bucket === "affiliation_review")).toHaveLength(3);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter(isSuppressed)).toHaveLength(4);
    expect(BRAZILIAN_LAWYER_PROSPECTS.every((record) => record.website && record.sources.length > 0 && record.publicContact?.provenance.length)).toBe(true);
    expect(PUBLIC_CONTACT_SNAPSHOT).toHaveLength(25);
    expect(PUBLIC_CONTACT_SNAPSHOT.filter((record) => record.website)).toHaveLength(25);
    expect(PUBLIC_CONTACT_SNAPSHOT.filter((record) => record.bioUrl)).toHaveLength(25);
    expect(PUBLIC_CONTACT_SNAPSHOT.filter((record) => record.contactSourceUrl)).toHaveLength(25);
    expect(PUBLIC_CONTACT_SNAPSHOT.every((record) => record.provenance.length > 0)).toBe(true);
  });
  it("keeps the controlled category partition and selection guard", () => {
    const names = (bucket: "explicit" | "portuguese" | "affiliation_review") =>
      BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.bucket === bucket).map((record) => record.name);
    const byId = Object.fromEntries(BRAZILIAN_LAWYER_PROSPECTS.map((record) => [record.id, record]));

    expect(names("affiliation_review")).toEqual(["Barbara Vaz", "Nelson Oliveira", "Lara Merjane"]);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.bucket === "explicit").map((record) => record.id)).toEqual(["kelin-algayer", "gabriel-melo-viana", "thiago-machado", "laurene-oliveira", "eliane-leal", "eduardo-oliveira", "camila-motta", "susana-sobral-cruz", "celso-sakuraba", "fabiana-da-costa", "bruno-nascimento", "fernando-martins"]);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.bucket === "portuguese").map((record) => record.id)).toEqual(["annelise-do-rio", "lucas-da-silva", "david-dos-reis", "carlos-martins", "michelle-jorge", "darlene-rites", "mariana-peres-toledo", "benjamin-marcos", "krystle-ferreira", "bruno-filipe-teixeira"]);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.bucket === "dnc").map((record) => record.id)).toEqual(["damaris", "wanessa-oliveira", "eduardo-barbosa", "rafael-santos-cesar"]);
    expect(byId["barbara-vaz"]?.bucket).toBe("affiliation_review");
    expect(byId["nelson-oliveira"]?.bucket).toBe("affiliation_review");
    expect(byId["bruno-nascimento"]?.bucket).toBe("explicit");
    expect(byId["mariana-peres-toledo"]?.bucket).toBe("portuguese");
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter(isSelectable).every((record) =>
      record.researchSet === "brazil_connected_ready" && record.outreachEligibility === "INTERNAL_CANDIDATE_UNSENT" && record.suppression === null,
    )).toBe(true);
  });
  it("retains Mariana's source-record resolution and public-contact provenance", () => {
    const mariana = BRAZILIAN_LAWYER_PROSPECTS.find((record) => record.id === "mariana-peres-toledo");
    expect(mariana).toMatchObject({
      personId: "BAO-P-000040",
      sourceRecordId: "BAO-PC-000015",
      bucket: "portuguese",
      researchSet: "portuguese_only_brazil_unconfirmed",
      outreachEligibility: "INTERNAL_CANDIDATE_UNSENT",
      currentPrimaryFirm: "Siskinds LLP",
      suppression: null,
      portugueseBrazilConnection: {
        category: "Portuguese native",
        evidenceSource: "https://www.siskinds.com/lawyer/mariana-peres-toledo/",
        statement: "Profile lists Portuguese as native.",
      },
      unknowns: ["Profile does not establish a Brazil-practice connection."],
      publicContact: {
        email: "mariana.perestoledo@siskinds.com",
        phone: "226-636-1526",
        bioUrl: "https://www.siskinds.com/lawyer/mariana-peres-toledo/",
      },
    });
  });
  it("pins the approved owner cohort source and exact evidence partition", () => {
    expect(BRAZILIAN_OWNER_COHORT_SOURCE_MANIFEST).toEqual({
      rows: 13,
      sha256: "0CC15CCB59FD31FFC3EA70C744AF5163EB06CB81EEE7371F1F8F1ABDEDE900BB",
      sourceFile: "LANE_B_FINAL_PORTAL_INGESTION_2026-09-07.jsonl",
    });
    expect(BRAZILIAN_OWNER_COHORT_UPDATES).toHaveLength(13);
    expect(BRAZILIAN_OWNER_COHORT_UPDATES.filter((record) => record.ownerAuthority === "O1")).toHaveLength(9);
    expect(BRAZILIAN_OWNER_COHORT_UPDATES.filter((record) => record.ownerAuthority === "O2")).toHaveLength(4);
    expect(BRAZILIAN_OWNER_COHORT_UPDATES.filter((record) => record.evidence === "B2")).toHaveLength(4);
    expect(BRAZILIAN_OWNER_COHORT_UPDATES.filter((record) => record.evidence === "B3")).toHaveLength(2);
    expect(BRAZILIAN_OWNER_COHORT_UPDATES.filter((record) => record.evidence === "B4")).toHaveLength(7);
    expect(BRAZILIAN_OWNER_COHORT_UPDATES.filter((record) => record.publicContact?.email === null)).toHaveLength(3);
    expect(BRAZILIAN_OWNER_COHORT_UPDATES.filter((record) => record.suppression)).toHaveLength(0);
  });
  it("keeps primary, secondary, hold, and DNC gates separate", () => {
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter(isOwnerResearchEligible)).toHaveLength(12);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.cohort.ownerAuthority === "O1")).toHaveLength(9);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.cohort.ownerAuthority === "O2")).toHaveLength(4);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.cohort.researchEligibility === "primary_owner_cohort")).toHaveLength(6);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.cohort.researchEligibility === "secondary_owner_cohort")).toHaveLength(6);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.cohort.researchEligibility === "hold_owner_authority_review")).toHaveLength(13);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.cohort.researchEligibility === "do_not_contact")).toHaveLength(4);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.cohort.researchState === "suppressed")).toHaveLength(4);
    expect(BRAZILIAN_LAWYER_PROSPECTS.every((record) => record.cohort.interviewState === "not_started")).toBe(true);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.cohort.ownerAuthority === "O4").every((record) => record.cohort.explicitUnknowns.includes("Owner or operating authority has not been independently verified."))).toBe(true);
    const geographyHold = BRAZILIAN_LAWYER_PROSPECTS.find((record) => record.id === "bruno-filipe-teixeira");
    expect(geographyHold?.cohort).toMatchObject({ ownerAuthority: "O1", researchEligibility: "hold_owner_authority_review", researchState: "screened" });
    expect(isOwnerResearchEligible(geographyHold!)).toBe(false);
  });
  it("provides canonical IDs, domain states, and contact-source provenance", () => {
    expect(BRAZILIAN_LAWYER_PROSPECTS.every((record) => record.cohort.canonicalPersonId && record.cohort.canonicalFirmId)).toBe(true);
    expect(BRAZILIAN_LAWYER_PROSPECTS.every((record) => record.cohort.canonicalFirmId.startsWith("firm:"))).toBe(true);
    expect(BRAZILIAN_LAWYER_PROSPECTS.every((record) => record.cohort.domainRelationships.length > 0)).toBe(true);
    expect(BRAZILIAN_LAWYER_PROSPECTS.every((record) => record.cohort.domainRelationships.some((relationship) => relationship.state === "current_primary"))).toBe(true);
    expect(BRAZILIAN_LAWYER_PROSPECTS.every((record) => record.cohort.contactSourceProvenance.some((entry) => entry.field === "website"))).toBe(true);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.email).every((record) => record.cohort.contactSourceProvenance.some((entry) => entry.field === "email"))).toBe(true);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter((record) => record.phone).every((record) => record.cohort.contactSourceProvenance.some((entry) => entry.field === "phone"))).toBe(true);
    expect(BRAZILIAN_OWNER_COHORT_UPDATES.every((update) => {
      const integrated = BRAZILIAN_LAWYER_PROSPECTS.find((record) => record.cohort.canonicalPersonId === update.canonicalPersonId);
      return Boolean(integrated) && update.domainRelationships.every((relationship) => integrated!.cohort.domainRelationships.some((candidate) => candidate.url === relationship.url && candidate.state === relationship.state));
    })).toBe(true);
    expect(new Set(BRAZILIAN_LAWYER_PROSPECTS.map((record) => record.cohort.canonicalPersonId)).size).toBe(BRAZILIAN_LAWYER_PROSPECTS.length);
  });
  it("integrates approved owner updates and additions deterministically", () => {
    const existing = BRAZILIAN_LAWYER_PROSPECTS.find((record) => record.id === "thiago-machado")!;
    const updates: ProspectOwnerCohortUpdate[] = [
      {
        operation: "add",
        id: "fixture-owner",
        name: "Fixture Owner",
        firm: "Fixture Law",
        bucket: "explicit",
        researchSet: "brazil_connected_ready",
        outreachEligibility: "INTERNAL_CANDIDATE_UNSENT",
        currentPrimaryFirm: "Fixture Law",
        suppression: null,
        evidence: "B3",
        website: "https://fixture.example/",
        sources: ["https://fixture.example/about"],
        unknowns: [],
        canonicalPersonId: "BAO-P-FIXTURE-2",
        canonicalFirmId: "BAO-F-FIXTURE-2",
        ownerAuthority: "O2",
        ownerAuthorityEvidence: ["FIXTURE-E-2"],
        researchEligibility: "primary_owner_cohort",
        researchState: "eligible",
        interviewState: "not_started",
        evidenceConfidence: "corroborated",
        domainRelationships: [{ url: "https://fixture.example/", host: "fixture.example", state: "current_primary", confidence: "corroborated" }],
        contactSourceProvenance: [{ field: "website", value: "https://fixture.example/", sourceUrl: "https://fixture.example/about", evidenceIds: ["FIXTURE-E-2"], confidence: "corroborated" }],
        explicitUnknowns: [],
      },
      {
        operation: "update",
        id: existing.id,
        canonicalPersonId: existing.cohort.canonicalPersonId,
        canonicalFirmId: existing.cohort.canonicalFirmId,
        ownerAuthority: "O1",
        ownerAuthorityEvidence: ["FIXTURE-E-1"],
        researchEligibility: "primary_owner_cohort",
        researchState: "eligible",
        interviewState: "not_started",
        evidenceConfidence: "corroborated",
        domainRelationships: existing.cohort.domainRelationships,
        contactSourceProvenance: existing.cohort.contactSourceProvenance,
        explicitUnknowns: existing.unknowns,
      },
    ];
    const integrated = applyOwnerCohortUpdates(BRAZILIAN_LAWYER_PROSPECTS, updates);

    expect(integrated).toHaveLength(30);
    expect(integrated.filter(isOwnerResearchEligible)).toHaveLength(13);
    expect(integrated.find((record) => record.id === "thiago-machado")?.cohort.ownerAuthority).toBe("O1");
    expect(integrated.at(-1)?.id).toBe("fixture-owner");
    expect(BRAZILIAN_LAWYER_PROSPECTS).toHaveLength(29);
    expect(BRAZILIAN_LAWYER_PROSPECTS.filter(isOwnerResearchEligible)).toHaveLength(12);
  });
  it("rejects any cohort update that relaxes DNC", () => {
    const damaris = BRAZILIAN_LAWYER_PROSPECTS.find((record) => record.id === "damaris")!;
    const unsafe: ProspectOwnerCohortUpdate = {
      operation: "update",
      id: damaris.id,
      ...damaris.cohort,
      researchEligibility: "primary_owner_cohort",
      researchState: "eligible",
    };
    expect(() => applyOwnerCohortUpdates(BRAZILIAN_LAWYER_PROSPECTS, [unsafe])).toThrow("cannot relax DNC suppression");
  });
  it("preserves the exact DNC join after owner ingestion", () => {
    const suppressed = BRAZILIAN_LAWYER_PROSPECTS.filter(isSuppressed);
    expect(suppressed.map((record) => record.id)).toEqual(["damaris", "wanessa-oliveira", "eduardo-barbosa", "rafael-santos-cesar"]);
    expect(suppressed.every((record) => record.cohort.researchEligibility === "do_not_contact" && record.cohort.researchState === "suppressed")).toBe(true);
    expect(BRAZILIAN_OWNER_COHORT_UPDATES.some((update) => suppressed.some((record) => record.cohort.canonicalPersonId === update.canonicalPersonId))).toBe(false);
  });
  it("searches names/domains and never makes DNC selectable", () => {
    expect(filterBrazilianProspects("sakuraba")[0]?.firm).toBe("Sakuraba Law");
    const damaris = filterBrazilianProspects("faurilaw")[0];
    expect(damaris?.domains).toEqual([
      "https://www.faurilaw.ca/attorneys/damaris-regina-guimaraes/",
      "https://drglaw.ca/legal/lso",
      "https://lsodirectory.lso.ca/en-US/",
      "https://www.drglegalservices.com/",
      "https://directory.lawonline.ca/on/york-region/markham/lextransact-law-professional-corporation",
    ]);
    expect(isSelectable(damaris!)).toBe(false);
    expect(isSuppressed(damaris!)).toBe(true);
    expect(damaris?.domains?.every((url) => damaris.cohort.domainRelationships.some((relationship) => relationship.url === url))).toBe(true);
    expect(filterBrazilianProspects("BAO-P-000001")[0]?.id).toBe("damaris");
    expect(filterBrazilianProspects("firm:sakuraba-law")[0]?.id).toBe("celso-sakuraba");
  });
});
