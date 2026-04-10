/**
 * CaseLoad Select — Priority Scoring Engine v2
 *
 * priority_index = fit_score (max 30) + value_score (max 70) = 0–100
 * Replaces the legacy CPI engine. cpi_score / band kept in DB for backward compat.
 */

import type { CaseType } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────

export type PriorityBand = "A" | "B" | "C" | "D" | "E";

export type Urgency = "immediate" | "high" | "medium" | "low"
  | "near_term" | "long"; // legacy values accepted

export type Source =
  | "gbp" | "organic" | "paid" | "referral"
  | "directory" | "social" | "direct";

export interface ScoringInput {
  // Contact
  email:          string | null;
  phone:          string | null;
  // Geography
  location:       string | null;   // city / region
  // Inquiry quality
  description:    string | null;
  timeline:       string | null;
  // Case details
  case_type:      CaseType | null;
  estimated_value: number | null;
  urgency:        Urgency | null;
  // Strategic signals
  source:         Source | null;
  referral:       boolean;         // referred by existing client
  multi_practice: boolean;         // may need additional legal services
}

export interface ScoringResult {
  // Fit sub-scores
  geo_score:            number;
  contactability_score: number;
  legitimacy_score:     number;
  fit_score:            number;   // max 30
  // Value sub-scores
  complexity_score:     number;
  urgency_score:        number;
  strategic_score:      number;
  fee_score:            number;
  value_score:          number;   // max 70
  // Composite
  priority_index:       number;   // max 100
  priority_band:        PriorityBand;
}

// ── Dropdown options (used by form) ───────────────────────────────────────

export const URGENCY_OPTIONS: { value: Urgency; label: string }[] = [
  { value: "immediate", label: "Immediate — court date / active deadline (≤30 days)" },
  { value: "high",      label: "High — needs representation within 2 weeks" },
  { value: "medium",    label: "Medium — 1–2 months, no hard deadline" },
  { value: "low",       label: "Low — researching, no urgency" },
];

export const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: "referral",  label: "Referral (existing client)" },
  { value: "gbp",       label: "Google Business Profile" },
  { value: "organic",   label: "Organic search" },
  { value: "directory", label: "Legal directory" },
  { value: "social",    label: "Social media" },
  { value: "paid",      label: "Paid advertising" },
  { value: "direct",    label: "Direct / word of mouth" },
];

// ── Geography (0–10) ──────────────────────────────────────────────────────

const GTA_CORE = [
  "toronto","north york","scarborough","etobicoke","east york","york",
  "mississauga","brampton","markham","vaughan","richmond hill","oakville",
  "burlington","milton","ajax","pickering","whitby","oshawa","caledon","halton hills",
];
const ONTARIO_SERVICEABLE = [
  "hamilton","barrie","guelph","kitchener","waterloo","cambridge",
  "st catharines","niagara falls","st. catharines","welland",
  "newmarket","aurora","bradford","king city","uxbridge","stouffville",
  "grimsby","fort erie","orangeville",
];
const ONTARIO_BROADER = [
  "ottawa","london","windsor","sudbury","thunder bay","kingston","peterborough",
  "sault ste marie","north bay","belleville","brantford","sarnia","chatham",
];

export function geoScore(location: string | null): number {
  if (!location) return 0;
  const c = location.trim().toLowerCase();
  if (GTA_CORE.some((x) => c.includes(x)))           return 10;
  if (ONTARIO_SERVICEABLE.some((x) => c.includes(x))) return 6;
  if (ONTARIO_BROADER.some((x) => c.includes(x)))     return 2;
  if (c.includes("ontario") || c.match(/ on\b/))      return 2;
  return 0;
}

// ── Contactability (0–10) ─────────────────────────────────────────────────

export function contactabilityScore(email: string | null, phone: string | null): number {
  const hasEmail = !!email && email.trim().length > 3;
  const hasPhone = !!phone && phone.trim().length > 5;
  if (hasEmail && hasPhone) return 10;
  if (hasPhone)             return 7;
  if (hasEmail)             return 4;
  return 1;
}

// ── Inquiry legitimacy (0–10) ─────────────────────────────────────────────

const SPAM_MARKERS =
  /(seo|backlink|crypto|escort|viagra|guest post|link exchange|adult)/i;

export function legitimacyScore(
  description: string | null,
  timeline: string | null,
): number {
  const d = (description ?? "").trim();
  const t = (timeline ?? "").trim();
  if (d && SPAM_MARKERS.test(d)) return 0;
  if (d.length >= 120 && t.length > 0) return 10;  // specific matter + timeline
  if (d.length >= 60 || t.length > 0)  return 6;   // general / identifiable
  if (d.length > 0)                    return 3;   // vague
  return 0;
}

// ── Case complexity (0–30) ────────────────────────────────────────────────
// Ranges from spec: high 25-30, medium 14-24, low 5-13, unknown 10

export function complexityScore(
  caseType: CaseType | null,
  value: number,
): number {
  switch (caseType) {
    case "criminal":
      return 26;                             // contested litigation — high
    case "family":
      if (value >= 25_000) return 27;        // contested / high-stakes
      if (value >= 5_000)  return 18;        // uncontested / standard
      return 9;                              // simple / unknown scope
    case "corporate":
      if (value >= 50_000) return 28;        // complex commercial
      if (value >= 10_000) return 20;        // standard commercial
      return 10;                             // routine transaction
    case "immigration":
      if (value >= 10_000) return 17;        // sponsorship / appeals
      return 9;                              // admin / routine
    case "other":
      if (value >= 10_000) return 16;
      return 8;
    default:
      return 10;                             // unknown
  }
}

// ── Urgency (0–20) ────────────────────────────────────────────────────────

export function urgencyScore(urgency: Urgency | null): number {
  switch (urgency) {
    case "immediate":  return 19;
    case "high":
    case "near_term":  return 14;
    case "medium":     return 8;
    case "low":
    case "long":       return 2;
    default:           return 8;
  }
}

// ── Strategic value (0–10) ────────────────────────────────────────────────

export function strategicScore(
  source: Source | null,
  referral: boolean,
  multiPractice: boolean,
): number {
  const isReferral = referral || source === "referral";
  if (isReferral && multiPractice) return 10;
  if (isReferral)                  return 7;
  if (multiPractice)               return 6;
  // Source-weighted fallback
  if (source === "gbp" || source === "organic" || source === "directory") return 4;
  return 3;
}

// ── Fee indicator (0–10) ──────────────────────────────────────────────────

export function feeScore(value: number): number {
  if (value >= 15_000) return 9;   // confirmed / clearly computable
  if (value > 0)       return 5;   // implied from practice area + urgency
  return 2;                        // unknown
}

// ── Band ──────────────────────────────────────────────────────────────────

export function priorityBand(index: number): PriorityBand {
  if (index >= 80) return "A";
  if (index >= 60) return "B";
  if (index >= 40) return "C";
  if (index >= 20) return "D";
  return "E";
}

// ── Composite ─────────────────────────────────────────────────────────────

export function computeScore(input: ScoringInput): ScoringResult {
  const geo           = geoScore(input.location);
  const contactability = contactabilityScore(input.email, input.phone);
  const legitimacy    = legitimacyScore(input.description, input.timeline);
  const fit           = geo + contactability + legitimacy; // max 30

  const value         = input.estimated_value ?? 0;
  const complexity    = complexityScore(input.case_type, value);
  const urgency       = urgencyScore(input.urgency);
  const strategic     = strategicScore(input.source, input.referral, input.multi_practice);
  const fee           = feeScore(value);
  const val           = complexity + urgency + strategic + fee; // max 70

  const index         = fit + val;

  return {
    geo_score:            geo,
    contactability_score: contactability,
    legitimacy_score:     legitimacy,
    fit_score:            fit,
    complexity_score:     complexity,
    urgency_score:        urgency,
    strategic_score:      strategic,
    fee_score:            fee,
    value_score:          val,
    priority_index:       index,
    priority_band:        priorityBand(index),
  };
}

// ── Band display colours (mirrors cpi.ts BAND_COLORS) ────────────────────

export const PRIORITY_BAND_COLORS: Record<
  PriorityBand,
  { bg: string; text: string; label: string }
> = {
  A: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Band A · 80–100" },
  B: { bg: "bg-lime-100",    text: "text-lime-700",    label: "Band B · 60–79"  },
  C: { bg: "bg-amber-100",   text: "text-amber-700",   label: "Band C · 40–59"  },
  D: { bg: "bg-orange-100",  text: "text-orange-700",  label: "Band D · 20–39"  },
  E: { bg: "bg-rose-100",    text: "text-rose-700",    label: "Band E · 0–19"   },
};

export const PRIORITY_BAND_FILL: Record<PriorityBand, string> = {
  A: "bg-emerald-500",
  B: "bg-lime-500",
  C: "bg-amber-500",
  D: "bg-orange-500",
  E: "bg-rose-500",
};
