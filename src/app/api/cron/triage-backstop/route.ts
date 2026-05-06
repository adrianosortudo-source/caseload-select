/**
 * GET /api/cron/triage-backstop
 *
 * Backstop sweeper for the lawyer triage queue. Finds every screened_leads
 * row in 'triaging' state whose decision_deadline has passed without lawyer
 * action, flips each to 'declined' (with status_changed_by='system:backstop'),
 * resolves the decline copy via the three-layer model, and fires the
 * declined_backstop GHL webhook.
 *
 * Auth: Bearer CRON_SECRET. The route is wired and ready, but as of
 * 2026-05-05 it is NOT scheduled in vercel.json — the Vercel account is on
 * the Hobby plan, which caps cron jobs at once per day. A daily backstop
 * with a 48h decision window introduces up to 24h of decline-email latency,
 * which defeats the "decline with grace" timing intent.
 *
 * Two paths to enable:
 *   1. Upgrade the Vercel account to Pro and add to vercel.json:
 *        { "path": "/api/cron/triage-backstop", "schedule": "7 * * * *" }
 *   2. Move the schedule to Supabase pg_cron + pg_net (minute granularity,
 *      no Vercel plan dependency). Calls the same route via internal HTTP.
 *
 * Until then, the OOS auto-decline path fires at intake without depending on
 * this cron, and lawyers can press Pass manually. Operators can also POST
 * `Authorization: Bearer $CRON_SECRET` to this route on demand to sweep.
 *
 * Batching: processes up to 25 rows per run to keep wall-clock under 60s.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { loadDeclineCandidates, resolveDecline } from "@/lib/decline-resolver";
import { buildDeclinedBackstopPayload, fireGhlWebhook, type LeadFacts } from "@/lib/ghl-webhook";
import { isCronAuthorized } from "@/lib/cron-auth";

const BATCH_LIMIT = 25;

interface TriagingRow {
  lead_id: string;
  firm_id: string;
  band: "A" | "B" | "C" | null;
  matter_type: string;
  practice_area: string;
  submitted_at: string;
  decision_deadline: string;
  status_note: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

interface BackstopOutcome {
  lead_id: string;
  firm_id: string;
  webhook_fired: boolean;
  webhook_reason?: string;
}

export async function GET(req: NextRequest) {
  // Cron auth. Accepts CRON_SECRET (Vercel cron, operator curl) or
  // PG_CRON_TOKEN (Supabase pg_cron). See lib/cron-auth for details.
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // Find rows past deadline. The partial index idx_screened_leads_deadline_active
  // makes this query cheap even on a large table.
  const { data: due, error: fetchErr } = await supabase
    .from("screened_leads")
    .select(`
      lead_id, firm_id, band, matter_type, practice_area,
      submitted_at, decision_deadline, status_note,
      contact_name, contact_email, contact_phone
    `)
    .eq("status", "triaging")
    .lt("decision_deadline", nowIso)
    .order("decision_deadline", { ascending: true })
    .limit(BATCH_LIMIT);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const rows = (due ?? []) as TriagingRow[];
  const outcomes: BackstopOutcome[] = [];

  for (const row of rows) {
    // Update first, fire webhook second. The conditional WHERE clauses guard
    // against a race with a lawyer-initiated Take/Pass landing concurrently —
    // if the row already moved out of 'triaging', the update affects 0 rows
    // and we skip the webhook.
    const { error: updErr, count } = await supabase
      .from("screened_leads")
      .update(
        {
          status: "declined",
          status_changed_at: nowIso,
          status_changed_by: "system:backstop",
        },
        { count: "exact" },
      )
      .eq("lead_id", row.lead_id)
      .eq("firm_id", row.firm_id)
      .eq("status", "triaging");

    if (updErr) {
      outcomes.push({
        lead_id: row.lead_id,
        firm_id: row.firm_id,
        webhook_fired: false,
        webhook_reason: `update failed: ${updErr.message}`,
      });
      continue;
    }
    if (count === 0) {
      // Race: lawyer acted between our SELECT and UPDATE. Skip silently.
      outcomes.push({
        lead_id: row.lead_id,
        firm_id: row.firm_id,
        webhook_fired: false,
        webhook_reason: "race: lead moved out of triaging",
      });
      continue;
    }

    // Resolve decline copy + fire webhook.
    const candidates = await loadDeclineCandidates({
      firmId: row.firm_id,
      practiceArea: row.practice_area,
      perLeadOverride: row.status_note,
    });
    const verdict = resolveDecline(candidates, "backstop");

    const facts: LeadFacts = {
      lead_id: row.lead_id,
      firm_id: row.firm_id,
      band: row.band,
      matter_type: row.matter_type,
      practice_area: row.practice_area,
      submitted_at: row.submitted_at,
      contact_name: row.contact_name,
      contact_email: row.contact_email,
      contact_phone: row.contact_phone,
    };
    const payload = buildDeclinedBackstopPayload({
      facts,
      statusChangedAt: now,
      declineSubject: verdict.subject,
      declineBody: verdict.body,
      declineSource: verdict.source,
      decisionDeadline: row.decision_deadline,
    });
    const delivery = await fireGhlWebhook(row.firm_id, payload);

    outcomes.push({
      lead_id: row.lead_id,
      firm_id: row.firm_id,
      webhook_fired: delivery.fired,
      webhook_reason: delivery.reason,
    });
  }

  return NextResponse.json({
    ok: true,
    swept: outcomes.length,
    batch_limit: BATCH_LIMIT,
    outcomes,
  });
}
