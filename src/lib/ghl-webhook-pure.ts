/**
 * GHL webhook — pure payload builders and types.
 *
 * Split from ghl-webhook.ts so the contract shapes can be tested in isolation
 * without dragging in the supabase-admin client. The I/O (fireGhlWebhook)
 * lives in ghl-webhook.ts and imports from here.
 *
 * Contract: docs/ghl-webhook-contract.md (the human-readable spec).
 */

export type WebhookAction =
  | "taken"
  | "passed"
  | "referred"
  | "declined_oos"
  | "declined_backstop";

export type DeclineSource = "per_lead_override" | "per_pa" | "firm_default" | "system_fallback";

interface ContactSnapshot {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface CommonEnvelope {
  action: WebhookAction;
  lead_id: string;
  firm_id: string;
  band: "A" | "B" | "C" | "D" | null;
  matter_type: string;
  practice_area: string;
  submitted_at: string;
  status_changed_at: string;
  status_changed_by: string;
  contact: ContactSnapshot;
  idempotency_key: string;
  intake_language: string;
}

export interface LeadFacts {
  lead_id: string;
  firm_id: string;
  band: "A" | "B" | "C" | "D" | null;
  matter_type: string;
  practice_area: string;
  submitted_at: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  intake_language?: string | null;
}

function buildEnvelope(
  action: WebhookAction,
  facts: LeadFacts,
  statusChangedAt: Date,
  statusChangedBy: string,
): CommonEnvelope {
  return {
    action,
    lead_id: facts.lead_id,
    firm_id: facts.firm_id,
    band: facts.band,
    matter_type: facts.matter_type,
    practice_area: facts.practice_area,
    submitted_at: facts.submitted_at,
    status_changed_at: statusChangedAt.toISOString(),
    status_changed_by: statusChangedBy,
    contact: {
      name: facts.contact_name ?? null,
      email: facts.contact_email ?? null,
      phone: facts.contact_phone ?? null,
    },
    idempotency_key: `${facts.lead_id}:${action}`,
    intake_language: facts.intake_language ?? 'en',
  };
}

// ─── Cadence target mapping ──────────────────────────────────────────────────

export function cadenceTargetForBand(
  band: "A" | "B" | "C" | "D" | null,
): "band_a" | "band_b" | "band_c" | "band_d" {
  if (band === "A") return "band_a";
  if (band === "B") return "band_b";
  if (band === "D") return "band_d";
  return "band_c";
}

export function lawyerActionForBand(band: "A" | "B" | "C" | "D" | null): string {
  if (band === "A") return "Call same day";
  if (band === "B") return "Send a booking link";
  if (band === "D") return "Refer to a colleague or pass";
  return "Lawyer choice: booking link or pass";
}

// ─── Payloads ────────────────────────────────────────────────────────────────

export interface TakenPayload extends CommonEnvelope {
  action: "taken";
  taken: {
    cadence_target: "band_a" | "band_b" | "band_c" | "band_d";
    lawyer_recommended_action: string;
    fee_estimate: string | null;
    matter_snapshot: string | null;
  };
}

export interface PassedPayload extends CommonEnvelope {
  action: "passed";
  passed: {
    decline_subject: string;
    decline_body: string;
    decline_template_source: DeclineSource;
    lawyer_note_present: boolean;
  };
}

export interface ReferredPayload extends CommonEnvelope {
  action: "referred";
  referred: {
    /** Freeform recipient name / firm / email — whatever the lawyer typed. */
    referred_to: string | null;
    /** Optional internal note attached to the referral. */
    note: string | null;
  };
}

export interface DeclinedOosPayload extends CommonEnvelope {
  action: "declined_oos";
  declined_oos: {
    decline_subject: string;
    decline_body: string;
    decline_template_source: DeclineSource;
    detected_area_label: string;
  };
}

export interface DeclinedBackstopPayload extends CommonEnvelope {
  action: "declined_backstop";
  declined_backstop: {
    decline_subject: string;
    decline_body: string;
    decline_template_source: DeclineSource;
    missed_deadline: string;
    hours_past_deadline: number;
  };
}

export type WebhookPayload =
  | TakenPayload
  | PassedPayload
  | ReferredPayload
  | DeclinedOosPayload
  | DeclinedBackstopPayload;

// ─── Builders ────────────────────────────────────────────────────────────────

export function buildTakenPayload(args: {
  facts: LeadFacts;
  statusChangedAt: Date;
  statusChangedBy: string;
  feeEstimate: string | null;
  matterSnapshot: string | null;
}): TakenPayload {
  const env = buildEnvelope("taken", args.facts, args.statusChangedAt, args.statusChangedBy);
  return {
    ...env,
    action: "taken",
    taken: {
      cadence_target: cadenceTargetForBand(args.facts.band),
      lawyer_recommended_action: lawyerActionForBand(args.facts.band),
      fee_estimate: args.feeEstimate,
      matter_snapshot: args.matterSnapshot,
    },
  };
}

export function buildPassedPayload(args: {
  facts: LeadFacts;
  statusChangedAt: Date;
  statusChangedBy: string;
  declineSubject: string;
  declineBody: string;
  declineSource: DeclineSource;
  lawyerNotePresent: boolean;
}): PassedPayload {
  const env = buildEnvelope("passed", args.facts, args.statusChangedAt, args.statusChangedBy);
  return {
    ...env,
    action: "passed",
    passed: {
      decline_subject: args.declineSubject,
      decline_body: args.declineBody,
      decline_template_source: args.declineSource,
      lawyer_note_present: args.lawyerNotePresent,
    },
  };
}

export function buildReferredPayload(args: {
  facts: LeadFacts;
  statusChangedAt: Date;
  statusChangedBy: string;
  referredTo: string | null;
  note: string | null;
}): ReferredPayload {
  const env = buildEnvelope("referred", args.facts, args.statusChangedAt, args.statusChangedBy);
  return {
    ...env,
    action: "referred",
    referred: {
      referred_to: args.referredTo,
      note: args.note,
    },
  };
}

export function buildDeclinedOosPayload(args: {
  facts: LeadFacts;
  statusChangedAt: Date;
  declineSubject: string;
  declineBody: string;
  declineSource: DeclineSource;
  detectedAreaLabel: string;
}): DeclinedOosPayload {
  const env = buildEnvelope("declined_oos", args.facts, args.statusChangedAt, "system:oos");
  return {
    ...env,
    action: "declined_oos",
    band: null, // OOS leads are never banded
    declined_oos: {
      decline_subject: args.declineSubject,
      decline_body: args.declineBody,
      decline_template_source: args.declineSource,
      detected_area_label: args.detectedAreaLabel,
    },
  };
}

export function buildDeclinedBackstopPayload(args: {
  facts: LeadFacts;
  statusChangedAt: Date;
  declineSubject: string;
  declineBody: string;
  declineSource: DeclineSource;
  decisionDeadline: string;
}): DeclinedBackstopPayload {
  const env = buildEnvelope("declined_backstop", args.facts, args.statusChangedAt, "system:backstop");
  const deadline = new Date(args.decisionDeadline);
  const hoursPast = (args.statusChangedAt.getTime() - deadline.getTime()) / 3_600_000;
  return {
    ...env,
    action: "declined_backstop",
    declined_backstop: {
      decline_subject: args.declineSubject,
      decline_body: args.declineBody,
      decline_template_source: args.declineSource,
      missed_deadline: deadline.toISOString(),
      hours_past_deadline: Math.round(hoursPast * 10) / 10,
    },
  };
}
