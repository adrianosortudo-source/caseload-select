/**
 * CaseLoad Select — Live Client Configurations
 *
 * Source of truth for all provisioned client firms.
 * Each config maps directly to an intake_firms record.
 *
 * Practice area IDs must match DEFAULT_QUESTION_MODULES keys.
 * Add a new entry here then run POST /api/admin/provision-clients to apply.
 */

import { DEFAULT_QUESTION_MODULES } from "./default-question-modules";

export interface ClientBranding {
  accent_color: string;
  firm_description: string;
  tagline: string;
  assistant_name: string;
  phone_number: string;
  phone_tel: string;
  booking_url: string;
  privacy_policy_url: string;
}

export interface PracticeAreaConfig {
  id: string;
  label: string;
  classification: "primary" | "secondary" | "out_of_scope";
}

export interface GeographicConfig {
  service_area: string;
  gta_core_description: string;
  partial_description?: string;
  national_practice_areas?: string[];
}

export interface ClientConfig {
  /** Stable slug used for lookup — never change after provisioning */
  slug: string;
  name: string;
  description: string;
  location: string;
  website: string;
  practice_areas: PracticeAreaConfig[];
  geographic_config: GeographicConfig;
  branding: ClientBranding;
  custom_instructions?: string;
}

// ─────────────────────────────────────────────────────────────────
// KennyLaw Professional Corporation
// Etobicoke criminal / family / immigration boutique
// ─────────────────────────────────────────────────────────────────
const KENNY_LAW: ClientConfig = {
  slug: "kennylaw-pc",
  name: "Kenny Law Professional Corporation",
  description: "an Etobicoke law firm serving families, individuals, and newcomers with criminal defence, family law, and immigration matters",
  location: "Etobicoke, Toronto, Ontario",
  website: "https://kennylaw.ca",
  practice_areas: [
    { id: "crim",  label: "Criminal Defence",      classification: "primary"   },
    { id: "fam",   label: "Family Law",             classification: "primary"   },
    { id: "imm",   label: "Immigration & Refugee",  classification: "primary"   },
    { id: "civ",   label: "Civil Litigation",       classification: "secondary" },
  ],
  geographic_config: {
    service_area: "Etobicoke and Greater Toronto Area, Ontario",
    gta_core_description:
      "Etobicoke, Toronto, Mississauga, Brampton, Oakville, Burlington",
    partial_description: "All of Ontario for immigration matters",
    national_practice_areas: ["imm"],
  },
  branding: {
    accent_color: "#1B3A6B",
    firm_description:
      "an Etobicoke law firm serving families, individuals, and newcomers with criminal defence, family law, and immigration matters",
    tagline: "Local Counsel. Trusted Results.",
    assistant_name: "Alex",
    phone_number: "(416) 555-0100", // placeholder — update after onboarding call
    phone_tel: "tel:+14165550100",
    booking_url: "https://kennylaw.ca/book",
    privacy_policy_url: "https://kennylaw.ca/privacy",
  },
  custom_instructions:
    "This firm serves a predominantly Etobicoke-area clientele including newcomers and immigrants. " +
    "For immigration inquiries, always ask about the client's current immigration status first. " +
    "Commissioner of Oaths and Notary service requests should be noted in flags but routed to the firm directly — " +
    "these are administrative services, not legal matters requiring CPI scoring.",
};

// ─────────────────────────────────────────────────────────────────
// Powell Litigation
// Downtown Toronto + North York civil litigation firm, 4 attorneys
// ─────────────────────────────────────────────────────────────────
const POWELL_LITIGATION: ClientConfig = {
  slug: "powell-litigation",
  name: "Powell Litigation",
  description: "a Toronto civil litigation firm with offices in downtown and North York, handling complex commercial and personal disputes for individuals and businesses",
  location: "Toronto, Ontario (Downtown + North York)",
  website: "https://ontariolitigationlawyers.com",
  practice_areas: [
    { id: "civ",    label: "Civil Litigation",          classification: "primary"   },
    { id: "emp",    label: "Employment Law",             classification: "primary"   },
    { id: "const",  label: "Construction Law",           classification: "primary"   },
    { id: "ins",    label: "Insurance Law",              classification: "primary"   },
    { id: "defam",  label: "Defamation",                 classification: "primary"   },
    { id: "fran",   label: "Franchise Law",              classification: "primary"   },
    { id: "ip",     label: "Intellectual Property",      classification: "primary"   },
    { id: "corp",   label: "Corporate & Commercial",     classification: "primary"   },
    { id: "llt",    label: "Landlord & Tenant",          classification: "primary"   },
    { id: "condo",  label: "Condominium Law",            classification: "primary"   },
    { id: "pi",     label: "Personal Injury",            classification: "secondary" },
    { id: "real",   label: "Real Estate Law",            classification: "secondary" },
  ],
  geographic_config: {
    service_area: "Toronto and Greater Toronto Area, Ontario",
    gta_core_description:
      "Toronto (Downtown Core, North York), Mississauga, Markham, Vaughan, Richmond Hill, Brampton, Oakville",
    partial_description: "All of Ontario for complex commercial litigation",
  },
  branding: {
    accent_color: "#1a2e4a",
    firm_description:
      "a Toronto civil litigation firm handling complex commercial and personal disputes for individuals and businesses",
    tagline: "Principled Advocacy. Proven Results.",
    assistant_name: "Alex",
    phone_number: "(416) 555-0200", // placeholder — update with live number
    phone_tel: "tel:+14165550200",
    booking_url: "https://ontariolitigationlawyers.com/contact",
    privacy_policy_url: "https://ontariolitigationlawyers.com/privacy",
  },
  custom_instructions:
    "This is a litigation-focused firm. Prioritize disputes with clear monetary claims, identifiable opposing parties, " +
    "and documented evidence. For personal injury matters, clarify whether the client wants to pursue through " +
    "litigation (this firm's strength) vs. insurance arbitration. Large commercial matters (>$100k) " +
    "are the firm's sweet spot — apply a value_score boost for high-stakes claims.",
};

// ─────────────────────────────────────────────────────────────────
// Sakuraba Law
// Multilingual Toronto immigration + criminal defence boutique
// ─────────────────────────────────────────────────────────────────
const SAKURABA_LAW: ClientConfig = {
  slug: "sakuraba-law",
  name: "Sakuraba Law",
  description: "a multilingual Toronto law firm serving English, Portuguese, French, and Spanish-speaking clients across immigration, criminal defence, family law, and more",
  location: "120 Eglinton Ave E, Suite 202, Toronto, Ontario M4P 1E2",
  website: "https://sakurabalaw.ca",
  practice_areas: [
    { id: "imm",   label: "Immigration & Refugee",  classification: "primary"   },
    { id: "crim",  label: "Criminal Defence",        classification: "primary"   },
    { id: "fam",   label: "Family Law",              classification: "primary"   },
    { id: "emp",   label: "Employment Law",          classification: "primary"   },
    { id: "corp",  label: "Corporate & Commercial",  classification: "primary"   },
    { id: "real",  label: "Real Estate Law",         classification: "primary"   },
    { id: "est",   label: "Wills & Estates",         classification: "primary"   },
    { id: "civ",   label: "Civil Litigation",        classification: "primary"   },
    { id: "llt",   label: "Landlord & Tenant",       classification: "secondary" },
  ],
  geographic_config: {
    service_area: "Toronto and Greater Toronto Area, Ontario",
    gta_core_description:
      "Toronto (Midtown, Downtown, East York), North York, Scarborough, Mississauga, Brampton, Markham",
    partial_description: "All of Ontario and Canada for immigration matters",
    national_practice_areas: ["imm"],
  },
  branding: {
    accent_color: "#1B3A6B",
    firm_description:
      "a multilingual Toronto law firm serving English, Portuguese, French, and Spanish-speaking clients",
    tagline: "Your Rights. Your Language. Your Lawyer.",
    assistant_name: "Alex",
    phone_number: "(905) 393-2999",
    phone_tel: "tel:+19053932999",
    booking_url: "https://sakuraba.cliogrow.com/book/3314a0de654ec8a3f24857fcab246b33",
    privacy_policy_url: "https://sakurabalaw.ca/privacy",
  },
  custom_instructions:
    "This firm's primary strength is immigration law and criminal defence. " +
    "When immigration matters arise, ask about the client's current status (PR, work permit, visitor, etc.) early. " +
    "Celso Sakuraba is fluent in Portuguese, Spanish, and English; the team also covers French. " +
    "For Portuguese or Spanish-speaking clients, flag language preference in extracted_entities. " +
    "Refugee and asylum claims are handled — treat with elevated urgency_score (floor 8). " +
    "This firm was the reference client for CaseLoad Select system design.",
};

// ─────────────────────────────────────────────────────────────────
// Registry — all live clients
// ─────────────────────────────────────────────────────────────────
export const CLIENT_CONFIGS: ClientConfig[] = [
  KENNY_LAW,
  POWELL_LITIGATION,
  SAKURABA_LAW,
];

/**
 * Build question_sets for a client by filtering DEFAULT_QUESTION_MODULES
 * to only the practice areas the firm handles.
 */
export function buildClientQuestionSets(
  practiceAreas: PracticeAreaConfig[]
): Record<string, unknown> {
  const sets: Record<string, unknown> = {};
  for (const pa of practiceAreas) {
    if (pa.classification === "out_of_scope") continue;
    const module = DEFAULT_QUESTION_MODULES[pa.id];
    if (module) sets[pa.id] = module;
  }
  return sets;
}
