import type { Band, ReferralSource, Urgency } from "./cpi";
import type { LeadState } from "./state";

export type Stage =
  | "new_lead"
  | "qualified"
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
  // CPI engine
  fit_score: number | null;
  value_score: number | null;
  cpi_score: number | null;
  band: Band | null;
  referral_source: ReferralSource | null;
  urgency: Urgency | null;
  timeline: string | null;
  city: string | null;
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
  { key: "new_lead", label: "New Lead" },
  { key: "qualified", label: "Qualified" },
  { key: "proposal_sent", label: "Proposal Sent" },
  { key: "client_won", label: "Client Won" },
  { key: "client_lost", label: "Client Lost" },
];

export const BANDS: Band[] = ["A", "B", "C", "D", "E"];
