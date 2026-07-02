/**
 * GET /api/cron/expire-web-intake-sessions
 *
 * Sweeper for expired web-widget intake sessions (qualification audit
 * F2/F6/item 5, 2026-07-02). Same doctrine as the Meta-channel sweep
 * (expire-channel-intake-sessions): find every web_intake_sessions row
 * where expires_at < now() AND finalized = false, then branch on the
 * contact gate.
 *
 *   - contact_complete: the lead is reachable. Insert a thin brief into
 *     screened_leads (mirrors the core /api/intake-v2 insert; consent
 *     and scoring-port-delta columns are intentionally not replicated
 *     here, an out-of-scope trim for this recovery path), fire the
 *     new-lead notification, mark the session finalized with
 *     screened_lead_id set. DR-038: a reachable lead must reach the
 *     lawyer, a thin brief beats a dropped lead.
 *   - otherwise: move to unconfirmed_inquiries with reason='abandoned',
 *     mark the session finalized.
 *
 * This is a dedicated web sweep rather than a widened MetaChannel path:
 * the Meta sweep's finalize helper (finalizeChannelLead) is coupled to
 * ChannelSender / Send-API closing messages that do not exist for web,
 * so reusing it would mean threading 'web' through a type whose name
 * says Meta. Cheaper and safer to duplicate the insert shape here.
 *
 * Auth: Bearer CRON_SECRET or PG_CRON_TOKEN. Batch: 50 rows per run.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { isCronAuthorized } from "@/lib/cron-auth";
import { persistUnconfirmedInquiry } from "@/lib/unconfirmed-inquiry";
import { resolveFirmTimezone } from "@/lib/firm-timezone";
import { computeDecisionDeadline, computeWhaleNurture, computeInitialStatus, clampAxis } from "@/lib/intake-v2-derive";
import { buildReport } from "@/lib/screen-engine/report";
import { computeBand } from "@/lib/screen-engine/band";
import { renderBriefHtmlServer } from "@/lib/screen-brief-html";
import { notifyLawyersOfNewLead } from "@/lib/lead-notify";
import type { EngineState, LawyerReport } from "@/lib/screen-engine/types";

const BATCH_LIMIT = 50;

interface ExpiredWebSession {
  id: string;
  firm_id: string;
  lead_id: string;
  engine_state: EngineState;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  referrer: string | null;
}

interface SweepOutcome {
  session_id: string;
  firm_id: string;
  moved: boolean;
  disposition: "finalized_lead" | "abandoned";
  reason?: string;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowIso = new Date().toISOString();

  const { data: expired, error } = await supabase
    .from("web_intake_sessions")
    .select("id, firm_id, lead_id, engine_state, utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer")
    .eq("finalized", false)
    .lt("expires_at", nowIso)
    .order("expires_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const outcomes: SweepOutcome[] = [];
  let finalizedCount = 0;
  let abandonedCount = 0;
  const firmLocationCache = new Map<string, string | null>();

  async function loadFirmLocation(firmId: string): Promise<string | null> {
    if (firmLocationCache.has(firmId)) return firmLocationCache.get(firmId) ?? null;
    const { data } = await supabase.from("intake_firms").select("location").eq("id", firmId).maybeSingle();
    const location = (data?.location as string | null) ?? null;
    firmLocationCache.set(firmId, location);
    return location;
  }

  for (const row of (expired ?? []) as ExpiredWebSession[]) {
    let state: EngineState | null = null;
    let report: LawyerReport | null = null;
    try {
      state = { ...row.engine_state, channel: "web" };
      report = buildReport(state);
    } catch (err) {
      console.warn(
        `[expire-web-sessions] buildReport failed for session=${row.id}; treating as abandoned:`,
        err,
      );
      state = null;
      report = null;
    }

    if (state && report && report.contact_complete) {
      const location = await loadFirmLocation(row.firm_id);
      const firmTimezone = resolveFirmTimezone({ location });
      const now = new Date();
      const band = computeBand(state).band;
      const decisionDeadline = computeDecisionDeadline(report.four_axis.urgency, now, state.matter_type);
      const whaleNurture = computeWhaleNurture(report.four_axis.value, report.four_axis.readiness);
      const briefHtml = renderBriefHtmlServer(
        report,
        "web",
        state.language,
        firmTimezone,
        state.matter_type,
        state.practice_area,
        { decisionDeadlineIso: decisionDeadline.toISOString(), whaleNurture },
      );
      const { status: initialStatus, changedBy: initialChangedBy } = computeInitialStatus(state.matter_type);
      const hydratedSlotAnswers = {
        slots: state.slots,
        slot_meta: state.slot_meta,
        slot_evidence: state.slot_evidence,
        raw: state.raw,
        intent_family: state.intent_family,
        dispute_family: state.dispute_family,
        advisory_subtrack: state.advisory_subtrack,
        questionHistory: state.questionHistory,
        channel: "web",
      };

      const { data: inserted, error: insertErr } = await supabase
        .from("screened_leads")
        .insert({
          lead_id: row.lead_id,
          firm_id: row.firm_id,
          screen_version: 2,
          status: initialStatus,
          status_changed_by: initialChangedBy,
          status_changed_by_role: "system",
          brief_json: report,
          brief_html: briefHtml,
          slot_answers: hydratedSlotAnswers,
          band,
          matter_type: state.matter_type,
          practice_area: state.practice_area,
          value_score: clampAxis(report.four_axis.value),
          complexity_score: clampAxis(report.four_axis.complexity),
          urgency_score: clampAxis(report.four_axis.urgency),
          readiness_score: clampAxis(report.four_axis.readiness),
          readiness_answered: !!report.four_axis.readinessAnswered,
          whale_nurture: whaleNurture,
          decision_deadline: decisionDeadline.toISOString(),
          contact_name: state.slots.client_name ?? null,
          contact_email: state.slots.client_email ?? null,
          contact_phone: state.slots.client_phone ?? null,
          submitted_at: state.submitted_at ?? now.toISOString(),
          intake_language: state.language ?? "en",
          utm_source: row.utm_source,
          utm_medium: row.utm_medium,
          utm_campaign: row.utm_campaign,
          utm_term: row.utm_term,
          utm_content: row.utm_content,
          referrer: row.referrer,
          axis_reasoning: report.axis_reasoning ?? null,
        })
        .select("id, lead_id, status, decision_deadline, whale_nurture")
        .single();

      if (insertErr) {
        if (insertErr.code === "23505") {
          // Duplicate lead_id: /api/intake-v2 already inserted this lead
          // (race with the widget's own submit); finalize the session and
          // move on rather than leaving it open forever.
          await supabase
            .from("web_intake_sessions")
            .update({ finalized: true, last_activity_at: nowIso })
            .eq("id", row.id);
          finalizedCount++;
          outcomes.push({
            session_id: row.id,
            firm_id: row.firm_id,
            moved: true,
            disposition: "finalized_lead",
            reason: "duplicate lead_id",
          });
          continue;
        }
        // Transient DB error: leave the session open so the next sweep retries.
        outcomes.push({
          session_id: row.id,
          firm_id: row.firm_id,
          moved: false,
          disposition: "finalized_lead",
          reason: insertErr.message,
        });
        continue;
      }

      const notifyBand: "A" | "B" | "C" | "D" | null =
        band === "A" || band === "B" || band === "C" || band === "D" ? band : null;
      await notifyLawyersOfNewLead({
        firmId: row.firm_id,
        leadId: inserted.lead_id,
        contactName: state.slots.client_name ?? null,
        matterType: state.matter_type,
        practiceArea: state.practice_area,
        band: notifyBand,
        decisionDeadlineIso: inserted.decision_deadline,
        whaleNurture: !!inserted.whale_nurture,
        intakeLanguage: state.language ?? "en",
        channel: "web",
        lifecycleStatus: inserted.status as "triaging" | "declined",
      }).catch((err) => {
        console.error("[expire-web-sessions] notifyLawyersOfNewLead failed:", err);
      });

      await supabase
        .from("web_intake_sessions")
        .update({ finalized: true, screened_lead_id: inserted.id, last_activity_at: nowIso })
        .eq("id", row.id);

      finalizedCount++;
      outcomes.push({ session_id: row.id, firm_id: row.firm_id, moved: true, disposition: "finalized_lead" });
      continue;
    }

    // Contact gate failed (or state was unrestorable): the lead is
    // unreachable, move to unconfirmed_inquiries for ops visibility.
    const engineState = (state ?? row.engine_state ?? {}) as Partial<EngineState>;
    const inquiryResult = await persistUnconfirmedInquiry({
      firmId: row.firm_id,
      channel: "web",
      senderId: row.lead_id,
      senderMeta: {
        session_id: row.id,
        utm_source: row.utm_source,
        utm_medium: row.utm_medium,
        utm_campaign: row.utm_campaign,
        referrer: row.referrer,
      },
      rawTranscript: engineState.input ?? null,
      matterType: engineState.matter_type ?? null,
      practiceArea: engineState.practice_area ?? null,
      intakeLanguage: engineState.language ?? null,
      reason: "abandoned",
    });

    const { error: finalErr } = await supabase
      .from("web_intake_sessions")
      .update({ finalized: true, last_activity_at: nowIso })
      .eq("id", row.id);

    abandonedCount++;
    outcomes.push({
      session_id: row.id,
      firm_id: row.firm_id,
      moved: inquiryResult.ok,
      disposition: "abandoned",
      reason: !inquiryResult.ok ? inquiryResult.error : finalErr?.message,
    });
  }

  return NextResponse.json({
    ok: true,
    swept: outcomes.length,
    finalized: finalizedCount,
    abandoned: abandonedCount,
    batch_limit: BATCH_LIMIT,
    outcomes,
  });
}
