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

  // Phase 2  -  Priority Scoring Engine
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

// ─── S8 Phase 1 ───────────────────────────────────────────────────────────
// Client matter state machine, messages, role model. See migrations
// 20260520_s8p1_*.sql and docs/stories/S8.Phase1.*.md.

export type MatterStage = "intake" | "retainer_pending" | "active" | "closing" | "closed";
export const MATTER_STAGES: { key: MatterStage; label: string }[] = [
  { key: "intake", label: "Intake" },
  { key: "retainer_pending", label: "Retainer pending" },
  { key: "active", label: "Active" },
  { key: "closing", label: "Closing" },
  { key: "closed", label: "Closed" },
];

export type ActorRole = "admin" | "staff" | "operator" | "client" | "system";
export type ChannelType = "client" | "internal";
export type RecipientScope = "individual" | "group" | "company";

export interface ClientMatter {
  id: string;
  firm_id: string;
  source_screened_lead_id: string | null;
  lead_id: string | null;
  assignee_ids: string[];
  matter_stage: MatterStage;
  matter_stage_changed_at: string;
  matter_type: string;
  practice_area: string;
  primary_name: string;
  primary_email: string | null;
  primary_phone: string | null;
  welcome_draft_html: string | null;
  welcome_draft_plain_text: string | null;
  welcome_draft_edited_html: string | null;
  welcome_draft_sent_at: string | null;
  welcome_draft_sent_body: string | null;
  embed_url: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatterStageEvent {
  id: string;
  matter_id: string;
  firm_id: string;
  from_stage: MatterStage | null;
  to_stage: MatterStage;
  actor_role: "admin" | "staff" | "operator" | "system";
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export interface MatterAttachment {
  storage_path?: string; // primary: object key in firm-files bucket
  url?: string;          // legacy shape (unused in practice)
  signed_url?: string;   // runtime only: pre-signed read URL
  name: string;
  size?: number;
  mime?: string;
}

export interface MatterMessage {
  id: string;
  matter_id: string;
  firm_id: string;
  channel_type: ChannelType;
  recipient_scope: RecipientScope;
  sender_role: "admin" | "staff" | "client" | "system";
  sender_lawyer_id: string | null;
  sender_client_email: string | null;
  body: string;
  attachments: MatterAttachment[];
  broadcast_id: string | null;
  parent_message_id: string | null;
  created_at: string;
}

export interface ExplainerArticle {
  id: string;
  slug: string;
  title: string;
  body_html: string;
  practice_area: string;
  matter_stage: MatterStage;
  ordering: number;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface MatterExplainerAssignment {
  id: string;
  matter_id: string;
  article_id: string;
  assigned_by_lawyer_id: string | null;
  assigned_at: string;
}
