import { PUBLIC_CONTACT_SNAPSHOT } from "./brazilian-prospect-contacts.snapshot";
import { BRAZILIAN_OWNER_COHORT_UPDATES } from "./brazilian-owner-cohort.snapshot";

export type ProspectBucket = "explicit" | "portuguese" | "affiliation_review" | "dnc";
export type ResearchSet = "brazil_connected_ready" | "portuguese_only_brazil_unconfirmed" | "affiliation_review" | "not_selectable";
export type OutreachEligibility =
  | "INTERNAL_CANDIDATE_UNSENT"
  | "INTERNAL_CANDIDATE_UNSENT_AFFILIATION_REVIEW"
  | "DO_NOT_COLD_PROSPECT"
  | "DO_NOT_CONTACT_CONFLICT_PENDING";

export type OwnerAuthorityCode = "O1" | "O2" | "O3" | "O4" | "O5";
export type ResearchEligibility =
  | "primary_owner_cohort"
  | "secondary_owner_cohort"
  | "hold_owner_authority_review"
  | "excluded_non_buyer"
  | "do_not_contact";
export type ResearchState =
  | "candidate"
  | "screened"
  | "eligible"
  | "invited"
  | "booked"
  | "completed"
  | "coded"
  | "evidence_reviewed"
  | "pilot_candidate"
  | "excluded"
  | "suppressed";
export type InterviewState =
  | "not_started"
  | "invited"
  | "booked"
  | "completed"
  | "coded"
  | "declined"
  | "unreachable";
export type EvidenceConfidence = "unreviewed" | "single_source" | "corroborated" | "conflicting";
export type DomainRelationshipState =
  | "current_primary"
  | "professional_profile"
  | "contact_source"
  | "regulator"
  | "directory"
  | "historic"
  | "unresolved";
export type ContactField = "email" | "phone" | "website";

export type DomainRelationship = {
  url: string;
  host: string;
  state: DomainRelationshipState;
  confidence: EvidenceConfidence;
};

export type ContactSourceProvenance = {
  field: ContactField;
  value: string;
  sourceUrl: string | null;
  evidenceIds: readonly string[];
  confidence: EvidenceConfidence;
};

export type ProspectCohort = {
  canonicalPersonId: string;
  canonicalFirmId: string;
  ownerAuthority: OwnerAuthorityCode;
  ownerAuthorityEvidence: readonly string[];
  researchEligibility: ResearchEligibility;
  researchState: ResearchState;
  interviewState: InterviewState;
  evidenceConfidence: EvidenceConfidence;
  domainRelationships: readonly DomainRelationship[];
  contactSourceProvenance: readonly ContactSourceProvenance[];
  explicitUnknowns: readonly string[];
};

export type PublicContactDetails = {
  email: string | null;
  phone: string | null;
  website: string | null;
  bioUrl: string | null;
  contactSourceUrl: string | null;
  lsoSourceUrl: string | null;
  provenance: readonly string[];
  lsoNumber: string | null;
  practiceAreas: readonly string[];
  status: string | null;
  role: string | null;
  suppressionReason: string | null;
};

type OwnerCohortUpdateFields = {
  canonicalPersonId: string;
  canonicalFirmId: string;
  ownerAuthority: OwnerAuthorityCode;
  ownerAuthorityEvidence: readonly string[];
  researchEligibility: ResearchEligibility;
  researchState: ResearchState;
  interviewState: InterviewState;
  evidenceConfidence: EvidenceConfidence;
  domainRelationships: readonly DomainRelationship[];
  contactSourceProvenance: readonly ContactSourceProvenance[];
  explicitUnknowns: readonly string[];
};

export type ProspectOwnerCohortUpdate =
  | ({
      operation: "update";
      id: string;
      name?: string;
      firm?: string;
      bucket?: ProspectBucket;
      researchSet?: ResearchSet;
      outreachEligibility?: OutreachEligibility;
      currentPrimaryFirm?: string | null;
      suppression?: string | null;
      evidence?: ProspectResearch["evidence"];
      website?: string;
      email?: string;
      phone?: string;
      sources?: readonly string[];
      unknowns?: readonly string[];
      domains?: readonly string[];
      note?: string;
      sourceRecordId?: string;
      portugueseBrazilConnection?: ProspectResearch["portugueseBrazilConnection"];
      publicContact?: PublicContactDetails;
    } & OwnerCohortUpdateFields)
  | ({
      operation: "add";
      id: string;
      name: string;
      firm: string;
      bucket: ProspectBucket;
      researchSet: ResearchSet;
      outreachEligibility?: OutreachEligibility;
      currentPrimaryFirm: string | null;
      suppression: string | null;
      evidence: ProspectResearch["evidence"];
      website?: string;
      email?: string;
      phone?: string;
      sources: readonly string[];
      unknowns: readonly string[];
      domains?: readonly string[];
      note?: string;
      sourceRecordId?: string;
      portugueseBrazilConnection?: ProspectResearch["portugueseBrazilConnection"];
      publicContact?: PublicContactDetails;
    } & OwnerCohortUpdateFields);

type PublicContactSnapshot = (typeof PUBLIC_CONTACT_SNAPSHOT)[number];
type CohortSnapshotExtension = {
  canonicalFirmId: string;
  ownerAuthority: OwnerAuthorityCode;
  ownerAuthorityEvidence: readonly string[];
  researchEligibility: ResearchEligibility;
  researchState: ResearchState;
  interviewState: InterviewState;
  evidenceConfidence: EvidenceConfidence;
  domainRelationships: readonly DomainRelationship[];
  contactSourceProvenance: readonly ContactSourceProvenance[];
  explicitUnknowns: readonly string[];
};
type PublicContactRecord = PublicContactSnapshot & Partial<CohortSnapshotExtension>;

export type ProspectResearch = {
  id: string;
  personId?: string;
  sourceRecordId?: string;
  name: string;
  firm: string;
  bucket: ProspectBucket;
  researchSet: ResearchSet;
  outreachEligibility?: OutreachEligibility;
  currentPrimaryFirm: string | null;
  suppression: string | null;
  unknowns: readonly string[];
  portugueseBrazilConnection?: {
    category: string;
    evidenceSource: string;
    statement: string;
  };
  evidence: "B1" | "B2" | "B3" | "B4" | "hold";
  website?: string;
  email?: string;
  phone?: string;
  sources: string[];
  cohort: ProspectCohort;
  publicContact?: PublicContactDetails;
  domains?: string[];
  note?: string;
};

/** Immutable comparator for the pre-migration Claude artifact data payload. */
export const LEGACY_PROSPECT_MANIFEST = {
  rows: 5902,
  columns: 21,
  sha256: "f22a91c41ef1165e74207b5925693b1d9edb272806d2dfb7d510428ac6f25ebe",
  fnv1a32: "d8038a36",
  capturedAt: "2026-09-03",
  source: "Claude artifact v13 data snapshot",
} as const;

// This list is an operator research overlay, not a CRM, import queue, or send queue.
// B1–B4 describe public evidence only; they do not assert nationality.
type ProspectSeed = [string, string, string, ProspectBucket, ProspectResearch["evidence"], string?, string?, string?, string[]?, string?];
const PROSPECT_SEEDS: ProspectSeed[] = [
  ["kelin-algayer","Kelin Algayer","WeirFoulds LLP","explicit","B2","https://www.weirfoulds.com/people/kelin-algayer"],
  ["gabriel-melo-viana","Gabriel Melo Viana","Lewis & Associates LLP","explicit","B2","https://lewislegal.ca/personnel/gabriel-melo-viana/"],
  ["thiago-machado","Thiago Machado","Machado Law - Refugee & Immigration","explicit","B2","https://www.machadolaw.ca/"],
  ["laurene-oliveira","Laurene Oliveira","McMillan LLP","explicit","B2","https://mcmillan.ca/people/laurene-oliveira/?print-posts=pdf"],
  ["eliane-leal","Eliane Leal da Silva","Gardiner Roberts LLP","explicit","B2","https://www.itlconference.ca/assets/speakers.pdf"],
  ["eduardo-oliveira","Eduardo Oliveira","Flow Law Professional Corporation","explicit","B2","https://flowlaw.ca/eduardo-oliveira/"],
  ["barbara-vaz","Barbara Vaz","Brown Immigration Law P.C., L.L.O.","affiliation_review","hold","https://bcba.legal/barbara-vaz/"],
  ["camila-motta","Camila Motta","Revive Law Professional Corporation","explicit","B3","https://ca.linkedin.com/company/revivelaw"],
  ["susana-sobral-cruz","Susana Figueiredo Sobral Cruz","Sobral Cruz Legal Services","explicit","B2","https://bcba.legal/directory/"],
  ["celso-sakuraba","Celso Sakuraba","Sakuraba Law","explicit","B2","https://sakurabalaw.ca/"],
  ["fabiana-da-costa","Fabiana da Costa","Chaitons LLP","explicit","B2","https://www.chaitons.com/lawyers/bio/fabiana-da-costa"],
  ["annelise-do-rio","Annelise Do Rio","Milosevic & Associates","portuguese","B4","https://www.mlflitigation.com/team/annelise-do-rio/"],
  ["lucas-da-silva","Lucas Da Silva","Goldblatt Partners LLP","portuguese","B4","https://goldblattpartners.com/our-lawyers/lucas-da-silva/"],
  ["david-dos-reis","David Baptista dos Reis","LD Law LLP","portuguese","B4","https://www.ldlaw.ca/david-baptista-dos-reis/"],
  ["nelson-oliveira","Nelson Oliveira","Move LLP","affiliation_review","hold","https://www.jrmlaw.ca/our-lawyers/"],
  ["carlos-martins","Carlos Martins","WeirFoulds LLP","portuguese","B4","https://www.weirfoulds.com/pdf-profile?id=14893"],
  ["michelle-jorge","Michelle Jorge","Jewell Radimisis Jorge LLP","portuguese","B4","https://www.jrjlaw.com/our-lawyers/michelle-f-jorge-ll-b-ba-hons-/"],
  ["darlene-rites","Darlene Rites","Rites Law","portuguese","B4","https://riteslaw.ca/darlene-rites/"],
  ["mariana-peres-toledo","Mariana Peres Toledo","Siskinds LLP","portuguese","B4","https://www.siskinds.com/lawyer/mariana-peres-toledo/"],
  ["lara-merjane","Lara Merjane","The Ross Firm Professional Corporation","affiliation_review","hold","https://rossfirm.com/lawyer/lara-merjane/"],
  ["bruno-nascimento","Bruno Nascimento","Chadha Nascimento LLP","explicit","B2","https://thepropertylawyers.ca/"],
  ["damaris","Damaris Regina Guimaraes","DRG Law Professional Corporation","dnc","B2","https://drglaw.ca/legal/lso",undefined,undefined,["https://www.faurilaw.ca/attorneys/damaris-regina-guimaraes/","https://drglaw.ca/legal/lso","https://lsodirectory.lso.ca/en-US/","https://www.drglegalservices.com/","https://directory.lawonline.ca/on/york-region/markham/lextransact-law-professional-corporation"],"Existing-client protection; exactly five preserved current, historic, regulator, and directory relationships are shown for identity resolution."],
  ["wanessa-oliveira","Wanessa Oliveira","Boston Scientific","dnc","B2","https://bcba.legal/team/"],
  ["eduardo-barbosa","Eduardo Barbosa","Affiliation unresolved","dnc","hold"],
  ["rafael-santos-cesar","Rafael Santos Cesar","Affiliation unresolved","dnc","hold"],
];

const BASE_BRAZILIAN_LAWYER_PROSPECTS: readonly ProspectResearch[] = PROSPECT_SEEDS.map(([id,name,firm,bucket,evidence,website,email,phone,domains,note]): ProspectResearch => {
  const contact = PUBLIC_CONTACT_SNAPSHOT.find((candidate) => candidate.name === name) as PublicContactRecord | undefined;
  const policy = getResearchPolicy(id, bucket, contact);
  const resolvedWebsite = contact?.website ?? website;
  const resolvedEmail = contact?.email ?? email;
  const resolvedPhone = contact?.phone ?? phone;
  return {
    id, name, firm, bucket, evidence, domains, note,
    ...policy,
    personId: contact?.personId,
    website: resolvedWebsite,
    email: resolvedEmail,
    phone: resolvedPhone,
    cohort: buildProspectCohort({
      id,
      firm,
      bucket,
      contact,
      website: resolvedWebsite,
      email: resolvedEmail,
      phone: resolvedPhone,
      mappedDomains: domains,
    }),
    publicContact: contact && {
      email: contact.email,
      phone: contact.phone,
      website: contact.website,
      bioUrl: contact.bioUrl,
      contactSourceUrl: contact.contactSourceUrl,
      lsoSourceUrl: contact.lsoSourceUrl,
      provenance: contact.provenance,
      lsoNumber: contact.lsoNumber,
      practiceAreas: contact.practiceAreas,
      status: contact.status,
      role: contact.role,
      suppressionReason: contact.suppressionReason,
    },
    sources: [contact?.bioUrl, contact?.contactSourceUrl, contact?.lsoSourceUrl, ...(contact?.provenance ?? []), website].filter((value): value is string => Boolean(value)),
  };
});

export function applyOwnerCohortUpdates(
  base: readonly ProspectResearch[],
  updates: readonly ProspectOwnerCohortUpdate[],
): readonly ProspectResearch[] {
  const result = base.map((record) => ({ ...record, cohort: { ...record.cohort } }));
  const ids = new Set(result.map((record) => record.id));
  const personIds = new Set(result.map((record) => record.cohort.canonicalPersonId));
  const orderedUpdates = [...updates].sort((left, right) => left.canonicalPersonId.localeCompare(right.canonicalPersonId));

  for (const update of orderedUpdates) {
    const nextCohort: ProspectCohort = {
      canonicalPersonId: update.canonicalPersonId,
      canonicalFirmId: update.canonicalFirmId,
      ownerAuthority: update.ownerAuthority,
      ownerAuthorityEvidence: update.ownerAuthorityEvidence,
      researchEligibility: update.researchEligibility,
      researchState: update.researchState,
      interviewState: update.interviewState,
      evidenceConfidence: update.evidenceConfidence,
      domainRelationships: update.domainRelationships,
      contactSourceProvenance: update.contactSourceProvenance,
      explicitUnknowns: update.explicitUnknowns,
    };

    if (update.operation === "update") {
      const index = result.findIndex((record) => record.id === update.id || record.cohort.canonicalPersonId === update.canonicalPersonId);
      if (index < 0) throw new Error(`Owner-cohort update references unknown record: ${update.id}`);
      const current = result[index];
      if (current.bucket === "dnc" && (update.researchEligibility !== "do_not_contact" || update.researchState !== "suppressed")) {
        throw new Error(`Owner-cohort update cannot relax DNC suppression: ${update.id}`);
      }
      if (update.canonicalPersonId !== current.cohort.canonicalPersonId && personIds.has(update.canonicalPersonId)) {
        throw new Error(`Owner-cohort update duplicates canonical person: ${update.canonicalPersonId}`);
      }
      personIds.delete(current.cohort.canonicalPersonId);
      personIds.add(update.canonicalPersonId);
      result[index] = {
        ...current,
        personId: update.canonicalPersonId,
        name: update.name ?? current.name,
        firm: update.firm ?? current.firm,
        bucket: update.bucket ?? current.bucket,
        researchSet: update.researchSet ?? current.researchSet,
        outreachEligibility: update.outreachEligibility ?? current.outreachEligibility,
        currentPrimaryFirm: update.currentPrimaryFirm ?? current.currentPrimaryFirm,
        suppression: update.suppression ?? current.suppression,
        evidence: update.evidence ?? current.evidence,
        website: update.website ?? current.website,
        email: update.email ?? current.email,
        phone: update.phone ?? current.phone,
        sources: update.sources ? [...update.sources] : current.sources,
        unknowns: update.unknowns ?? current.unknowns,
        domains: update.domains ? [...update.domains] : current.domains,
        note: update.note ?? current.note,
        sourceRecordId: update.sourceRecordId ?? current.sourceRecordId,
        portugueseBrazilConnection: update.portugueseBrazilConnection ?? current.portugueseBrazilConnection,
        publicContact: update.publicContact ?? current.publicContact,
        cohort: nextCohort,
      };
      continue;
    }

    if (ids.has(update.id)) throw new Error(`Owner-cohort addition duplicates record ID: ${update.id}`);
    if (personIds.has(update.canonicalPersonId)) throw new Error(`Owner-cohort addition duplicates canonical person: ${update.canonicalPersonId}`);
    if (update.bucket === "dnc" && (update.researchEligibility !== "do_not_contact" || update.researchState !== "suppressed" || !update.suppression)) {
      throw new Error(`Owner-cohort DNC addition must remain suppressed: ${update.id}`);
    }

    ids.add(update.id);
    personIds.add(update.canonicalPersonId);
    result.push({
      id: update.id,
      personId: update.canonicalPersonId,
      sourceRecordId: update.sourceRecordId,
      name: update.name,
      firm: update.firm,
      bucket: update.bucket,
      researchSet: update.researchSet,
      outreachEligibility: update.outreachEligibility,
      currentPrimaryFirm: update.currentPrimaryFirm,
      suppression: update.suppression,
      unknowns: update.unknowns,
      evidence: update.evidence,
      website: update.website,
      email: update.email,
      phone: update.phone,
      sources: [...update.sources],
      domains: update.domains ? [...update.domains] : undefined,
      note: update.note,
      portugueseBrazilConnection: update.portugueseBrazilConnection,
      publicContact: update.publicContact,
      cohort: nextCohort,
    });
  }

  return result;
}

export const BRAZILIAN_LAWYER_PROSPECTS: readonly ProspectResearch[] = applyOwnerCohortUpdates(
  BASE_BRAZILIAN_LAWYER_PROSPECTS,
  BRAZILIAN_OWNER_COHORT_UPDATES as readonly ProspectOwnerCohortUpdate[],
);

export function isSelectable(record: ProspectResearch): boolean {
  return record.researchSet === "brazil_connected_ready" && record.outreachEligibility === "INTERNAL_CANDIDATE_UNSENT" && !record.suppression;
}

export function isSuppressed(record: ProspectResearch): boolean {
  return record.researchSet === "not_selectable" && Boolean(record.suppression);
}

export function isOwnerResearchEligible(record: ProspectResearch): boolean {
  return record.cohort.researchEligibility === "primary_owner_cohort" || record.cohort.researchEligibility === "secondary_owner_cohort";
}

export function filterBrazilianProspects(query: string, bucket?: ProspectBucket): ProspectResearch[] {
  const normalized = query.trim().toLocaleLowerCase();
  return BRAZILIAN_LAWYER_PROSPECTS.filter((record) =>
    (!bucket || record.bucket === bucket) &&
    (!normalized || [
      record.name,
      record.firm,
      record.website,
      record.cohort.canonicalPersonId,
      record.cohort.canonicalFirmId,
      ...record.cohort.domainRelationships.map((relationship) => relationship.url),
    ].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized)),
  );
}

export const BUCKET_LABELS: Record<ProspectBucket, string> = {
  explicit: "Brazil-connected: legacy selectable",
  portuguese: "Portuguese-only: Brazil unconfirmed",
  affiliation_review: "Affiliation review: held",
  dnc: "Do not contact: suppressed",
};

export const OWNER_AUTHORITY_LABELS: Record<OwnerAuthorityCode, string> = {
  O1: "Verified owner",
  O2: "Verified operator",
  O3: "Partner or influencer",
  O4: "Ownership unverified",
  O5: "Employee or non-buyer",
};

export const RESEARCH_ELIGIBILITY_LABELS: Record<ResearchEligibility, string> = {
  primary_owner_cohort: "Primary owner cohort",
  secondary_owner_cohort: "Secondary authority cohort",
  hold_owner_authority_review: "Hold for owner-authority review",
  excluded_non_buyer: "Excluded as non-buyer",
  do_not_contact: "Do not contact",
};

function stableSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "unresolved";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function defaultResearchEligibility(bucket: ProspectBucket, authority: OwnerAuthorityCode): ResearchEligibility {
  if (bucket === "dnc") return "do_not_contact";
  if (authority === "O5") return "excluded_non_buyer";
  if (authority === "O1" || authority === "O2") {
    return bucket === "explicit" ? "primary_owner_cohort" : "secondary_owner_cohort";
  }
  return "hold_owner_authority_review";
}

function defaultResearchState(eligibility: ResearchEligibility): ResearchState {
  if (eligibility === "do_not_contact") return "suppressed";
  if (eligibility === "excluded_non_buyer") return "excluded";
  if (eligibility === "primary_owner_cohort" || eligibility === "secondary_owner_cohort") return "eligible";
  return "candidate";
}

function defaultDomainRelationships(args: {
  contact?: PublicContactRecord;
  website?: string;
  mappedDomains?: readonly string[];
}): DomainRelationship[] {
  const relationships = new Map<string, DomainRelationship>();
  const add = (url: string | null | undefined, state: DomainRelationshipState, confidence: EvidenceConfidence) => {
    if (!url || relationships.has(url)) return;
    relationships.set(url, { url, host: hostOf(url), state, confidence });
  };

  add(args.website, "current_primary", "single_source");
  add(args.contact?.bioUrl, "professional_profile", "single_source");
  add(args.contact?.contactSourceUrl, "contact_source", "single_source");
  add(args.contact?.lsoSourceUrl, "regulator", "single_source");
  for (const url of args.mappedDomains ?? []) add(url, "unresolved", "unreviewed");
  return [...relationships.values()];
}

function defaultContactSourceProvenance(args: {
  contact?: PublicContactRecord;
  website?: string;
  email?: string;
  phone?: string;
}): ContactSourceProvenance[] {
  const evidenceIds = args.contact?.provenance ?? [];
  const sourceUrl = args.contact?.contactSourceUrl ?? null;
  const rows: ContactSourceProvenance[] = [];
  if (args.website) rows.push({ field: "website", value: args.website, sourceUrl, evidenceIds, confidence: "single_source" });
  if (args.email) rows.push({ field: "email", value: args.email, sourceUrl, evidenceIds, confidence: "single_source" });
  if (args.phone) rows.push({ field: "phone", value: args.phone, sourceUrl, evidenceIds, confidence: "single_source" });
  return rows;
}

function buildProspectCohort(args: {
  id: string;
  firm: string;
  bucket: ProspectBucket;
  contact?: PublicContactRecord;
  website?: string;
  email?: string;
  phone?: string;
  mappedDomains?: readonly string[];
}): ProspectCohort {
  const authority = args.contact?.ownerAuthority ?? "O4";
  const researchEligibility = args.contact?.researchEligibility ?? defaultResearchEligibility(args.bucket, authority);
  const existingUnknowns = args.contact?.explicitUnknowns ?? args.contact?.unknowns ?? [];
  const explicitUnknowns = authority === "O4"
    ? [...new Set([...existingUnknowns, "Owner or operating authority has not been independently verified."])]
    : [...existingUnknowns];

  return {
    canonicalPersonId: args.contact?.personId ?? `prospect:${args.id}`,
    canonicalFirmId: args.contact?.canonicalFirmId ?? `firm:${stableSlug(args.contact?.firm ?? args.firm)}`,
    ownerAuthority: authority,
    ownerAuthorityEvidence: args.contact?.ownerAuthorityEvidence ?? [],
    researchEligibility,
    researchState: args.contact?.researchState ?? defaultResearchState(researchEligibility),
    interviewState: args.contact?.interviewState ?? "not_started",
    evidenceConfidence: args.contact?.evidenceConfidence ?? "unreviewed",
    domainRelationships: args.contact?.domainRelationships ?? defaultDomainRelationships(args),
    contactSourceProvenance: args.contact?.contactSourceProvenance ?? defaultContactSourceProvenance(args),
    explicitUnknowns,
  };
}

function getResearchPolicy(
  id: string,
  bucket: ProspectBucket,
  contact?: PublicContactSnapshot,
): Pick<ProspectResearch, "researchSet" | "outreachEligibility" | "currentPrimaryFirm" | "suppression" | "unknowns" | "sourceRecordId" | "portugueseBrazilConnection"> {
  const defaultPolicy = {
    researchSet: bucket === "explicit" ? "brazil_connected_ready" : bucket === "portuguese" ? "portuguese_only_brazil_unconfirmed" : bucket === "affiliation_review" ? "affiliation_review" : "not_selectable",
    outreachEligibility: contact?.eligibility as OutreachEligibility | undefined,
    currentPrimaryFirm: contact?.firm ?? null,
    suppression: bucket === "dnc" ? contact?.suppressionReason ?? contact?.eligibility ?? "DO_NOT_COLD_PROSPECT" : null,
    unknowns: contact?.unknowns ?? [],
    portugueseBrazilConnection: contact?.portugueseBrazilConnection ?? undefined,
  } as const;

  if (id === "mariana-peres-toledo") {
    return {
      ...defaultPolicy,
      sourceRecordId: "BAO-PC-000015",
      researchSet: "portuguese_only_brazil_unconfirmed",
      outreachEligibility: "INTERNAL_CANDIDATE_UNSENT",
      portugueseBrazilConnection: {
        category: "Portuguese native",
        evidenceSource: "https://www.siskinds.com/lawyer/mariana-peres-toledo/",
        statement: "Profile lists Portuguese as native.",
      },
      unknowns: ["Profile does not establish a Brazil-practice connection."],
    };
  }

  return defaultPolicy;
}
