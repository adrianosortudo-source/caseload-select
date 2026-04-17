import type { CaseType } from "./types";

// ---------- Input shape ----------
export interface CpiInput {
  city: string | null;
  email: string | null;
  phone: string | null;
  description: string | null;
  timeline: string | null;             // free text (used to judge legitimacy)
  referral_source: ReferralSource | null;
  case_type: CaseType | null;
  estimated_value: number | null;
  urgency: Urgency | null;
}

export type ReferralSource =
  | "former_client"
  | "professional_referral"
  | "structured_partner"
  | "friend_family"
  | "cold_organic"
  | "cold_paid";

export type Urgency = "immediate" | "near_term" | "medium" | "long";
export type Band = "A" | "B" | "C" | "D" | "E";

export const REFERRAL_OPTIONS: { value: ReferralSource; label: string }[] = [
  { value: "former_client", label: "Former client" },
  { value: "professional_referral", label: "Professional referral" },
  { value: "structured_partner", label: "Structured partner" },
  { value: "friend_family", label: "Friend or family" },
  { value: "cold_organic", label: "Cold (organic)" },
  { value: "cold_paid", label: "Cold (paid)" },
];

export const URGENCY_OPTIONS: { value: Urgency; label: string }[] = [
  { value: "immediate", label: "Immediate deadline" },
  { value: "near_term", label: "Near-term (≤ 2 weeks)" },
  { value: "medium", label: "Medium (1–2 months)" },
  { value: "long", label: "Long horizon" },
];

// ---------- Geography ----------
// GTA core (10), Ontario serviceable within radius (6), Ontario outside (2), outside ON (0).
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
const ONTARIO_CITIES = [
  "ottawa","london","windsor","sudbury","thunder bay","kingston","peterborough",
  "sault ste marie","north bay","belleville","brantford","sarnia","chatham",
];

export function geoScore(cityRaw: string | null): number {
  if (!cityRaw) return 0;
  const c = cityRaw.trim().toLowerCase();
  if (!c) return 0;
  if (GTA_CORE.some((x) => c.includes(x))) return 10;
  if (ONTARIO_SERVICEABLE.some((x) => c.includes(x))) return 6;
  if (ONTARIO_CITIES.some((x) => c.includes(x))) return 2;
  if (c.includes("ontario") || c.endsWith(" on")) return 2;
  return 0;
}

// ---------- Contactability ----------
export function contactabilityScore(email: string | null, phone: string | null): number {
  const hasEmail = !!email && email.trim().length > 3;
  const hasPhone = !!phone && phone.trim().length > 5;
  if (hasEmail && hasPhone) return 10;
  if (hasPhone) return 7;
  if (hasEmail) return 4;
  return 1;
}

// ---------- Inquiry legitimacy ----------
const SPAM_MARKERS = /(seo|backlink|crypto|escort|viagra|guest post|link exchange)/i;
export function legitimacyScore(description: string | null, timeline: string | null): number {
  const d = (description ?? "").trim();
  const t = (timeline ?? "").trim();
  if (d && SPAM_MARKERS.test(d)) return 0;
  if (d.length >= 120 && t.length > 0) return 10;
  if (d.length >= 60 || t.length > 0) return 6;
  if (d.length > 0) return 3;
  return 0;
}

// ---------- Referral ----------
export function referralScore(src: ReferralSource | null): number {
  switch (src) {
    case "former_client":
    case "professional_referral":
      return 10;
    case "structured_partner":
      return 8;
    case "friend_family":
      return 7;
    case "cold_organic":
      return 4;
    case "cold_paid":
      return 3;
    default:
      return 3;
  }
}

// ---------- Complexity (derived) ----------
// Derived from case_type + estimated_value. No extra form field.
export function complexityScore(caseType: CaseType | null, value: number | null): number {
  const v = value ?? 0;
  const highType = caseType === "corporate" || caseType === "immigration";
  if (highType && v >= 50_000) return 22; // high
  if (v >= 25_000 || highType) return 15; // medium
  if (v > 0 && caseType) return 8; // low
  return 8; // unknown default
}

// ---------- Urgency ----------
export function urgencyScore(u: Urgency | null): number {
  switch (u) {
    case "immediate": return 19;
    case "near_term": return 14;
    case "medium":    return 8;
    case "long":      return 3;
    default:          return 8;
  }
}

// ---------- Multi-practice potential (derived) ----------
// Heuristic: corporate and immigration often spawn secondary matters.
export function multiPracticeScore(caseType: CaseType | null): number {
  if (caseType === "corporate" || caseType === "immigration") return 4;
  if (caseType === "family" || caseType === "criminal") return 2;
  return 0;
}

// ---------- Fee indicator (derived from estimated_value) ----------
export function feeScore(value: number | null): number {
  const v = value ?? 0;
  if (v >= 25_000) return 9;   // confirmed range
  if (v > 0) return 5;         // implied
  return 2;                    // unknown
}

// ---------- Composite ----------
export function computeCpi(input: CpiInput) {
  const geo = geoScore(input.city);
  const contact = contactabilityScore(input.email, input.phone);
  const legit = legitimacyScore(input.description, input.timeline);
  const ref = referralScore(input.referral_source);
  const fit = geo + contact + legit + ref; // 0..40

  const complex = complexityScore(input.case_type, input.estimated_value);
  const urg = urgencyScore(input.urgency);
  const multi = multiPracticeScore(input.case_type);
  const fee = feeScore(input.estimated_value);
  const value = complex + urg + multi + fee; // 0..60

  const cpi = fit + value; // 0..100

  const band: Band =
    cpi >= 80 ? "A" : cpi >= 60 ? "B" : cpi >= 40 ? "C" : cpi >= 20 ? "D" : "E";

  return {
    fit_score: fit,
    value_score: value,
    cpi_score: cpi,
    band,
    breakdown: { geo, contact, legit, ref, complex, urg, multi, fee },
  };
}

export const BAND_COLORS: Record<Band, { bg: string; text: string; label: string }> = {
  A: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Band A · 80–100" },
  B: { bg: "bg-lime-100",    text: "text-lime-700",    label: "Band B · 60–79"  },
  C: { bg: "bg-amber-100",   text: "text-amber-700",   label: "Band C · 40–59"  },
  D: { bg: "bg-orange-100",  text: "text-orange-700",  label: "Band D · 20–39"  },
  E: { bg: "bg-rose-100",    text: "text-rose-700",    label: "Band E · 0–19"   },
};
