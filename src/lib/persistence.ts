/**
 * WF-03  -  Persistence Engine
 *
 * Triggered when a lead sits in new_lead/qualified with no movement for 30+ minutes.
 * Reads email steps from sequence_steps table via the no_engagement sequence template.
 * Exits on engagement (stage change), all steps sent, or Day 11 auto-close.
 */

import { supabaseAdmin as supabase } from "./supabase-admin";
import { sendEmail } from "./email";
import { getEmailContent } from "./sequence-engine";

export const EXIT_DELAY_MINUTES = 15840; // Day 11 (+264h)

interface PersistenceLead {
  id: string;
  name: string;
  email: string | null;
  stage: string;
  case_type: string | null;
  updated_at: string;
  persistence_step: number;
  persistence_started_at: string | null;
  persistence_last_action_at: string | null;
  persistence_status: string;
}

export interface RunResult {
  activated: number;
  steps_fired: number;
  exits: number;
  stage_paused: number;
  errors: string[];
}

export async function runPersistenceEngine(): Promise<RunResult> {
  const result: RunResult = {
    activated: 0,
    steps_fired: 0,
    exits: 0,
    stage_paused: 0,
    errors: [],
  };

  const now = new Date();

  // Fetch active sequence template for no_engagement
  const { data: template } = await supabase
    .from("sequence_templates")
    .select("id")
    .eq("trigger_event", "no_engagement")
    .eq("is_active", true)
    .maybeSingle();

  // Fetch all steps for this template ordered by step_number
  const steps = template ? (await supabase
    .from("sequence_steps")
    .select("id, step_number, delay_hours, channels")
    .eq("sequence_id", template.id)
    .eq("is_active", true)
    .order("step_number", { ascending: true })).data ?? [] : [];

  // Fetch leads eligible for persistence
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, name, email, stage, case_type, updated_at, " +
      "persistence_step, persistence_started_at, persistence_last_action_at, persistence_status"
    )
    .or(
      "persistence_status.eq.active," +
      `and(persistence_status.eq.inactive,stage.in.(new_lead,qualified),updated_at.lt.${new Date(now.getTime() - 30 * 60 * 1000).toISOString()})`
    );

  if (error || !leads) {
    result.errors.push(error?.message ?? "Failed to fetch leads");
    return result;
  }

  for (const lead of leads as unknown as PersistenceLead[]) {
    try {
      await processLead(lead, now, steps, result);
    } catch (e) {
      result.errors.push(`Lead ${lead.id}: ${(e as Error).message}`);
    }
  }

  return result;
}

async function processLead(
  lead: PersistenceLead,
  now: Date,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: { step_number: number; delay_hours: number; channels: any }[],
  result: RunResult,
): Promise<void> {
  // Pause if stage moved out of new_lead/qualified
  if (!["new_lead", "qualified"].includes(lead.stage)) {
    if (lead.persistence_status === "active") {
      const exitReason =
        lead.stage === "client_won" ? "won"
        : lead.stage === "client_lost" ? "lost"
        : "engaged";
      await supabase
        .from("leads")
        .update({ persistence_status: "exited", persistence_exit_reason: exitReason })
        .eq("id", lead.id);
      result.stage_paused++;
    }
    return;
  }

  // Activate fresh lead
  let startedAt: Date;
  if (lead.persistence_status === "inactive") {
    startedAt = now;
    const { error } = await supabase
      .from("leads")
      .update({
        persistence_status: "active",
        persistence_started_at: startedAt.toISOString(),
        persistence_step: 0,
      })
      .eq("id", lead.id);
    if (error) throw new Error(error.message);
    result.activated++;
    lead.persistence_status = "active";
    lead.persistence_started_at = startedAt.toISOString();
    lead.persistence_step = 0;
  } else {
    startedAt = new Date(lead.persistence_started_at!);
  }

  const minutesSinceStart = (now.getTime() - startedAt.getTime()) / 60_000;

  // Day 11 exit
  if (minutesSinceStart >= EXIT_DELAY_MINUTES) {
    await supabase
      .from("leads")
      .update({
        stage: "client_lost",
        persistence_status: "completed",
        persistence_exit_reason: "day11",
        updated_at: now.toISOString(),
      })
      .eq("id", lead.id);
    result.exits++;
    return;
  }

  // Determine next step due
  const currentStep = lead.persistence_step ?? 0;
  const nextStep = currentStep + 1;
  const stepRow = steps.find((s) => s.step_number === nextStep);
  if (!stepRow) return; // no more steps

  const delayMinutes = stepRow.delay_hours * 60;
  if (minutesSinceStart < delayMinutes) return; // not yet due

  // Get email content from sequence step
  const emailContent = getEmailContent(stepRow.channels, lead.name, lead.case_type);

  if (lead.email && emailContent) {
    try {
      await sendEmail(lead.email, emailContent.subject, emailContent.html);
    } catch (e) {
      console.error(`P-EM-0${nextStep} send error for ${lead.id}:`, e);
    }
  }

  // Advance persistence state
  await supabase
    .from("leads")
    .update({
      persistence_step: nextStep,
      persistence_last_action_at: now.toISOString(),
    })
    .eq("id", lead.id);

  result.steps_fired++;
}
