/**
 * Shared demo firm provisioning — used by /demo, /demo/whatsapp, /demo/sms.
 *
 * Finds or creates the "Hartwell Law PC [DEMO]" firm and always refreshes
 * question sets so module fixes auto-apply on every page load.
 */

import { supabase } from "@/lib/supabase";
import { DEFAULT_QUESTION_MODULES } from "@/lib/default-question-modules";

export const DEMO_FIRM_NAME = "Hartwell Law PC [DEMO]";

export const ALL_PRACTICE_AREAS = [
  { id: "fam",     label: "Family Law",                      classification: "primary" },
  { id: "pi",      label: "Personal Injury",                 classification: "primary" },
  { id: "emp",     label: "Employment Law",                   classification: "primary" },
  { id: "crim",    label: "Criminal Defence",                 classification: "primary" },
  { id: "real",    label: "Real Estate Law",                  classification: "primary" },
  { id: "corp",    label: "Corporate & Commercial",           classification: "primary" },
  { id: "est",     label: "Wills & Estates",                  classification: "primary" },
  { id: "llt",     label: "Landlord & Tenant",                classification: "primary" },
  { id: "civ",     label: "Civil Litigation",                 classification: "primary" },
  { id: "imm",     label: "Immigration & Refugee",            classification: "primary" },
  { id: "ip",      label: "Intellectual Property",            classification: "primary" },
  { id: "tax",     label: "Tax Law",                          classification: "primary" },
  { id: "admin",   label: "Administrative & Regulatory",      classification: "primary" },
  { id: "ins",     label: "Insurance Law",                    classification: "primary" },
  { id: "const",   label: "Construction Law",                 classification: "primary" },
  { id: "bank",    label: "Bankruptcy & Insolvency",          classification: "primary" },
  { id: "priv",    label: "Privacy & Data Protection",        classification: "primary" },
  { id: "fran",    label: "Franchise Law",                    classification: "primary" },
  { id: "env",     label: "Environmental Law",                classification: "primary" },
  { id: "prov",    label: "Provincial Offences",              classification: "primary" },
  { id: "condo",   label: "Condominium Law",                  classification: "primary" },
  { id: "hr",      label: "Human Rights",                     classification: "primary" },
  { id: "edu",     label: "Education Law",                    classification: "primary" },
  { id: "health",  label: "Healthcare & Medical Regulatory",  classification: "primary" },
  { id: "debt",    label: "Debt Collection",                  classification: "primary" },
  { id: "nfp",     label: "Charity & NFP",                    classification: "primary" },
  { id: "defam",   label: "Defamation",                       classification: "primary" },
  { id: "socben",  label: "Social Benefits",                  classification: "primary" },
  { id: "gig",     label: "Gig Economy",                      classification: "primary" },
  { id: "sec",     label: "Securities Law",                   classification: "primary" },
  { id: "elder",   label: "Elder Law",                        classification: "primary" },
  { id: "str",     label: "Short-Term Rental",                classification: "primary" },
  { id: "crypto",  label: "Cryptocurrency",                   classification: "primary" },
  { id: "ecom",    label: "E-Commerce",                       classification: "primary" },
  { id: "animal",  label: "Animal Law",                       classification: "primary" },
];

const GEO_CONFIG = {
  service_area: "Ontario, Canada",
  gta_core_description:
    "Toronto, Mississauga, Brampton, Markham, Vaughan, Richmond Hill, Pickering, Ajax, Whitby, Oakville, Burlington",
  partial_description: "Greater Ontario outside GTA core",
  national_practice_areas: ["imm", "tax", "ip", "sec"],
};

export interface DemoFirmBranding {
  accent_color: string;
  firm_description: string;
  tagline: string;
  assistant_name: string;
  phone_number: string;
  phone_tel: string;
  booking_url: string;
  privacy_policy_url: string;
}

/**
 * Returns the demo firm ID and branding config. Creates the firm if it doesn't exist,
 * and always refreshes question_sets from DEFAULT_QUESTION_MODULES.
 */
export async function provisionDemoFirm(): Promise<{ firmId: string; branding: DemoFirmBranding } | { error: string }> {
  const { data: existingRows } = await supabase
    .from("intake_firms")
    .select("id, question_sets, branding")
    .eq("name", DEMO_FIRM_NAME)
    .limit(1);

  const existing = existingRows?.[0] ?? null;

  const DEMO_BRANDING: DemoFirmBranding = {
    accent_color: "#1B3A6B",
    firm_description:
      "a full-service Ontario law firm serving individuals and businesses across the Greater Toronto Area",
    tagline: "Strategic Legal Counsel. Better Cases.",
    assistant_name: "Alex",
    phone_number: "(416) 555-2847",
    phone_tel: "tel:+14165552847",
    booking_url: "https://calendly.com/hartwelllaw/consultation",
    privacy_policy_url: "/privacy",
  };

  if (!existing) {
    const { data: created, error } = await supabase
      .from("intake_firms")
      .insert({
        name: DEMO_FIRM_NAME,
        location: "Toronto, Ontario",
        practice_areas: ALL_PRACTICE_AREAS,
        geographic_config: GEO_CONFIG,
        question_sets: DEFAULT_QUESTION_MODULES,
        branding: DEMO_BRANDING,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { error: error?.message ?? "Insert returned no data" };
    }
    return { firmId: created.id, branding: DEMO_BRANDING };
  }

  // Always refresh question sets and branding so fixes auto-apply
  await supabase
    .from("intake_firms")
    .update({ question_sets: DEFAULT_QUESTION_MODULES, branding: DEMO_BRANDING })
    .eq("id", existing.id);

  // Stored record wins for any overrides Adriano may have set manually
  const storedBranding = (existing.branding as Partial<DemoFirmBranding>) ?? {};
  const mergedBranding: DemoFirmBranding = { ...DEMO_BRANDING, ...storedBranding };

  return { firmId: existing.id, branding: mergedBranding };
}
