/**
 * POST /api/admin/screened-leads/[id]/reclassify
 *
 * Backfill route: re-runs the current engine + brief renderer against the
 * stored `raw_transcript` of an existing `screened_leads` row and updates
 * the row in place. Used to retroactively apply engine and brief-layout
 * changes (e.g. Phase A matter-pack expansion, NAP block addition) to
 * rows that were inserted before those changes shipped.
 *
 * Auth: Bearer CRON_SECRET or PG_CRON_TOKEN (operator only).
 *
 * Body (optional):
 *   { dryRun?: boolean }  — when true, returns the would-be UPDATE payload
 *                          without writing anything. Defaults to false.
 *
 * The row's `lead_id`, `created_at`, `status`, `firm_id`, `submitted_at`
 * are preserved. Everything that the engine derives from the transcript
 * (matter_type, practice_area, band, brief_json, brief_html, four-axis
 * scores, decision_deadline) is recomputed.
 *
 * Status is NOT recomputed: a lead that was already `taken` or `passed`
 * stays in that lifecycle state. Reclassification is about the brief
 * content, not the lifecycle.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { isCronAuthorized } from '@/lib/cron-auth';
import { initialiseState } from '@/lib/screen-engine/extractor';
import { runEvidencePass } from '@/lib/screen-engine/slotEvidence';
import { mergeLlmResults } from '@/lib/screen-engine/llm/extractor';
import { buildReport } from '@/lib/screen-engine/report';
import { computeBand } from '@/lib/screen-engine/band';
import { llmExtractServer } from '@/lib/screen-llm-server';
import { renderBriefHtmlServer } from '@/lib/screen-brief-html';
import { resolveFirmTimezone } from '@/lib/firm-timezone';
import { computeDecisionDeadline, computeWhaleNurture, clampAxis } from '@/lib/intake-v2-derive';
import type { EngineState, Band } from '@/lib/screen-engine/types';

function seedVoiceState(state: EngineState, callerPhone: string | null, callerName: string | null): EngineState {
  let s = state;
  if (callerPhone && !s.slots['client_phone']) {
    s = {
      ...s,
      slots: { ...s.slots, client_phone: callerPhone },
      slot_meta: {
        ...s.slot_meta,
        client_phone: { source: 'answered', confidence: 1.0 },
      },
    };
  }
  if (callerName && !s.slots['client_name']) {
    s = {
      ...s,
      slots: { ...s.slots, client_name: callerName },
      slot_meta: {
        ...s.slot_meta,
        client_name: { source: 'answered', confidence: 1.0 },
      },
    };
  }
  return s;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  let body: { dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }
  const dryRun = body.dryRun === true;

  // ── Fetch the existing row ─────────────────────────────────────────────
  const { data: row, error: fetchErr } = await supabase
    .from('screened_leads')
    .select(
      'id, lead_id, firm_id, submitted_at, status, raw_transcript, slot_answers, brief_json',
    )
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json(
      { error: `fetch failed: ${fetchErr.message}` },
      { status: 500 },
    );
  }
  if (!row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // ── Resolve the firm timezone so the rebuilt brief renders submitted_at in
  // firm-local time, matching the live /api/voice-intake path (#140). Best
  // effort: a missing firm row or location falls back to America/Toronto via
  // resolveFirmTimezone(null).
  const { data: firmRow } = await supabase
    .from('intake_firms')
    .select('location')
    .eq('id', row.firm_id)
    .maybeSingle();
  const firmTimezone = resolveFirmTimezone({ location: firmRow?.location ?? null });

  const transcript = row.raw_transcript ?? '';
  if (!transcript.trim()) {
    return NextResponse.json(
      { error: 'row has no raw_transcript to reclassify against' },
      { status: 400 },
    );
  }

  // ── Pull voice metadata from slot_answers (for seed) ───────────────────
  const sa = (row.slot_answers ?? {}) as {
    voice_meta?: {
      caller_phone?: string | null;
      caller_name?: string | null;
      call_id?: string | null;
      call_duration_sec?: number | null;
      recording_url?: string | null;
    };
    channel?: string;
  };
  const callerPhone = sa.voice_meta?.caller_phone ?? null;
  const callerName = sa.voice_meta?.caller_name ?? null;
  // Default to 'web' (Website widget) when slot_answers.channel is missing.
  //
  // History: this route was first written as a voice-only backfill (Phase A
  // matter-pack reclassify), so the default was 'voice'. After web/Meta
  // channels started flowing through reclassify too, that default became
  // wrong: a missing channel value silently relabelled web/Meta rows as
  // voice and the renderer emitted call-shaped provenance for them. The
  // rest of the codebase (intake-v2 reads, screen route writes) treats
  // missing channel as 'web', so reclassify now aligns with that.
  const channel = (sa.channel ?? 'web') as
    | 'web'
    | 'whatsapp'
    | 'sms'
    | 'instagram'
    | 'facebook'
    | 'gbp'
    | 'voice';

  // ── Engine pipeline ────────────────────────────────────────────────────
  let state = initialiseState(transcript);
  state = { ...state, channel };
  state = seedVoiceState(state, callerPhone, callerName);
  state = runEvidencePass(transcript, state);

  if (state.matter_type !== 'out_of_scope') {
    try {
      const llm = await llmExtractServer(transcript, state);
      const filledIds = Object.keys(llm.extracted).filter(
        (k) => llm.extracted[k] !== null && llm.extracted[k] !== '',
      );
      if (llm.mode === 'live' && filledIds.length > 0) {
        state = mergeLlmResults(state, llm.extracted);
      }
    } catch (err) {
      console.warn('[reclassify] llmExtractServer failed:', err);
    }
  }

  // ── Build the new report + brief ───────────────────────────────────────
  const report = buildReport(state);

  // Reclassify keeps the original decision_deadline by default (the lawyer
  // still has the same window to act); we compute a fresh one only to stamp
  // it onto the cover. The persisted column is left untouched below — the
  // brief's data attribute reflects the existing deadline.
  const reclassifyAxes = report.four_axis;
  const reclassifyNow = new Date();
  const reclassifyDeadline = computeDecisionDeadline(
    reclassifyAxes.urgency,
    reclassifyNow,
    state.matter_type,
  );
  const reclassifyWhale = computeWhaleNurture(
    reclassifyAxes.value,
    reclassifyAxes.readiness,
  );

  const briefHtml = renderBriefHtmlServer(
    report,
    channel,
    state.language,
    firmTimezone,
    state.matter_type,
    state.practice_area,
    {
      decisionDeadlineIso: reclassifyDeadline.toISOString(),
      whaleNurture: reclassifyWhale,
    },
  );
  const bandResult = computeBand(state);
  const band: Band | null = bandResult.band;

  const now = reclassifyNow;
  const axes = reclassifyAxes;
  const decisionDeadline = reclassifyDeadline;
  const whaleNurture = reclassifyWhale;

  // Preserve original slot_answers; just refresh the engine-derived
  // pieces. (slot_answers.voice_meta + channel stays the same.)
  const slotAnswers = {
    ...sa,
    slots: state.slots,
    slot_meta: state.slot_meta,
    slot_evidence: state.slot_evidence,
    channel,
  };

  const updatePayload = {
    brief_json: report,
    brief_html: briefHtml,
    slot_answers: slotAnswers,
    band,
    matter_type: state.matter_type,
    practice_area: state.practice_area,
    value_score: clampAxis(axes.value),
    complexity_score: clampAxis(axes.complexity),
    urgency_score: clampAxis(axes.urgency),
    readiness_score: clampAxis(axes.readiness),
    readiness_answered: !!axes.readinessAnswered,
    whale_nurture: whaleNurture,
    decision_deadline: decisionDeadline.toISOString(),
    contact_name: state.slots['client_name'] ?? callerName ?? null,
    contact_email: state.slots['client_email'] ?? null,
    contact_phone: state.slots['client_phone'] ?? callerPhone ?? null,
    intake_language: state.language ?? 'en',
    // status / firm_id / lead_id / created_at NOT touched
    updated_at: now.toISOString(),
  };

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      id,
      preview: {
        matter_type: updatePayload.matter_type,
        practice_area: updatePayload.practice_area,
        band: updatePayload.band,
        contact_name: updatePayload.contact_name,
        contact_phone: updatePayload.contact_phone,
        brief_html_length: briefHtml.length,
        has_nap_block: briefHtml.includes('brief-group-nap'),
      },
    });
  }

  // ── Write the new state ────────────────────────────────────────────────
  const { error: updateErr } = await supabase
    .from('screened_leads')
    .update(updatePayload)
    .eq('id', id);

  if (updateErr) {
    return NextResponse.json(
      { error: `update failed: ${updateErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    id,
    reclassified_at: now.toISOString(),
    old_state: {
      matter_type: row.brief_json && typeof row.brief_json === 'object'
        ? (row.brief_json as { matter_snapshot?: string }).matter_snapshot
        : null,
    },
    new_state: {
      matter_type: updatePayload.matter_type,
      practice_area: updatePayload.practice_area,
      band: updatePayload.band,
      contact_name: updatePayload.contact_name,
      contact_phone: updatePayload.contact_phone,
      brief_html_length: briefHtml.length,
      has_nap_block: briefHtml.includes('brief-group-nap'),
    },
  });
}
