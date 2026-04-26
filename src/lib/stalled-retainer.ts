/**
 * WF-06  -  Stalled Retainer Engine
 *
 * Triggered when a lead's stage is 'stalled_retainer'.
 * Reads email steps from the stalled_retainer sequence template.
 * Exits on re-engagement (stage change) or all steps sent.
 */

import { supabaseAdmin as supabase } from "./supabase-admin";
import { sendEmail } from "./email";
import { getEmailContent } from "./sequence-engine";

interface StalledLead {
  id: string;
  name: string;
  email: string | null;
  stage: string;
  case_type: string | null;
  stalled_step: number;
  stalled_started_at: string | null;
  stalled_last_action_at: string | null;
  stalled_status: string;
}

export interface StalledResult {
  activated: number;
  steps_fired: number;
  exits: number;
  errors: string[];
}

export async function runStalledRetainerEngine(): Promise<StalledResult> {
  const result: StalledResult = {
    activated: 0,
    steps_fired: 0,
    exits: 0,
    errors: [],
  };

  const now = new Date();

  // Fetch active stalled_retainer sequence template
  const { data: template } = await supabase
    .from("sequence_templates")
    .select("id")
    .eq("trigger_event", "stalled_retainer")
    .eq("is_active", true)
    .maybeSingle();

  const steps = template ? (await supabase
    .from("sequence_steps")
    .select("id, step_number, delay_hours, channels")
    .eq("sequence_id", template.id)
    .eq("is_active", true)
    .order("step_number", { ascending: true })).data ?? [] : [];

  // Fetch all stalled_retainer leads
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, name, email, stage, case_type, " +
      "stalled_step, stalled_started_at, stalled_last_action_at, stalled_status"
    )
    .or(
      "stalled_status.eq.active," +
      "and(stalled_status.eq.inactive,stage.eq.stalled_retainer)"
    );

  if (error || !leads) {
    result.errors.push(error?.message ?? "Failed to fetch leads");
    return result;
  }

  for (const lead of leads as unknown as StalledLead[]) {
    try {
      await processLead(lead, now, steps, result);
    } catch (e) {
      result.errors.push(`Lead ${lead.id}: ${(e as Error).message}`);
    }
  }

  return result;
}

async function processLead(
  lead: StalledLead,
  now: Date,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: { step_number: number; delay_hours: number; channels: any }[],
  result: StalledResult,
): Promise<void> {
  // Exit if stage moved away from stalled_retainer
  if (lead.stage !== "stalled_retainer" && lead.stalled_status === "active") {
    await supabase
      .from("leads")
      .update({ stalled_status: "exited" })
      .eq("id", lead.id);
    result.exits++;
    return;
  }

  // Activate fresh stalled lead
  let startedAt: Date;
  if (lead.stalled_status === "inactive") {
    startedAt = now;
    const { error } = await supabase
      .from("leads")
      .update({
        stalled_status: "active",
        stalled_started_at: startedAt.toISOString(),
        stalled_step: 0,
      })
      .eq("id", lead.id);
    if (error) throw new Error(error.message);
    result.activated++;
    lead.stalled_status = "active";
    lead.stalled_started_at = startedAt.toISOString();
    lead.stalled_step = 0;
  } else {
    startedAt = new Date(lead.stalled_started_at!);
  }

  const minutesSinceStart = (now.getTime() - startedAt.getTime()) / 60_000;

  // Determine next step due
  const nextStep = (lead.stalled_step ?? 0) + 1;
  const stepRow = steps.find((s) => s.step_number === nextStep);
  if (!stepRow) return;

  const delayMinutes = stepRow.delay_hours * 60;
  if (minutesSinceStart < delayMinutes) return;

  // Get email content from sequence step
  const emailContent = getEmailContent(stepRow.channels, lead.name, lead.case_type);

  if (lead.email && emailContent) {
    try {
      await sendEmail(lead.email, emailContent.subject, emailContent.html);
    } catch (e) {
      console.error(`SR-EM-0${nextStep} send error for ${lead.id}:`, e);
    }
  }

  // Advance stalled state
  await supabase
    .from("leads")
    .update({
      stalled_step: nextStep,
      stalled_last_action_at: now.toISOString(),
    })
    .eq("id", lead.id);

  result.steps_fired++;
}
