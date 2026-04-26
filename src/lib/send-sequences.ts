/**
 * Generic Sequence Processor
 *
 * Processes all email_sequences rows where status = 'scheduled' and
 * scheduled_at <= now(). Sends the email and marks the row sent or skipped.
 *
 * This is the execution layer for every triggerSequence()-based journey:
 *   J2   -  consultation_scheduled  (consultation reminders)
 *   J5A  -  spoke_no_book           (recovery A)
 *   J5B  -  consulted_no_sign       (recovery B)
 *   J6   -  retainer_awaiting       (retainer follow-up)
 *   ...any future sequence engine journeys
 *
 * Exit conditions: if a lead moves away from the expected stage for a
 * given trigger_event, remaining scheduled steps are marked 'skipped'.
 *
 * Exit stage map  -  lead must be in one of these stages for steps to send:
 *   consultation_scheduled → ['consultation_scheduled']
 *   retainer_awaiting      → ['proposal_sent']
 *   spoke_no_book          → ['contacted']
 *   consulted_no_sign      → ['consultation_held']
 *   (all others have no exit condition  -  steps always send)
 */

import { supabaseAdmin as supabase } from "./supabase-admin";
import { sendEmail } from "./email";
import { getEmailContent } from "./sequence-engine";
import { evaluateStepCondition, type StepCondition } from "./sequence-conditions";

// ─── Exit stage map ───────────────────────────────────────────────────────────

const EXIT_STAGE_MAP: Record<string, string[]> = {
  consultation_scheduled: ["consultation_scheduled"],
  retainer_awaiting: ["proposal_sent"],
  spoke_no_book: ["contacted"],
  consulted_no_sign: ["consultation_held"],
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface DueRow {
  id: string;
  lead_id: string;
  sequence_step_id: string;
  step_number: number;
  scheduled_at: string;
}

interface StepInfo {
  id: string;
  sequence_id: string;
  channels: Record<string, unknown>;
}

interface TemplateInfo {
  id: string;
  trigger_event: string;
  name: string;
}

interface LeadInfo {
  id: string;
  name: string;
  email: string | null;
  case_type: string | null;
  stage: string;
  law_firm_id: string | null;
  intake_session_id: string | null;
}

interface SessionAnswers {
  confirmed: Record<string, unknown>;
  extracted: Record<string, unknown>;
}

export interface SendSequencesResult {
  processed: number;
  sent: number;
  skipped: number;
  errors: string[];
}

// ─── Main engine ──────────────────────────────────────────────────────────────

export async function runSendSequences(): Promise<SendSequencesResult> {
  const result: SendSequencesResult = { processed: 0, sent: 0, skipped: 0, errors: [] };
  const now = new Date().toISOString();

  // Fetch all due rows (process up to 200 per run to stay within maxDuration)
  const { data: dueRows, error } = await supabase
    .from("email_sequences")
    .select("id, lead_id, sequence_step_id, step_number, scheduled_at")
    .eq("status", "scheduled")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(200);

  if (error || !dueRows?.length) {
    if (error) result.errors.push(error.message);
    return result;
  }

  // Batch-load steps (deduplicated)
  const stepIds = [...new Set(dueRows.map((r: DueRow) => r.sequence_step_id))];
  const { data: stepsData } = await supabase
    .from("sequence_steps")
    .select("id, sequence_id, channels")
    .in("id", stepIds);
  const stepsById: Record<string, StepInfo> = Object.fromEntries(
    (stepsData ?? []).map((s: StepInfo) => [s.id, s])
  );

  // Batch-load templates (deduplicated)
  const sequenceIds = [...new Set(Object.values(stepsById).map((s) => s.sequence_id))];
  const { data: templatesData } = await supabase
    .from("sequence_templates")
    .select("id, trigger_event, name")
    .in("id", sequenceIds);
  const templatesById: Record<string, TemplateInfo> = Object.fromEntries(
    (templatesData ?? []).map((t: TemplateInfo) => [t.id, t])
  );

  // Batch-load leads (deduplicated)
  const leadIds = [...new Set(dueRows.map((r: DueRow) => r.lead_id))];
  const { data: leadsData } = await supabase
    .from("leads")
    .select("id, name, email, case_type, stage, law_firm_id, intake_session_id")
    .in("id", leadIds);
  const leadsById: Record<string, LeadInfo> = Object.fromEntries(
    (leadsData ?? []).map((l: LeadInfo) => [l.id, l])
  );

  // Batch-load session answers for leads that have an intake_session_id.
  // Answers = scoring._confirmed (slot answers) merged with extracted_entities.
  const sessionIds = [...new Set(
    (leadsData ?? []).map((l: LeadInfo) => l.intake_session_id).filter(Boolean)
  )] as string[];

  const sessionAnswersById: Record<string, SessionAnswers> = {};
  if (sessionIds.length > 0) {
    const { data: sessionsData } = await supabase
      .from("intake_sessions")
      .select("id, scoring, extracted_entities")
      .in("id", sessionIds);

    for (const s of sessionsData ?? []) {
      const scoring = (s.scoring as Record<string, unknown>) ?? {};
      sessionAnswersById[s.id as string] = {
        confirmed: (scoring._confirmed as Record<string, unknown>) ?? {},
        extracted: (s.extracted_entities as Record<string, unknown>) ?? {},
      };
    }
  }

  // Track which lead+template combos have been exited this run
  // so we skip siblings without re-querying
  const exitedCombos = new Set<string>();

  for (const row of dueRows as DueRow[]) {
    result.processed++;
    try {
      const step = stepsById[row.sequence_step_id];
      const lead = leadsById[row.lead_id];
      if (!step || !lead) {
        await markRow(row.id, "skipped");
        result.skipped++;
        continue;
      }

      const template = templatesById[step.sequence_id];
      if (!template) {
        await markRow(row.id, "skipped");
        result.skipped++;
        continue;
      }

      // Exit condition check
      const allowedStages = EXIT_STAGE_MAP[template.trigger_event];
      const comboKey = `${row.lead_id}:${step.sequence_id}`;

      if (
        exitedCombos.has(comboKey) ||
        (allowedStages && !allowedStages.includes(lead.stage))
      ) {
        // Mark this row and all remaining scheduled sibling steps as skipped
        if (!exitedCombos.has(comboKey)) {
          await cancelRemainingSteps(row.lead_id, step.sequence_id);
          exitedCombos.add(comboKey);
        } else {
          await markRow(row.id, "skipped");
        }
        result.skipped++;
        continue;
      }

      // Condition check  -  evaluate slot-answer rules if present in channels.condition
      const stepCondition = (step.channels as Record<string, unknown>).condition as StepCondition | undefined;
      if (stepCondition) {
        const sessionAnswers = lead.intake_session_id
          ? sessionAnswersById[lead.intake_session_id]
          : null;
        const flatAnswers = sessionAnswers
          ? { ...sessionAnswers.extracted, ...sessionAnswers.confirmed }
          : {};
        if (!evaluateStepCondition(stepCondition, flatAnswers)) {
          await markRow(row.id, "skipped");
          result.skipped++;
          continue;
        }
      }

      // Build email content
      const emailContent = getEmailContent(
        step.channels as unknown as Parameters<typeof getEmailContent>[0],
        lead.name,
        lead.case_type
      );

      if (!emailContent || !lead.email) {
        await markRow(row.id, "skipped");
        result.skipped++;
        continue;
      }

      // Send
      try {
        const sendResult = await sendEmail(lead.email, emailContent.subject, emailContent.html);
        await markRow(row.id, sendResult.skipped ? "skipped" : "sent");
        if (!sendResult.skipped) result.sent++;
        else result.skipped++;
      } catch (e) {
        result.errors.push(`Row ${row.id}: ${(e as Error).message}`);
        await markRow(row.id, "skipped");
        result.skipped++;
      }
    } catch (e) {
      result.errors.push(`Row ${row.id}: ${(e as Error).message}`);
    }
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function markRow(rowId: string, status: "sent" | "skipped"): Promise<void> {
  await supabase
    .from("email_sequences")
    .update({ status, sent_at: status === "sent" ? new Date().toISOString() : null })
    .eq("id", rowId);
}

/**
 * Marks all remaining scheduled steps for a lead+sequence combo as skipped.
 * Used when exit condition fires mid-sequence.
 */
async function cancelRemainingSteps(leadId: string, sequenceId: string): Promise<void> {
  // Get all step IDs for this sequence
  const { data: steps } = await supabase
    .from("sequence_steps")
    .select("id")
    .eq("sequence_id", sequenceId);

  const stepIds = (steps ?? []).map((s: { id: string }) => s.id);
  if (!stepIds.length) return;

  await supabase
    .from("email_sequences")
    .update({ status: "skipped" })
    .eq("lead_id", leadId)
    .eq("status", "scheduled")
    .in("sequence_step_id", stepIds);
}

/**
 * Cancels all scheduled steps for a specific trigger_event for a lead.
 * Called from the stage route when a lead moves away from the triggering stage.
 */
export async function cancelSequenceByTrigger(
  leadId: string,
  triggerEvent: string
): Promise<void> {
  const { data: template } = await supabase
    .from("sequence_templates")
    .select("id")
    .eq("trigger_event", triggerEvent)
    .eq("is_active", true)
    .maybeSingle();

  if (!template) return;
  await cancelRemainingSteps(leadId, template.id);
}
