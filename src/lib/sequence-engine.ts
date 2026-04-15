/**
 * Sequence Engine
 *
 * Looks up the active sequence_template for a trigger_event,
 * then inserts email_sequences rows for each active step.
 * Reads from channels.email — SMS/WhatsApp are Phase 3.
 */

import { supabase } from "./supabase";

export type TriggerEvent =
  | "new_lead"
  | "no_engagement"
  | "client_won"
  | "no_show"
  | "stalled_retainer"
  | "incomplete_intake"
  | "spoke_no_book"            // J5A: contacted but didn't book consultation
  | "consulted_no_sign"        // J5B: consultation held but didn't retain
  | "retainer_awaiting"        // J6: proposal sent, retainer not yet signed
  | "consultation_scheduled"   // J2: consultation booked, send reminders
  | "review_request"           // J9: client won, request Google review (3-touch)
  | "matter_active"            // J8: client won, active matter check-ins (3-touch, 8 weeks)
  | "re_engagement"            // J10: client lost or stalled, re-engage at 90d + 180d
  | "relationship_milestone"   // J11: client won, relationship touchpoint at 6mo + 12mo
  | "long_term_nurture";       // J12: client won, annual nurture for referral compounding

interface ChannelEmail {
  subject: string;
  body: string;
  active: boolean;
}

interface Channels {
  email: ChannelEmail;
  sms?: { body: string; active: boolean };
  whatsapp?: { template_name: string; body: string; active: boolean };
  internal?: { note: string; active: boolean };
}

interface StepRow {
  id: string;
  step_number: number;
  delay_hours: number;
  channels: Channels;
}

export interface TriggerResult {
  sequence_name: string | null;
  steps_scheduled: number;
  skipped: boolean;
  reason?: string;
}

export async function triggerSequence(
  leadId: string,
  triggerEvent: TriggerEvent,
): Promise<TriggerResult> {
  // Find the active template for this trigger
  const { data: template, error: tErr } = await supabase
    .from("sequence_templates")
    .select("id, name")
    .eq("trigger_event", triggerEvent)
    .eq("is_active", true)
    .maybeSingle();

  if (tErr) return { sequence_name: null, steps_scheduled: 0, skipped: true, reason: tErr.message };
  if (!template) return { sequence_name: null, steps_scheduled: 0, skipped: true, reason: `No active template for ${triggerEvent}` };

  // Get all active steps ordered by step_number
  const { data: steps, error: sErr } = await supabase
    .from("sequence_steps")
    .select("id, step_number, delay_hours, channels")
    .eq("sequence_id", template.id)
    .eq("is_active", true)
    .order("step_number", { ascending: true });

  if (sErr || !steps?.length) {
    return { sequence_name: template.name, steps_scheduled: 0, skipped: true, reason: "No active steps" };
  }

  const now = Date.now();
  const rows = (steps as StepRow[])
    .filter((step) => step.channels?.email?.active !== false) // skip steps with email disabled
    .map((step) => ({
      lead_id:          leadId,
      sequence_step_id: step.id,
      step_number:      step.step_number,
      status:           "scheduled" as const,
      scheduled_at:     new Date(now + step.delay_hours * 3_600_000).toISOString(),
    }));

  if (!rows.length) {
    return { sequence_name: template.name, steps_scheduled: 0, skipped: true, reason: "No steps with email channel active" };
  }

  const { error: iErr } = await supabase.from("email_sequences").insert(rows);
  if (iErr) return { sequence_name: template.name, steps_scheduled: 0, skipped: true, reason: iErr.message };

  return { sequence_name: template.name, steps_scheduled: rows.length, skipped: false };
}

// ── Read email content from a step (used by send logic) ──────────────────

export function getEmailContent(
  channels: Channels,
  leadName: string,
  caseType: string | null,
  firmName?: string,
): { subject: string; html: string } | null {
  const email = channels?.email;
  if (!email?.active || !email.subject || !email.body) return null;

  function interpolate(text: string) {
    return text
      .replace(/\{name\}/g, leadName)
      .replace(/\{case_type\}/g, caseType ?? "legal")
      .replace(/\{firm_name\}/g, firmName ?? "our firm");
  }

  return {
    subject: interpolate(email.subject),
    html: `<p>${interpolate(email.body).replace(/\n/g, "</p><p>")}</p>`,
  };
}
