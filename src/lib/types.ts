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

// ─── Phase 2: content approval ────────────────────────────────────────────
// Operator posts marketing deliverables for the firm's lawyer to review and
// formally sign off (LSO Rule 4.2-1 compliance record). See migration
// 20260623_content_approval.sql.

export type ContentKind = "text" | "image" | "pdf";
export type DeliverableStatus =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "archived";
export type DeliverableActorRole = "operator" | "lawyer";
export type ApprovalDecision = "approved" | "changes_requested";

/**
 * Annotation anchoring a comment to a location in a version.
 *   text   - a selected passage in a text deliverable (offsets into the
 *            plain-text projection + the quoted text for display/verify)
 *   pin    - a point on an image (x,y normalised 0..1 of the rendered box)
 *   region - a rectangle on an image (x,y,w,h normalised 0..1)
 *   page   - a 1-based page tag on a PDF
 * A null annotation is a general comment on the whole version.
 */
export type DeliverableAnnotation =
  | { type: "text"; start: number; end: number; quote: string }
  | { type: "pin"; x: number; y: number }
  | { type: "region"; x: number; y: number; w: number; h: number }
  | { type: "page"; page: number }
  /**
   * Anchor on an inline image inside a text deliverable's body. The
   * Google-Docs-style popover triggers this on click; the reviewer adds a
   * general comment about that image. src + alt give the operator enough to
   * identify which image without a coord, which is the desired UX (no need
   * for pin/region precision on inline embedded images).
   */
  | { type: "image"; src: string; alt?: string };

export interface ContentDeliverable {
  id: string;
  firm_id: string;
  title: string;
  description: string | null;
  content_kind: ContentKind;
  status: DeliverableStatus;
  current_version_id: string | null;
  approved_version_id: string | null;
  approved_at: string | null;
  created_by_role: DeliverableActorRole;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
  // Brand-render metadata for the article preview shell. Added 2026-06-23.
  excerpt: string | null;
  topic: string | null;
  byline: string | null;
  publish_date: string | null;  // YYYY-MM-DD; null means "draft, not scheduled"
  read_time: string | null;     // "8 min read"
  hero_image_url: string | null;
  /**
   * Operator queue label (e.g. "Backfill", "Wk 1"). Shown in the deliverables
   * list as a prefix on the title. Intentionally NOT rendered in the article
   * header: the rendered display title must match drglaw.ca.
   */
  kicker: string | null;
  // Content-plan placement (migration 20260624_content_periods.sql).
  period_id: string | null;   // FK to content_periods; null = unscheduled
  format: string | null;      // editorial format label, e.g. "Counsel Note"
}

/**
 * A weekly content period: the editorial frame the firm sees above a batch of
 * deliverables (theme + what's covered + the strategic rationale). Operator
 * authored; the firm reads it. See migration 20260624_content_periods.sql.
 */
export interface ContentPeriod {
  id: string;
  firm_id: string;
  starts_on: string;   // YYYY-MM-DD
  ends_on: string;     // YYYY-MM-DD
  theme: string | null;
  details: string | null;
  rationale: string | null;   // the "why": brand relevance + search intent
  sort_index: number;
  created_by_role: string | null;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Per-firm content-plan settings, shown in the review-overview panel. Operator
 * authored. See migration 20260624_content_plan_settings.sql.
 */
export interface ContentPlanSettings {
  firm_id: string;
  ask: string | null;        // batch ask note the firm reads
  review_by: string | null;  // YYYY-MM-DD custom deadline; null = use next publish
  updated_at: string;
}

export interface DeliverableVersion {
  id: string;
  deliverable_id: string;
  firm_id: string;
  version_number: number;
  body_html: string | null;
  storage_path: string | null;
  signed_url?: string; // runtime only: pre-signed read URL for assets
  asset_mime: string | null;
  asset_size_bytes: number | null;
  asset_name: string | null;
  note: string | null;
  created_by_role: DeliverableActorRole;
  created_by_id: string | null;
  created_at: string;
}

export interface DeliverableComment {
  id: string;
  deliverable_id: string;
  version_id: string;
  firm_id: string;
  author_role: DeliverableActorRole;
  author_id: string | null;
  author_name: string | null;
  annotation: DeliverableAnnotation | null;
  body: string;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by_role: DeliverableActorRole | null;
  parent_comment_id: string | null;
  created_at: string;
}

export interface ApprovalRecord {
  id: string;
  deliverable_id: string;
  version_id: string;
  firm_id: string;
  decision: ApprovalDecision;
  signer_role: "lawyer" | "operator";
  signer_id: string | null;
  signer_name: string;
  signer_email: string;
  attestation: string;
  version_number: number;
  deliverable_title: string;
  ip_address: string | null;
  user_agent: string | null;
  note: string | null;
  created_at: string;
}
