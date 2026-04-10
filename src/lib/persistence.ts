/**
 * WF-03 — Persistence Engine
 *
 * 8-step follow-up sequence over 11 days.
 * Triggered when a lead sits in new_lead/qualified with no movement for 30+ minutes.
 * Exits on engagement (stage change), Day 11 auto-close, or manual pause.
 */

import { supabase } from "./supabase";
import { sendEmail } from "./email";

// ── Step schedule ─────────────────────────────────────────────────────────
// Minutes from persistence_started_at when each step becomes due.

export const STEP_DELAYS_MINUTES = [
  120,    // Step 1: +2h   (Day 0)
  1560,   // Step 2: +26h  (Day 1 morning)
  3000,   // Step 3: +50h  (Day 2 afternoon)
  4440,   // Step 4: +74h  (Day 3 morning)
  7320,   // Step 5: +122h (Day 5 morning)
  7500,   // Step 6: +125h (Day 5 noon)
  10200,  // Step 7: +170h (Day 7 morning)
  14460,  // Step 8: +241h (Day 10 morning)
] as const;

export const EXIT_DELAY_MINUTES = 15840; // Day 11 (+264h) → auto-close

// ── Email templates ───────────────────────────────────────────────────────

function fmt(caseType: string | null) {
  if (!caseType) return "legal";
  return caseType.charAt(0).toUpperCase() + caseType.slice(1);
}

interface EmailTemplate {
  subject: string;
  html: string;
}

export function getStepTemplate(
  step: number,
  name: string,
  caseType: string | null,
): EmailTemplate {
  const ct = fmt(caseType);
  const templates: EmailTemplate[] = [
    {
      subject: "Following up on your inquiry",
      html: `<p>Hi ${name},</p>
<p>I wanted to follow up on your ${ct} inquiry. We have helped many clients in similar situations.</p>
<p>Would you like to schedule a quick call to discuss your options?</p>`,
    },
    {
      subject: `The cost of waiting on your ${ct} matter`,
      html: `<p>Hi ${name},</p>
<p>In ${ct} cases, delays can affect outcomes. I wanted to make sure you have the information you need to move forward when you're ready.</p>
<p>Is there anything specific you'd like to know?</p>`,
    },
    {
      subject: "Checking in",
      html: `<p>Hi ${name},</p>
<p>Just checking in to see if you still need assistance with your ${ct} matter. Happy to answer any questions.</p>`,
    },
    {
      subject: "Still here if you need us",
      html: `<p>Hi ${name},</p>
<p>I know decisions like this take time. We're still here when you're ready to discuss your ${ct} situation.</p>`,
    },
    {
      subject: "Do you still need help with your case?",
      html: `<p>Hi ${name},</p>
<p>I wanted to reach out one more time about your ${ct} inquiry. Are you still looking for legal assistance?</p>`,
    },
    {
      subject: "Quick question",
      html: `<p>Hi ${name},</p>
<p>One quick question — is there anything that's been holding you back from moving forward? We may be able to help.</p>`,
    },
    {
      subject: "Should I close your file?",
      html: `<p>Hi ${name},</p>
<p>I haven't heard back from you regarding your ${ct} matter. I want to respect your time — should I close your file, or would you still like to connect?</p>`,
    },
    {
      subject: "Closing your file",
      html: `<p>Hi ${name},</p>
<p>Since I haven't heard back, I'll be closing your file for now. If you ever need legal assistance in the future, don't hesitate to reach out.</p>
<p>Wishing you all the best.</p>`,
    },
  ];

  const idx = Math.max(0, Math.min(step - 1, templates.length - 1));
  return templates[idx];
}

// ── Lead shape (minimal — only what persistence needs) ────────────────────

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

// ── Engine ────────────────────────────────────────────────────────────────

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

  // ── 1. Fetch all non-inactive persistence leads + eligible inactive ones ─
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
      await processLead(lead, now, result);
    } catch (e) {
      result.errors.push(`Lead ${lead.id}: ${(e as Error).message}`);
    }
  }

  return result;
}

async function processLead(
  lead: PersistenceLead,
  now: Date,
  result: RunResult,
): Promise<void> {
  // ── Pause check: stage moved out of new_lead/qualified ──────────────────
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

  // ── Activate fresh lead ──────────────────────────────────────────────────
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
    // Refresh local state
    lead.persistence_status = "active";
    lead.persistence_started_at = startedAt.toISOString();
    lead.persistence_step = 0;
  } else {
    startedAt = new Date(lead.persistence_started_at!);
  }

  const minutesSinceStart = (now.getTime() - startedAt.getTime()) / 60_000;

  // ── Day 11 exit ──────────────────────────────────────────────────────────
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

  // ── Determine next step due ──────────────────────────────────────────────
  const currentStep = lead.persistence_step ?? 0;
  const nextStep = currentStep + 1;

  if (nextStep > STEP_DELAYS_MINUTES.length) return; // all steps done

  const delayForNextStep = STEP_DELAYS_MINUTES[nextStep - 1];
  if (minutesSinceStart < delayForNextStep) return; // not yet due

  // ── Fire email ───────────────────────────────────────────────────────────
  const template = getStepTemplate(nextStep, lead.name, lead.case_type);

  if (lead.email) {
    try {
      await sendEmail(lead.email, template.subject, template.html);
    } catch (e) {
      // Log but don't abort — still advance the step
      console.error(`P-EM-0${nextStep} send error for ${lead.id}:`, e);
    }
  }

  // ── Advance persistence state ────────────────────────────────────────────
  await supabase
    .from("leads")
    .update({
      persistence_step: nextStep,
      persistence_last_action_at: now.toISOString(),
    })
    .eq("id", lead.id);

  result.steps_fired++;
}
