/**
 * Incomplete Intake Detection (v2.2)
 *
 * Identifies leads with low scoring confidence that are worth pursuing
 * (Band B or C), and triggers a targeted follow-up sequence asking
 * for the specific missing fields that would improve score accuracy.
 *
 * This module is called by the incomplete-intake cron job and by
 * the screen API after initial scoring.
 */

import { supabase } from "./supabase";
import { triggerSequence } from "./sequence-engine";
import type { Confidence, PriorityBand } from "./scoring";

// ── Types ────────────────────────────────────────────────────────────────

export interface IncompleteIntakeCandidate {
  lead_id: string;
  lead_name: string;
  email: string | null;
  phone: string | null;
  confidence: Confidence;
  priority_band: PriorityBand;
  missing_fields: string[];
}

export interface NudgeResult {
  lead_id: string;
  action: "triggered" | "skipped";
  reason: string;
}

// ── Detection ────────────────────────────────────────────────────────────

/**
 * Finds leads eligible for the incomplete intake nudge.
 * Criteria: confidence = "low", band in (B, C), no existing
 * incomplete_intake sequence scheduled, created within last 7 days.
 */
export async function findIncompleteCandidates(): Promise<IncompleteIntakeCandidate[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, name, email, phone, cpi_confidence, priority_band, cpi_missing_fields")
    .eq("cpi_confidence", "low")
    .in("priority_band", ["B", "C"])
    .gte("created_at", sevenDaysAgo)
    .not("cpi_missing_fields", "is", null);

  if (error || !leads?.length) return [];

  // Filter out leads that already have an incomplete_intake sequence
  const leadIds = leads.map((l) => l.id);

  const { data: existing } = await supabase
    .from("email_sequences")
    .select("lead_id")
    .in("lead_id", leadIds)
    .eq("status", "scheduled")
    .in("sequence_step_id", await getIncompleteIntakeStepIds());

  const alreadyNudged = new Set((existing ?? []).map((e) => e.lead_id));

  return leads
    .filter((l) => !alreadyNudged.has(l.id))
    .map((l) => ({
      lead_id: l.id,
      lead_name: l.name,
      email: l.email,
      phone: l.phone,
      confidence: l.cpi_confidence as Confidence,
      priority_band: l.priority_band as PriorityBand,
      missing_fields: l.cpi_missing_fields as string[],
    }));
}

// ── Trigger ──────────────────────────────────────────────────────────────

/**
 * Triggers the incomplete_intake sequence for a single lead.
 * Returns the result with action taken and reason.
 */
export async function nudgeLead(
  candidate: IncompleteIntakeCandidate,
): Promise<NudgeResult> {
  // Must have at least email or phone to send a nudge
  if (!candidate.email && !candidate.phone) {
    return {
      lead_id: candidate.lead_id,
      action: "skipped",
      reason: "No contact method available",
    };
  }

  // Must have at least one missing field to ask about
  if (!candidate.missing_fields.length) {
    return {
      lead_id: candidate.lead_id,
      action: "skipped",
      reason: "No missing fields identified despite low confidence",
    };
  }

  const result = await triggerSequence(candidate.lead_id, "incomplete_intake");

  if (result.skipped) {
    return {
      lead_id: candidate.lead_id,
      action: "skipped",
      reason: result.reason ?? "Sequence trigger skipped",
    };
  }

  return {
    lead_id: candidate.lead_id,
    action: "triggered",
    reason: `Scheduled ${result.steps_scheduled} steps for ${candidate.missing_fields.length} missing fields`,
  };
}

// ── Batch processing (used by cron) ──────────────────────────────────────

export async function processIncompleteIntakes(): Promise<NudgeResult[]> {
  const candidates = await findIncompleteCandidates();
  const results: NudgeResult[] = [];

  for (const candidate of candidates) {
    const result = await nudgeLead(candidate);
    results.push(result);
  }

  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function getIncompleteIntakeStepIds(): Promise<string[]> {
  const { data: template } = await supabase
    .from("sequence_templates")
    .select("id")
    .eq("trigger_event", "incomplete_intake")
    .eq("is_active", true)
    .maybeSingle();

  if (!template) return [];

  const { data: steps } = await supabase
    .from("sequence_steps")
    .select("id")
    .eq("sequence_id", template.id);

  return (steps ?? []).map((s) => s.id);
}
