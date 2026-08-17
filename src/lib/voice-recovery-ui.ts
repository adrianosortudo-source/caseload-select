export type VoiceRecoveryDisposition =
  | "existing_client"
  | "admin"
  | "court_or_counsel"
  | "vendor"
  | "wrong_number"
  | "unclear"
  | "caller_declined"
  | "incomplete"
  | "transcript_partial";

export type VoiceRecoveryStatus = "open" | "acknowledged" | "resolved";
export type VoiceRecoveryReason =
  | "unknown"
  | "non_intake"
  | "no_contact_provided"
  | "technical_failure"
  | "no_usable_transcript"
  | "disconnected"
  | "integration_error";
export type VoiceRecoveryDisplayStatus =
  | "new"
  | "acknowledged"
  | "follow_up"
  | "resolved"
  | "promoted";

export interface VoiceRecoveryCase {
  id: string;
  firm_id: string;
  ghl_call_event_id: string | null;
  ghl_contact_id: string | null;
  disposition: VoiceRecoveryDisposition;
  recovery_reason: VoiceRecoveryReason;
  status: VoiceRecoveryStatus;
  owner_name: string | null;
  sla_due_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  observed_caller_id: string | null;
  spoken_callback_number: string | null;
  callback_number_verified: boolean;
  sms_consent: boolean | null;
  whatsapp_consent: boolean | null;
  messaging_consent_provenance: string | null;
  messaging_consent_at: string | null;
  caller_name: string | null;
  name_source?: string | null;
  caller_name_provenance?: string | null;
  message_excerpt: string | null;
  raw_transcript: string | null;
  transcript_source: string | null;
  recording_url: string | null;
  urgency: string | null;
  alert_status: string | null;
  delivery_state: string | null;
  follow_up_state: string | null;
  follow_up_count: number;
  last_follow_up_at: string | null;
  last_follow_up_summary: string | null;
  promoted_screened_lead_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceRecoveryCounts {
  open: number;
  acknowledged: number;
  resolved: number;
  total: number;
  new?: number;
  follow_up?: number;
  promoted?: number;
}

export interface VoiceRecoveryResponse {
  cases: VoiceRecoveryCase[];
  counts: VoiceRecoveryCounts;
}

const ACTIVE_FOLLOW_UP_STATES = new Set([
  "attempted",
  "scheduled",
  "completed",
]);

export function recoveryDisplayStatus(item: VoiceRecoveryCase): VoiceRecoveryDisplayStatus {
  if (item.promoted_screened_lead_id) return "promoted";
  if (item.status === "resolved") return "resolved";
  if (item.follow_up_state && ACTIVE_FOLLOW_UP_STATES.has(item.follow_up_state)) return "follow_up";
  if (item.status === "acknowledged") return "acknowledged";
  return "new";
}

export function recoveryStatusLabel(status: VoiceRecoveryDisplayStatus): string {
  return {
    new: "New",
    acknowledged: "Acknowledged",
    follow_up: "Follow-up",
    resolved: "Resolved non-lead",
    promoted: "Promoted to Screen",
  }[status];
}

export function recoveryDispositionLabel(disposition: VoiceRecoveryDisposition): string {
  return {
    existing_client: "Existing client",
    admin: "Administrative",
    court_or_counsel: "Court or counsel",
    vendor: "Vendor",
    wrong_number: "Wrong number",
    unclear: "Unclear intent",
    caller_declined: "Caller declined details",
    incomplete: "Incomplete qualification",
    transcript_partial: "Partial transcript",
  }[disposition];
}

export function recoveryReasonLabel(reason: VoiceRecoveryReason): string {
  return {
    unknown: "Reason awaiting review",
    non_intake: "Non-intake route",
    no_contact_provided: "No verified contact path",
    technical_failure: "Technical failure",
    no_usable_transcript: "No usable transcript",
    disconnected: "Call disconnected",
    integration_error: "Integration error",
  }[reason];
}

export function consentLabel(consent: boolean | null): string {
  if (consent === true) return "Permission recorded";
  if (consent === false) return "Permission declined";
  return "No messaging permission recorded";
}

export function recoveryExcerpt(item: VoiceRecoveryCase, maxLength = 280): string {
  const source = (item.last_follow_up_summary || item.message_excerpt || item.raw_transcript || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!source) return "No transcript or operator note is available.";
  if (source.length <= maxLength) return source;
  return `${source.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function deriveRecoveryCounts(
  cases: VoiceRecoveryCase[],
  serverCounts?: VoiceRecoveryCounts,
): Record<VoiceRecoveryDisplayStatus | "total", number> {
  const derived = {
    new: 0,
    acknowledged: 0,
    follow_up: 0,
    resolved: 0,
    promoted: 0,
    total: serverCounts?.total ?? cases.length,
  };
  for (const item of cases) derived[recoveryDisplayStatus(item)] += 1;
  if (serverCounts?.new !== undefined) derived.new = serverCounts.new;
  else if (serverCounts?.open !== undefined && cases.length === 0) derived.new = serverCounts.open;
  if (serverCounts?.acknowledged !== undefined && cases.length === 0) {
    derived.acknowledged = serverCounts.acknowledged;
  }
  if (serverCounts?.resolved !== undefined && cases.length === 0) derived.resolved = serverCounts.resolved;
  if (serverCounts?.follow_up !== undefined) derived.follow_up = serverCounts.follow_up;
  if (serverCounts?.promoted !== undefined) derived.promoted = serverCounts.promoted;
  return derived;
}

export function isSlaOverdue(item: VoiceRecoveryCase, now = new Date()): boolean {
  if (!item.sla_due_at || recoveryDisplayStatus(item) === "resolved" || recoveryDisplayStatus(item) === "promoted") {
    return false;
  }
  return new Date(item.sla_due_at).getTime() < now.getTime();
}
