/**
 * POST /api/tool-intake
 *
 * Persistence endpoint for leads originating from lead-magnet tools on
 * firm websites (calculators, readiness checks, estimators). Writes a
 * screened_leads row with channel='tool', fires the standard new-lead
 * notification, and enters the triage portal workflow.
 *
 * Auth: Bearer token (TOOL_INTAKE_SECRET). Server-to-server only; the
 * firm website's API handler calls this endpoint, not the browser.
 *
 * Lower-intent signal: tool leads have conservative axis values
 * (readiness=2, urgency=2) so they naturally land in Band B or C,
 * never A. The scoring reflects that calculator usage is research-mode,
 * not a direct request for legal help.
 *
 * The tool-specific visitor confirmation email (showing the calculator
 * result) is sent by the firm website's own handler. This endpoint only
 * handles the CaseLoad Screen pipeline side: persistence, banding,
 * triage portal entry, and lawyer notification.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { computeDecisionDeadline, computeWhaleNurture, clampAxis } from '@/lib/intake-v2-derive';
import { waitUntil } from '@vercel/functions';
import { notifyLawyersOfNewLead } from '@/lib/lead-notify';
import { sanitizeBriefHtml } from '@/lib/intake-v2-security';
import { renderToolBriefHtml } from '@/lib/tool-brief-html';
import {
  deriveToolAxes,
  deriveToolBand,
  toolSlugToMatterType,
  practiceSlugToArea,
  generateToolLeadId,
  type ToolResult,
} from '@/lib/tool-intake-derive';
import { constantTimeEquals } from '@/lib/cron-auth';

// ─── Auth ───────────────────────────────────────────────────────────────────

function isToolIntakeAuthorized(req: NextRequest): boolean {
  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return false;
  const presented = header.slice('Bearer '.length).trim();
  if (!presented) return false;

  const secret = process.env.TOOL_INTAKE_SECRET;
  if (!secret) return false;

  return constantTimeEquals(presented, secret);
}

// ─── Body types ─────────────────────────────────────────────────────────────

interface ToolIntakeBody {
  toolSlug: string;
  toolName: string;
  practiceSlug: string;
  practiceName: string;
  answers: Record<string, string>;
  toolResult: ToolResult;
  contact: {
    name?: string | null;
    email: string;
  };
  locale?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Route ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isToolIntakeAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: ToolIntakeBody;
  try {
    body = (await req.json()) as ToolIntakeBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // ── Validate required fields ────────────────────────────────────────────
  if (!body.toolSlug || !body.toolName || !body.practiceSlug || !body.practiceName) {
    return NextResponse.json({ error: 'missing tool context fields' }, { status: 400 });
  }
  if (!body.toolResult || !body.toolResult.headline || !body.toolResult.groups) {
    return NextResponse.json({ error: 'missing or malformed toolResult' }, { status: 400 });
  }
  if (!body.contact?.email || !body.contact.email.includes('@')) {
    return NextResponse.json({ error: 'missing contact email' }, { status: 400 });
  }
  if (!body.answers || typeof body.answers !== 'object') {
    return NextResponse.json({ error: 'missing answers' }, { status: 400 });
  }

  // ── Firm resolution ─────────────────────────────────────────────────────
  const url = new URL(req.url);
  const firmIdParam = (url.searchParams.get('firmId') ?? '').trim();

  if (!firmIdParam || !UUID_RE.test(firmIdParam)) {
    return NextResponse.json({ error: 'missing or invalid firmId' }, { status: 400 });
  }

  const { data: firm, error: firmErr } = await supabase
    .from('intake_firms')
    .select('id, location')
    .eq('id', firmIdParam)
    .maybeSingle();

  if (firmErr) {
    return NextResponse.json(
      { error: `firm lookup failed: ${firmErr.message}` },
      { status: 500 },
    );
  }
  if (!firm) {
    return NextResponse.json({ error: 'firm not found' }, { status: 404 });
  }

  // ── Derive fields ───────────────────────────────────────────────────────
  const leadId = generateToolLeadId();
  const now = new Date();
  const matterType = toolSlugToMatterType(body.toolSlug);
  if (matterType === 'unknown') {
    return NextResponse.json(
      { error: `unrecognised tool slug: ${body.toolSlug}` },
      { status: 400 },
    );
  }
  const practiceArea = practiceSlugToArea(body.practiceSlug);
  if (practiceArea === 'unknown') {
    return NextResponse.json(
      { error: `unrecognised practice slug: ${body.practiceSlug}` },
      { status: 400 },
    );
  }
  const axes = deriveToolAxes();
  const band = deriveToolBand(axes);
  const decisionDeadline = computeDecisionDeadline(axes.urgency, now, matterType);
  const whaleNurture = computeWhaleNurture(axes.value, axes.readiness);
  const intakeLanguage = body.locale === 'pt' ? 'pt' : 'en';

  // ── Build brief HTML ────────────────────────────────────────────────────
  const rawBriefHtml = renderToolBriefHtml({
    contactName: body.contact.name ?? null,
    contactEmail: body.contact.email,
    toolName: body.toolName,
    toolSlug: body.toolSlug,
    practiceName: body.practiceName,
    practiceArea,
    matterType,
    band,
    toolResult: body.toolResult,
    answers: body.answers,
    submittedAt: now.toISOString(),
  });
  const briefHtml = sanitizeBriefHtml(rawBriefHtml);

  // ── Build brief_json (tool-specific payload, not a LawyerReport) ──────
  const briefJson = {
    _type: 'tool_lead',
    tool_slug: body.toolSlug,
    tool_name: body.toolName,
    practice_slug: body.practiceSlug,
    practice_name: body.practiceName,
    tool_result: body.toolResult,
    answers: body.answers,
  };

  // ── Insert ──────────────────────────────────────────────────────────────
  const { data: inserted, error: insertErr } = await supabase
    .from('screened_leads')
    .insert({
      lead_id: leadId,
      firm_id: firmIdParam,
      screen_version: 2,
      status: 'triaging',
      status_changed_by: 'system',
      status_changed_by_role: 'system',
      brief_json: briefJson,
      brief_html: briefHtml,
      slot_answers: { channel: 'tool', tool_slug: body.toolSlug, tool_name: body.toolName },
      band,
      matter_type: matterType,
      practice_area: practiceArea,
      value_score: clampAxis(axes.value),
      complexity_score: clampAxis(axes.complexity),
      urgency_score: clampAxis(axes.urgency),
      readiness_score: clampAxis(axes.readiness),
      readiness_answered: false,
      whale_nurture: whaleNurture,
      band_c_subtrack: null,
      decision_deadline: decisionDeadline.toISOString(),
      contact_name: body.contact.name ?? null,
      contact_email: body.contact.email,
      contact_phone: null,
      submitted_at: now.toISOString(),
      intake_language: intakeLanguage,
      raw_transcript: null,
      utm_source: null,
      utm_medium: 'tool',
      utm_campaign: body.toolSlug,
      utm_term: null,
      utm_content: null,
      referrer: null,
    })
    .select('id, lead_id, status, decision_deadline, whale_nurture')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return NextResponse.json(
        { persisted: false, mode: 'duplicate', lead_id: leadId },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: `insert failed: ${insertErr.message}` },
      { status: 500 },
    );
  }

  // ── Notification ────────────────────────────────────────────────────────
  const notifyPromise = notifyLawyersOfNewLead({
    firmId: firmIdParam,
    leadId: inserted.lead_id,
    contactName: body.contact.name ?? null,
    matterType,
    practiceArea,
    band,
    decisionDeadlineIso: inserted.decision_deadline,
    whaleNurture: !!inserted.whale_nurture,
    intakeLanguage,
    channel: 'tool',
    lifecycleStatus: 'triaging',
  }).catch((err) => {
    console.error('[tool-intake] notifyLawyersOfNewLead failed:', err);
  });

  if (process.env.NODE_ENV === 'production') {
    waitUntil(notifyPromise);
  } else {
    await notifyPromise;
  }

  return NextResponse.json({
    persisted: true,
    mode: 'live',
    id: inserted.id,
    lead_id: inserted.lead_id,
    status: inserted.status,
    decision_deadline: inserted.decision_deadline,
    band,
    channel: 'tool',
    tool_slug: body.toolSlug,
  });
}
