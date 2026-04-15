/**
 * CaseLoad Select — Priority Scoring Engine v2.1
 *
 * priority_index = fit_score (max 30) + value_score (max 65) = 0–100 (capped)
 *
 * v2.1 changes (April 2026 — LawBrokr research upgrade):
 * - ScoringInput extended: value_tier, complexity_indicators, prior_experience
 * - complexityScore() rewritten: structured practice-specific indicators (max 25)
 * - feeScore() rewritten: value-tier lookup per practice area
 * - strategicScore() updated: prior_experience bonus (+2/+3)
 * - Legacy fallback preserved: all new fields are nullable for backward compat
 */

import type { CaseType } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────

export type PriorityBand = "A" | "B" | "C" | "D" | "E";

export type Urgency = "immediate" | "high" | "medium" | "low"
  | "near_term" | "long"; // legacy values accepted

export type Source =
  | "gbp" | "organic" | "paid" | "referral"
  | "directory" | "social" | "direct";

export type PriorExperience =
  | "has_representation"   // currently has a lawyer, considering switching
  | "had_representation"   // previously represented, no longer
  | "first_time";          // never sought legal help before

export type ValueTier =
  | "tier_1" | "tier_2" | "tier_3" | "tier_4" | "tier_5"
  | null;

export interface ComplexityIndicators {
  contestation_level?:     number;   // 0-8: amicable(2) → fully contested(8)
  children_involved?:      boolean;  // minors in family matters
  special_considerations?: string[]; // flags: domestic_violence, hidden_assets, intl_custody, business_ownership, etc.
  prior_refusal_count?:    number;   // 0, 1, 2+ (immigration)
  liability_clarity?:      number;   // 0-6: clear fault(1) → disputed(6)
  treatment_status?:       string;   // PI: in_treatment, completed, planned, none
  beneficiary_count?:      number;   // wills: 1-2, 3-5, 6+
  employment_factors?:     string[]; // discrimination flags: age, gender, race, disability, reprisal, pregnancy
  salary_range?:           string;   // under_50k, 50k_100k, 100k_200k, over_200k
  tenure_years?:           number;   // employment tenure
}

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
  estimated_value: number | null;   // retained for backward compat
  urgency:        Urgency | null;
  // Strategic signals
  source:         Source | null;
  referral:       boolean;         // referred by existing client
  multi_practice: boolean;         // may need additional legal services

  // ── NEW: Structured qualification inputs (from Step 2 question modules) ──
  value_tier:            ValueTier;           // practice-specific value dropdown
  complexity_indicators: ComplexityIndicators | null;
  prior_experience:      PriorExperience | null;
}

export type Confidence = "high" | "medium" | "low";

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
  // Explainability (v2.2)
  confidence:           Confidence;
  explanation:          string;
  missing_fields:       string[];
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

// ── Case complexity (0–25) ────────────────────────────────────────────────
// Ranges: high 20-25, medium 12-19, low 5-11, unknown 8
// When complexity_indicators are present, use structured scoring.
// Falls back to legacy flat switch when indicators are null.

const PRACTICE_BASE_COMPLEXITY: Record<string, number> = {
  family: 8,
  employment: 7,
  immigration: 6,
  personal_injury: 7,
  wills_estates: 5,
  criminal: 10,
  corporate: 7,
  other: 6,
};

export function complexityScore(
  caseType: CaseType | null,
  value: number,
  indicators?: ComplexityIndicators | null,
): number {
  const MAX = 25;

  // ── Structured scoring (new path) ──────────────────────────────────────
  if (indicators && caseType) {
    let score = PRACTICE_BASE_COMPLEXITY[caseType] ?? 6;

    // Contestation level (family, employment)
    if (indicators.contestation_level != null) {
      score += indicators.contestation_level; // 0-8
    }

    // Children involved (family)
    if (indicators.children_involved) {
      score += 4;
    }

    // Special considerations — additive per flag
    if (indicators.special_considerations?.length) {
      const FLAG_WEIGHTS: Record<string, number> = {
        domestic_violence: 6,
        hidden_assets: 5,
        international_custody: 5,
        business_ownership: 4,
        special_needs_dependents: 4,
        international_assets: 4,
        blended_family: 3,
      };
      for (const flag of indicators.special_considerations) {
        score += FLAG_WEIGHTS[flag] ?? 3;
      }
    }

    // Prior refusal count (immigration)
    if (indicators.prior_refusal_count != null) {
      if (indicators.prior_refusal_count >= 2) score += 5;
      else if (indicators.prior_refusal_count === 1) score += 3;
    }

    // Liability clarity (PI) — disputed = higher complexity
    if (indicators.liability_clarity != null) {
      score += indicators.liability_clarity; // 0-6
    }

    // Treatment status (PI)
    if (indicators.treatment_status) {
      const TREATMENT: Record<string, number> = {
        in_treatment: 5,
        planned: 3,
        completed: 2,
        none: 0,
      };
      score += TREATMENT[indicators.treatment_status] ?? 0;
    }

    // Beneficiary count (wills)
    if (indicators.beneficiary_count != null) {
      if (indicators.beneficiary_count >= 6) score += 3;
      else if (indicators.beneficiary_count >= 3) score += 1;
    }

    // Employment discrimination flags — additive per flag
    if (indicators.employment_factors?.length) {
      score += Math.min(indicators.employment_factors.length * 3, 6);
    }

    return Math.min(score, MAX);
  }

  // ── Legacy fallback (no structured indicators) ─────────────────────────
  switch (caseType) {
    case "criminal":
      return 22;
    case "family":
      if (value >= 25_000) return 20;
      if (value >= 5_000)  return 14;
      return 8;
    case "corporate":
      if (value >= 50_000) return 22;
      if (value >= 10_000) return 16;
      return 8;
    case "immigration":
      if (value >= 10_000) return 14;
      return 8;
    case "other":
      if (value >= 10_000) return 13;
      return 7;
    default:
      return 8;
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
  priorExperience?: PriorExperience | null,
): number {
  let score = 0;

  const isReferral = referral || source === "referral";
  if (isReferral && multiPractice) score = 10;
  else if (isReferral)             score = 7;
  else if (multiPractice)          score = 6;
  else if (source === "gbp" || source === "organic" || source === "directory") score = 4;
  else score = 3;

  // Prior experience bonus — stacks with existing signals
  if (priorExperience === "has_representation") score += 3; // switching lawyers = high intent
  else if (priorExperience === "had_representation") score += 2; // experienced = moderate intent

  return Math.min(score, 10);
}

// ── Fee indicator (0–10) ──────────────────────────────────────────────────

// Value tier mappings per practice area (from LawBrokr research)
// tier_1 = lowest, tier_5 = highest
const VALUE_TIER_SCORES: Record<string, Record<string, number>> = {
  wills_estates:    { tier_1: 2, tier_2: 4, tier_3: 6, tier_4: 8, tier_5: 9 },
  family:           { tier_1: 2, tier_2: 4, tier_3: 6, tier_4: 8, tier_5: 9 },
  employment:       { tier_1: 3, tier_2: 5, tier_3: 7, tier_4: 9, tier_5: 9 },
  personal_injury:  { tier_1: 3, tier_2: 5, tier_3: 7, tier_4: 8, tier_5: 9 },
  immigration:      { tier_1: 3, tier_2: 4, tier_3: 5, tier_4: 7, tier_5: 8 },
  criminal:         { tier_1: 4, tier_2: 5, tier_3: 7, tier_4: 8, tier_5: 9 },
  corporate:        { tier_1: 3, tier_2: 5, tier_3: 7, tier_4: 8, tier_5: 9 },
};

export function feeScore(
  value: number,
  caseType?: CaseType | null,
  valueTier?: ValueTier,
): number {
  // ── Structured path: use value tier when available ──
  if (valueTier && caseType) {
    const tiers = VALUE_TIER_SCORES[caseType] ?? VALUE_TIER_SCORES["other"];
    if (tiers) return tiers[valueTier] ?? 4;
  }

  // ── Legacy fallback: raw estimated_value ──
  if (value >= 15_000) return 9;
  if (value > 0)       return 5;
  return 2;
}

// ── Band ──────────────────────────────────────────────────────────────────

export function priorityBand(index: number): PriorityBand {
  if (index >= 80) return "A";
  if (index >= 60) return "B";
  if (index >= 40) return "C";
  if (index >= 20) return "D";
  return "E";
}

// ── Data completeness (v2.2) ─────────────────────────────────────────────

/**
 * Fields that contribute to scoring accuracy.
 * Each entry maps to a ScoringInput key and a human-readable label
 * used in follow-up messaging when the field is null.
 */
const SCORABLE_FIELDS: { key: keyof ScoringInput; label: string; weight: number }[] = [
  { key: "location",             label: "city or region",          weight: 2 },
  { key: "email",                label: "email address",           weight: 1 },
  { key: "phone",                label: "phone number",            weight: 1 },
  { key: "description",          label: "description of the matter", weight: 3 },
  { key: "timeline",             label: "timeline or deadline",    weight: 2 },
  { key: "case_type",            label: "practice area",           weight: 3 },
  { key: "urgency",              label: "urgency level",           weight: 2 },
  { key: "estimated_value",      label: "estimated case value",    weight: 2 },
  { key: "source",               label: "how they found the firm", weight: 1 },
  { key: "value_tier",           label: "compensation or claim range", weight: 2 },
  { key: "complexity_indicators", label: "case complexity details", weight: 2 },
  { key: "prior_experience",     label: "prior legal experience",  weight: 1 },
];

const MAX_WEIGHT = SCORABLE_FIELDS.reduce((sum, f) => sum + f.weight, 0);

export function detectMissingFields(input: ScoringInput): string[] {
  return SCORABLE_FIELDS
    .filter((f) => {
      const v = input[f.key];
      if (v === null || v === undefined) return true;
      if (typeof v === "string" && v.trim() === "") return true;
      if (typeof v === "number" && v === 0) return true;
      return false;
    })
    .map((f) => f.label);
}

export function computeConfidence(input: ScoringInput): Confidence {
  let filled = 0;
  for (const f of SCORABLE_FIELDS) {
    const v = input[f.key];
    const present =
      v !== null &&
      v !== undefined &&
      !(typeof v === "string" && v.trim() === "") &&
      !(typeof v === "number" && v === 0);
    if (present) filled += f.weight;
  }
  const ratio = filled / MAX_WEIGHT;
  if (ratio >= 0.75) return "high";
  if (ratio >= 0.45) return "medium";
  return "low";
}

// ── Explanation generator (v2.2) ─────────────────────────────────────────

interface ScoreFactor {
  label: string;
  score: number;
  max: number;
}

function buildExplanation(
  factors: ScoreFactor[],
  band: PriorityBand,
  confidence: Confidence,
  missing: string[],
): string {
  // Sort by contribution ratio (score/max), descending
  const ranked = [...factors]
    .map((f) => ({ ...f, ratio: f.max > 0 ? f.score / f.max : 0 }))
    .sort((a, b) => b.ratio - a.ratio);

  const strong = ranked.filter((f) => f.ratio >= 0.7);
  const weak   = ranked.filter((f) => f.ratio <= 0.3 && f.max > 0);

  const parts: string[] = [];

  // Lead with the strongest signals
  if (strong.length > 0) {
    const names = strong.slice(0, 3).map((f) => f.label);
    if (names.length === 1) {
      parts.push(`${names[0]} is the strongest scoring factor.`);
    } else {
      parts.push(`Strongest factors: ${names.join(" and ")}.`);
    }
  }

  // Flag what pulled the score down
  if (weak.length > 0) {
    const names = weak.slice(0, 2).map((f) => f.label);
    parts.push(`${names.join(" and ")} scored low, which limited the overall index.`);
  }

  // If confidence is not high, explain why
  if (confidence === "low" && missing.length > 0) {
    const show = missing.slice(0, 3);
    parts.push(
      `Confidence is low because ${show.join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} other fields` : ""} were not provided. Collecting this data could change the band.`,
    );
  } else if (confidence === "medium" && missing.length > 0) {
    parts.push(
      `Score confidence is moderate. Providing ${missing[0]} would improve accuracy.`,
    );
  }

  return parts.join(" ");
}

// ── Composite ─────────────────────────────────────────────────────────────

export function computeScore(input: ScoringInput): ScoringResult {
  const geo           = geoScore(input.location);
  const contactability = contactabilityScore(input.email, input.phone);
  const legitimacy    = legitimacyScore(input.description, input.timeline);
  const fit           = geo + contactability + legitimacy; // max 30

  const value         = input.estimated_value ?? 0;
  const complexity    = complexityScore(
    input.case_type, value, input.complexity_indicators,
  );
  const urg           = urgencyScore(input.urgency);
  const strategic     = strategicScore(
    input.source, input.referral, input.multi_practice, input.prior_experience,
  );
  const fee           = feeScore(value, input.case_type, input.value_tier);
  const val           = complexity + urg + strategic + fee; // max 65 (25+20+10+10)

  const index         = Math.min(fit + val, 100);
  const band          = priorityBand(index);

  const confidence    = computeConfidence(input);
  const missing       = detectMissingFields(input);

  const explanation   = buildExplanation(
    [
      { label: "Geographic fit",      score: geo,           max: 10 },
      { label: "Contactability",      score: contactability, max: 10 },
      { label: "Inquiry legitimacy",  score: legitimacy,    max: 10 },
      { label: "Case complexity",     score: complexity,    max: 25 },
      { label: "Urgency",             score: urg,           max: 20 },
      { label: "Strategic value",     score: strategic,     max: 10 },
      { label: "Fee capacity",        score: fee,           max: 10 },
    ],
    band,
    confidence,
    missing,
  );

  return {
    geo_score:            geo,
    contactability_score: contactability,
    legitimacy_score:     legitimacy,
    fit_score:            fit,
    complexity_score:     complexity,
    urgency_score:        urg,
    strategic_score:      strategic,
    fee_score:            fee,
    value_score:          val,
    priority_index:       index,
    priority_band:        band,
    confidence,
    explanation,
    missing_fields:       missing,
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
