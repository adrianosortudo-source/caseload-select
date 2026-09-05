import { PUBLIC_CONTACT_SNAPSHOT } from "./brazilian-prospect-contacts.snapshot";

export type ProspectBucket = "explicit" | "portuguese" | "affiliation_review" | "dnc";
export type ResearchSet = "brazil_connected_ready" | "portuguese_only_brazil_unconfirmed" | "affiliation_review" | "not_selectable";
export type OutreachEligibility =
  | "INTERNAL_CANDIDATE_UNSENT"
  | "INTERNAL_CANDIDATE_UNSENT_AFFILIATION_REVIEW"
  | "DO_NOT_COLD_PROSPECT"
  | "DO_NOT_CONTACT_CONFLICT_PENDING";

type PublicContactSnapshot = (typeof PUBLIC_CONTACT_SNAPSHOT)[number];

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
  publicContact?: Pick<PublicContactSnapshot, "email" | "phone" | "website" | "bioUrl" | "contactSourceUrl" | "lsoSourceUrl" | "provenance" | "lsoNumber" | "practiceAreas" | "status" | "role" | "suppressionReason">;
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

export const BRAZILIAN_LAWYER_PROSPECTS: readonly ProspectResearch[] = PROSPECT_SEEDS.map(([id,name,firm,bucket,evidence,website,email,phone,domains,note]): ProspectResearch => {
  const contact = PUBLIC_CONTACT_SNAPSHOT.find((candidate) => candidate.name === name);
  const policy = getResearchPolicy(id, bucket, contact);
  return {
    id, name, firm, bucket, evidence, domains, note,
    ...policy,
    personId: contact?.personId,
    website: contact?.website ?? website,
    email: contact?.email ?? email,
    phone: contact?.phone ?? phone,
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

export function isSelectable(record: ProspectResearch): boolean {
  return record.researchSet === "brazil_connected_ready" && record.outreachEligibility === "INTERNAL_CANDIDATE_UNSENT" && !record.suppression;
}

export function isSuppressed(record: ProspectResearch): boolean {
  return record.researchSet === "not_selectable" && Boolean(record.suppression);
}

export function filterBrazilianProspects(query: string, bucket?: ProspectBucket): ProspectResearch[] {
  const normalized = query.trim().toLocaleLowerCase();
  return BRAZILIAN_LAWYER_PROSPECTS.filter((record) =>
    (!bucket || record.bucket === bucket) &&
    (!normalized || [record.name, record.firm, record.website, ...(record.domains ?? [])].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized)),
  );
}

export const BUCKET_LABELS: Record<ProspectBucket, string> = {
  explicit: "Brazil-connected — selectable",
  portuguese: "Portuguese-only — unconfirmed",
  affiliation_review: "Affiliation review — held",
  dnc: "Do not contact — suppressed",
};

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
