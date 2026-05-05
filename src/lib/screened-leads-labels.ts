/**
 * Display-label mappings for screened_leads values. Mirrors what the Vite
 * screen renders at the top of its case file. Keeping a small local copy
 * here avoids cross-app type imports for the lawyer portal.
 *
 * Source of truth lives in the screen at:
 *   D:\00_Work\01_CaseLoad_Select\CaseLoadScreen_2.0_2026-05-03\src\main.ts
 *   (MATTER_LABELS and PRACTICE_AREA_LABELS)
 *
 * If the screen adds a new matter type, mirror it here. The TS exhaustiveness
 * check on `matterLabel` does not cover unknown values from the DB, so a
 * missing entry is rendered as the raw id (acceptable fallback).
 */

export const MATTER_LABELS: Record<string, string> = {
  business_setup_advisory: "Business Setup Advisory",
  shareholder_dispute: "Shareholder Dispute",
  unpaid_invoice: "Unpaid Invoice",
  contract_dispute: "Contract Dispute",
  vendor_supplier_dispute: "Vendor / Supplier Dispute",
  corporate_money_control: "Corporate Financial Concern",
  corporate_general: "Corporate Matter · Routing",
  commercial_real_estate: "Commercial Real Estate",
  residential_purchase_sale: "Residential Purchase / Sale",
  real_estate_litigation: "Real Estate Litigation",
  landlord_tenant: "Landlord / Tenant",
  construction_lien: "Construction Lien",
  preconstruction_condo: "Pre-Construction Condo",
  mortgage_dispute: "Mortgage / Power of Sale",
  real_estate_general: "Real Estate Matter · Routing",
  out_of_scope: "Out of Scope · Forwarded",
  unknown: "Awaiting Classification",
};

export const PRACTICE_AREA_LABELS: Record<string, string> = {
  corporate: "Corporate",
  real_estate: "Real Estate",
  family: "Family Law",
  immigration: "Immigration",
  employment: "Employment",
  criminal: "Criminal",
  personal_injury: "Personal Injury",
  estates: "Wills and Estates",
  unknown: "Other",
};

export function matterLabel(matter: string | null | undefined): string {
  if (!matter) return MATTER_LABELS.unknown;
  return MATTER_LABELS[matter] ?? matter;
}

export function practiceAreaLabel(area: string | null | undefined): string {
  if (!area) return PRACTICE_AREA_LABELS.unknown;
  return PRACTICE_AREA_LABELS[area] ?? area;
}

export const BAND_C_SUBTRACK_LABELS: Record<string, string> = {
  fast_transaction: "Fast transaction",
  window_shopper: "Window shopper",
  wrong_fit: "Wrong fit",
};

export function subtrackLabel(s: string | null | undefined): string | null {
  if (!s) return null;
  return BAND_C_SUBTRACK_LABELS[s] ?? s;
}
