/**
 * GET /api/cron/deadline-reminder
 *
 * T-12h reminder sweeper for the lawyer triage queue (audit finding F1,
 * 2026-07-02). Finds triaging screened_leads rows whose decision_deadline
 * is inside the next 12 hours, that are at least 12 hours old, and that
 * have not been reminded yet, then emails the firm's lawyers so the lead
 * gets a human decision before the backstop fires decline-with-grace.
 *
 * One reminder per lead, stamped on deadline_reminder_sent_at. The stamp
 * update carries the same status guard as the backstop so a concurrent
 * lawyer action wins the race and the reminder is skipped or harmless.
 *
 * Auth: Bearer CRON_SECRET or PG_CRON_TOKEN (lib/cron-auth). Scheduled via
 * Supabase pg_cron hourly, same pattern as triage-backstop-hourly.
 *
 * Batching: up to 50 rows per run.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { isCronAuthorized } from "@/lib/cron-auth";
import { loadFirmAndRecipients } from "@/lib/lead-notify";
import { sendEmail } from "@/lib/email";
import {
  isReminderDue,
  buildDeadlineReminderEmail,
  REMINDER_WINDOW_MS,
} from "@/lib/deadline-reminder-pure";

const BATCH_LIMIT = 50;

interface ReminderRow {
  lead_id: string;
  firm_id: string;
  band: "A" | "B" | "C" | "D" | null;
  matter_type: string;
  practice_area: string;
  decision_deadline: string;
  deadline_reminder_sent_at: string | null;
  status: string;
  created_at: string;
  contact_name: string | null;
  slot_answers: { channel?: string } | null;
}

interface ReminderOutcome {
  lead_id: string;
  firm_id: string;
  sent: number;
  skipped_reason?: string;
}

function resolveAppOrigin(): string {
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  if (appDomain) return `https://app.${appDomain}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const windowEndIso = new Date(now.getTime() + REMINDER_WINDOW_MS).toISOString();

  const { data, error: fetchErr } = await supabase
    .from("screened_leads")
    .select(`
      lead_id, firm_id, band, matter_type, practice_area,
      decision_deadline, deadline_reminder_sent_at, status, created_at,
      contact_name, slot_answers
    `)
    .eq("status", "triaging")
    .eq("archived", false)
    .is("deadline_reminder_sent_at", null)
    .gt("decision_deadline", nowIso)
    .lte("decision_deadline", windowEndIso)
    .order("decision_deadline", { ascending: true })
    .limit(BATCH_LIMIT);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const rows = (data ?? []) as ReminderRow[];
  const outcomes: ReminderOutcome[] = [];

  for (const row of rows) {
    // The SQL filter covers status/stamp/window; isReminderDue re-checks and
    // adds the minimum-age gate, which SQL leaves out so the predicate stays
    // testable in one place.
    if (!isReminderDue(row, now)) {
      outcomes.push({
        lead_id: row.lead_id,
        firm_id: row.firm_id,
        sent: 0,
        skipped_reason: "not due (minimum age gate)",
      });
      continue;
    }

    const resolved = await loadFirmAndRecipients(row.firm_id);
    if (!resolved || resolved.recipients.length === 0) {
      outcomes.push({
        lead_id: row.lead_id,
        firm_id: row.firm_id,
        sent: 0,
        skipped_reason: "no recipients configured",
      });
      continue;
    }

    const firmName =
      resolved.firm.branding?.firm_name ?? resolved.firm.name ?? "your firm";
    const briefUrl = `${resolveAppOrigin()}/portal/${row.firm_id}/triage/${encodeURIComponent(row.lead_id)}`;

    const email = buildDeadlineReminderEmail({
      firmName,
      contactName: row.contact_name,
      matterType: row.matter_type,
      practiceArea: row.practice_area,
      band: row.band,
      decisionDeadlineIso: row.decision_deadline,
      briefUrl,
      channel: row.slot_answers?.channel ?? null,
      now,
    });

    let sent = 0;
    const errors: string[] = [];
    for (const recipient of resolved.recipients) {
      try {
        const dispatch = await sendEmail(recipient.email, email.subject, email.html);
        if (!dispatch.skipped) sent += 1;
        else errors.push("RESEND_API_KEY not configured");
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (sent > 0) {
      // Stamp with the same guards the backstop uses: if the lawyer acted
      // between our SELECT and this UPDATE the row left 'triaging' and the
      // stamp is skipped; the reminder they received is then harmless.
      await supabase
        .from("screened_leads")
        .update({ deadline_reminder_sent_at: nowIso })
        .eq("lead_id", row.lead_id)
        .eq("firm_id", row.firm_id)
        .eq("status", "triaging")
        .is("deadline_reminder_sent_at", null);
    }

    outcomes.push({
      lead_id: row.lead_id,
      firm_id: row.firm_id,
      sent,
      skipped_reason: errors.length > 0 ? errors.join("; ") : undefined,
    });
  }

  return NextResponse.json({
    ok: true,
    swept: outcomes.length,
    batch_limit: BATCH_LIMIT,
    outcomes,
  });
}
