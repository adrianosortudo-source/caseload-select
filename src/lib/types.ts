import type { Band, ReferralSource } from "./cpi";
import type { Urgency, Source, PriorityBand, Confidence } from "./scoring";
import type { LeadState } from "./state";

export type Stage =
  | "new_lead"
  | "contacted"
  | "qualified"
  | "consultation_scheduled"
  | "consultation_held"
  | "no_show"
  | "proposal_sent"
  | "client_won"
  | "client_lost";

export type CaseType = "immigration" | "corporate" | "family" | "criminal" | "other";
export type Language = "EN" | "PT" | "FR";

export interface LawFirm {
  id: string;
  name: string;
  location: string | null;
  status: string;
  created_at: string;
}

export interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  case_type: CaseType | null;
  estimated_value: number | null;
  language: Language | null;
  description: string | null;
  stage: Stage;
  score: number | null;
  law_firm_id: string | null;
  created_at: string;
  updated_at: string;

  // Legacy CPI (kept for backward compat)
  cpi_score: number | null;
  band: Band | null;

  // Phase 2 — Priority Scoring Engine
  fit_score: number | null;
  value_score: number | null;
  geo_score: number | null;
  contactability_score: number | null;
  legitimacy_score: number | null;
  complexity_score: number | null;
  urgency_score: number | null;
  strategic_score: number | null;
  fee_score: number | null;
  priority_index: number | null;
  priority_band: PriorityBand | null;

  // Explainability (v2.2)
  cpi_confidence: Confidence | null;
  cpi_explanation: string | null;
  cpi_missing_fields: string[] | null;

  // Intake fields
  referral_source: ReferralSource | null;
  urgency: Urgency | null;
  timeline: string | null;
  city: string | null;
  location: string | null;
  source: Source | null;
  referral: boolean | null;
  multi_practice: boolean | null;
  lead_state: LeadState | null;
}

export interface EmailSequence {
  id: string;
  lead_id: string;
  step_number: number;
  status: "scheduled" | "sent" | "failed" | "cancelled";
  scheduled_at: string | null;
  sent_at: string | null;
}

export interface ReviewRequest {
  id: string;
  lead_id: string;
  law_firm_id: string | null;
  status: "sent" | "opened" | "completed" | "failed";
  sent_at: string;
}

export const STAGES: { key: Stage; label: string }[] = [
  { key: "new_lead",               label: "New Lead" },
  { key: "contacted",              label: "Contacted" },
  { key: "qualified",              label: "Qualified" },
  { key: "consultation_scheduled", label: "Consultation" },
  { key: "proposal_sent",          label: "Proposal Sent" },
  { key: "client_won",             label: "Client Won" },
  { key: "client_lost",            label: "Client Lost" },
];

export const BANDS: Band[] = ["A", "B", "C", "D", "E"];
