/**
 * WF-05 — No-Show Recovery Engine
 *
 * Triggered when a lead's stage is set to 'no_show'.
 * Reads email steps from the no_show sequence template in sequence_steps table.
 * Exits on re-engagement (stage change away from no_show) or all steps sent.
 */

import { supabase } from "./supabase";
import { sendEmail } from "./email";
import { getEmailContent } from "./sequence-engine";

interface NoShowLead {
  id: string;
  name: string;
  email: string | null;
  stage: string;
  case_type: string | null;
  no_show_step: number;
  no_show_started_at: string | null;
  no_show_status: string;
}

export interface NoShowResult {
  activated: number;
  steps_fired: number;
  exits: number;
  errors: string[];
}

export async function runNoShowEngine(): Promise<NoShowResult> {
  const result: NoShowResult = {
    activated: 0,
    steps_fired: 0,
    exits: 0,
    errors: [],
  };

  const now = new Date();

  // Fetch active no_show sequence template
  const { data: template } = await supabase
    .from("sequence_templates")
    .select("id")
    .eq("trigger_event", "no_show")
    .eq("is_active", true)
    .maybeSingle();

  const steps = template ? (await supabase
    .from("sequence_steps")
    .select("id, step_number, delay_hours, channels")
    .eq("sequence_id", template.id)
    .eq("is_active", true)
    .order("step_number", { ascending: true })).data ?? [] : [];

  // Fetch all no_show leads (active recovery or newly no_show)
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, name, email, stage, case_type, " +
      "no_show_step, no_show_started_at, no_show_status"
    )
    .or(
      "no_show_status.eq.active," +
      "and(no_show_status.eq.inactive,stage.eq.no_show)"
    );

  if (error || !leads) {
    result.errors.push(error?.message ?? "Failed to fetch leads");
    return result;
  }

  for (const lead of leads as unknown as NoShowLead[]) {
    try {
      await processLead(lead, now, steps, result);
    } catch (e) {
      result.errors.push(`Lead ${lead.id}: ${(e as Error).message}`);
    }
  }

  return result;
}

async function processLead(
  lead: NoShowLead,
  now: Date,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: { step_number: number; delay_hours: number; channels: any }[],
  result: NoShowResult,
): Promise<void> {
  // Exit if stage moved away from no_show
  if (lead.stage !== "no_show" && lead.no_show_status === "active") {
    await supabase
      .from("leads")
      .update({ no_show_status: "exited" })
      .eq("id", lead.id);
    result.exits++;
    return;
  }

  // Activate fresh no_show lead
  let startedAt: Date;
  if (lead.no_show_status === "inactive") {
    startedAt = now;
    const { error } = await supabase
      .from("leads")
      .update({
        no_show_status: "active",
        no_show_started_at: startedAt.toISOString(),
        no_show_step: 0,
      })
      .eq("id", lead.id);
    if (error) throw new Error(error.message);
    result.activated++;
    lead.no_show_status = "active";
    lead.no_show_started_at = startedAt.toISOString();
    lead.no_show_step = 0;
  } else {
    startedAt = new Date(lead.no_show_started_at!);
  }

  const minutesSinceStart = (now.getTime() - startedAt.getTime()) / 60_000;

  // Determine next step due
  const nextStep = (lead.no_show_step ?? 0) + 1;
  const stepRow = steps.find((s) => s.step_number === nextStep);
  if (!stepRow) return; // all steps done

  const delayMinutes = stepRow.delay_hours * 60;
  if (minutesSinceStart < delayMinutes) return; // not yet due

  // Get email content from sequence step
  const emailContent = getEmailContent(stepRow.channels, lead.name, lead.case_type);

  if (lead.email && emailContent) {
    try {
      await sendEmail(lead.email, emailContent.subject, emailContent.html);
    } catch (e) {
      console.error(`NS-EM-0${nextStep} send error for ${lead.id}:`, e);
    }
  }

  // Advance no_show state
  await supabase
    .from("leads")
    .update({
      no_show_step: nextStep,
      no_show_last_action_at: now.toISOString(),
    })
    .eq("id", lead.id);

  result.steps_fired++;
}
