/**
 * POST /api/intake-v2
 *
 * Persistence endpoint for CaseLoad Screen 2.0 (the Vite SPA at
 * https://caseload-screen-v2.vercel.app). The screen submits a fully-rendered
 * brief here at the end of contact capture; this route writes it to
 * `screened_leads`, where the lawyer portal reads from.
 *
 * Architecture note. firmId currently arrives via query param (`?firmId=...`)
 * to match the existing /widget/[firmId] precedent. White-label custom domains
 * (S9 territory per CRM Bible) will eventually shift firmId resolution to
 * subdomain lookup via edge middleware (see src/middleware.ts for the existing
 * resolution path). When that lands, this route should accept the resolved
 * firm context from a header set by middleware rather than from the query
 * string. The body shape stays the same.
 *
 * Demo handling. When firmId is missing, equal to 'demo_firm', or not a valid
 * uuid pointing at an existing intake_firms row, persistence is skipped and
 * the response reports `{ persisted: false, mode: 'demo' }`. The screen still
 * renders a brief client-side; nothing pollutes the production table.
 *
 * Body contract (lawyer portal depends on this):
 *
 *   {
 *     lead_id:        "L-YYYY-MM-DD-XXX",
 *     submitted_at:   ISO timestamp string,
 *     matter_type:    string,
 *     practice_area:  string,
 *     band:           "A" | "B" | "C" | "D" | null,
 *     axes: {
 *       value:              0-10,
 *       complexity:         0-10,    -- engine-internal (drag); displayed as Simplicity
 *       urgency:            0-10,
 *       readiness:          0-10,
 *       readinessAnswered:  boolean,
 *     },
 *     brief_json:     LawyerReport object,
 *     brief_html:     string,        -- moment-in-time pre-rendered HTML from screen DOM
 *     slot_answers:   { slots, slot_meta, slot_evidence },
 *     contact: {
 *       name?:  string,
 *       email?: string,
 *       phone?: string,
 *     },
 *     intake_language?: string,   -- ISO 639-1 code (e.g. 'en', 'fr', 'pt'); optional, defaults to 'en'
 *     raw_transcript?:  string,   -- lead's original-language text; only sent when intake_language != 'en'
 *   }
 *
 * Lifecycle (the contract across Supabase, the portal, and the GHL custom
 * field — do not drift):
 *
 *   triaging  - default after submit, awaiting lawyer Take or Pass or 48h backstop
 *   taken     - lawyer pressed Take, band cadence engaged
 *   passed    - lawyer pressed Pass, decline-with-grace fired
 *   declined  - auto-fired on OOS detection at intake or 48h backstop expiry
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  computeDecisionDeadline,
  computeWhaleNurture,
  computeInitialStatus,
  clampAxis,
} from "@/lib/intake-v2-derive";
import { waitUntil } from "@vercel/functions";
import { notifyLawyersOfNewLead } from "@/lib/lead-notify";
import { originAllowed, validateIntakeBody, sanitizeBriefHtml } from "@/lib/intake-v2-security";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import { evaluateContactGate } from "@/lib/screen-engine/contact-doctrine";
import { persistUnconfirmedInquiry } from "@/lib/unconfirmed-inquiry";

interface IntakeAxes {
  value: number;
  complexity: number;
  urgency: number;
  readiness: number;
  readinessAnswered: boolean;
}

interface IntakeBody {
  lead_id?: string;
  submitted_at?: string;
  matter_type?: string;
  practice_area?: string;
  band?: 'A' | 'B' | 'C' | 'D' | null;
  axes?: IntakeAxes;
  brief_json?: unknown;
  brief_html?: string;
  slot_answers?: unknown;
  contact?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  intake_language?: string;
  raw_transcript?: string;
  // Lead enrichment Module 1 — passive web-attribution. The Vite SPA reads
  // these from window.location at widget load and the parent document
  // referrer, then passes them through here. Voice / Meta channels do not
  // populate these (no URL).
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  referrer?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // CORS — Screen 2.0 lives on a different Vercel project, so the browser
  // calls this endpoint cross-origin. The platform-owned domain and any
  // firm's custom domain are allowed; everything else is rejected.
  // (Codex audit HIGH #4 — previously this used Access-Control-Allow-Origin
  // = "*" with no schema validation, letting any origin POST arbitrary
  // brief_html that the lawyer portal renders verbatim.)
  const originCheck = await originAllowed(req);
  const requestOrigin = req.headers.get('origin');
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
  if (originCheck.ok) {
    corsHeaders['Access-Control-Allow-Origin'] = requestOrigin ?? '*';
  }

  if (!originCheck.ok) {
    return NextResponse.json(
      { error: 'origin not allowed', reason: originCheck.reason },
      { status: 403, headers: corsHeaders },
    );
  }

  // Rate limit (APP-007). Each call writes a screened_leads row and
  // we eat the Gemini extraction cost upstream; 30/min/IP stops a
  // spam flood from running up the bill. 429 + Retry-After when the
  // bucket is empty.
  const ip = ipFromRequest(req);
  const rl = await checkRateLimit('intake', ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate limited', retry_after_seconds: Math.ceil((rl.reset - Date.now()) / 1000) },
      { status: 429, headers: { ...corsHeaders, ...rateLimitHeaders(rl) } },
    );
  }

  // Parse body
  let body: IntakeBody;
  try {
    body = (await req.json()) as IntakeBody;
  } catch {
    return NextResponse.json(
      { error: 'invalid JSON body' },
      { status: 400, headers: corsHeaders }
    );
  }

  // ── firmId resolution ──────────────────────────────────────────────────────
  const url = new URL(req.url);
  const firmIdParam = (url.searchParams.get('firmId') ?? '').trim();

  // Demo / missing firm → render-only mode, no persistence
  if (!firmIdParam || firmIdParam === 'demo_firm') {
    return NextResponse.json(
      { persisted: false, mode: 'demo', reason: 'no firm context' },
      { status: 200, headers: corsHeaders }
    );
  }

  if (!UUID_RE.test(firmIdParam)) {
    return NextResponse.json(
      { persisted: false, mode: 'demo', reason: 'firmId not a uuid' },
      { status: 200, headers: corsHeaders }
    );
  }

  const { data: firm, error: firmErr } = await supabase
    .from('intake_firms')
    .select('id')
    .eq('id', firmIdParam)
    .maybeSingle();
  if (firmErr) {
    return NextResponse.json(
      { error: `firm lookup failed: ${firmErr.message}` },
      { status: 500, headers: corsHeaders }
    );
  }
  if (!firm) {
    return NextResponse.json(
      { persisted: false, mode: 'demo', reason: 'firmId not found in intake_firms' },
      { status: 200, headers: corsHeaders }
    );
  }

  // ── Body validation ────────────────────────────────────────────────────────
  // Full shape + bounds + type validation. Replaces the previous
  // missing-field check (which left brief_html / brief_json / slot_answers
  // unbounded and unchecked). Returns a structured 400 on first failure
  // batch rather than failing at the DB insert with an opaque error.
  const validated = validateIntakeBody(body);
  if (!validated.ok) {
    return NextResponse.json(
      { error: 'invalid body', issues: validated.errors },
      { status: 400, headers: corsHeaders },
    );
  }

  // Re-bind to the validated shape so downstream reads can rely on the
  // narrowed types. We continue to reference `body` for the parts we
  // pass to other writes for backwards-compat with the existing code.
  const v = validated.body;

  // brief_html sanitize: strip script tags, event handlers, dangerous URL
  // schemes, iframe/object/embed, HTML comments. The triage portal dumps
  // brief_html verbatim into a scoped .brief container, so this is the
  // last line of defense before stored XSS could fire in the lawyer's
  // authenticated session.
  const sanitizedBriefHtml = sanitizeBriefHtml(v.brief_html);

  const axes = v.axes as IntakeAxes;
  const matterType = v.matter_type;
  const band = v.band;

  // ── Contact-capture doctrine gate (2026-05-15) ─────────────────────────────
  // "No contact, no lead." The SPA gate (Phase C) is the primary control,
  // but defense-in-depth: if a brief reaches us with missing name AND
  // missing (email OR phone), persist as unconfirmed_inquiry and return
  // a 200 acknowledging the rejection without inserting into screened_leads.
  //
  // The SPA already validates contact-complete client-side; this server-side
  // gate catches direct posts (curl / scripted abuse / SPA regression).
  const contactGate = evaluateContactGate({
    client_name: v.contact?.name ?? null,
    client_email: v.contact?.email ?? null,
    client_phone: v.contact?.phone ?? null,
  });
  if (!contactGate.complete) {
    const inboundChannelForUnconfirmed =
      ((v.slot_answers as { channel?: string } | null)?.channel) ?? 'web';
    await persistUnconfirmedInquiry({
      firmId: firmIdParam,
      channel: inboundChannelForUnconfirmed as 'web',
      senderId: null,
      senderMeta: {
        utm_source: v.utm_source ?? null,
        utm_medium: v.utm_medium ?? null,
        utm_campaign: v.utm_campaign ?? null,
        referrer: v.referrer ?? null,
      },
      rawTranscript: v.raw_transcript ?? null,
      matterType,
      practiceArea: v.practice_area,
      intakeLanguage: v.intake_language ?? 'en',
      reason: 'no_contact_provided',
    });
    return NextResponse.json(
      {
        persisted: false,
        reason: 'awaiting_contact',
        missing: contactGate.missing,
      },
      { status: 200, headers: corsHeaders },
    );
  }

  // Channel is stored inside slot_answers by the Vite SPA. Extract it here
  // so we can pass it to the notification without a second DB read.
  const inboundChannel =
    ((v.slot_answers as { channel?: string } | null)?.channel) ?? 'web';

  // Referrer: body wins when the Vite SPA sent it (which carries the parent
  // page's document.referrer when the widget is iframed on the firm's site).
  // Fall back to the HTTP Referer header, which at least tells us the origin
  // hosting the screen. Header value is unset for server-to-server callers.
  const referrer =
    v.referrer && v.referrer.length > 0
      ? v.referrer
      : req.headers.get('referer');

  // ── Derived flags ──────────────────────────────────────────────────────────
  const now = new Date();
  const decisionDeadline = computeDecisionDeadline(axes.urgency, now, matterType);
  const whaleNurture = computeWhaleNurture(axes.value, axes.readiness);
  // Doctrine (2026-05-15): every lead lands as `triaging`. OOS matters carry
  // band='D' so the lawyer can Refer / Take / Pass. Decline-with-grace only
  // fires on lawyer-initiated Pass or the deadline backstop, never at intake.
  const { status: initialStatus, changedBy: initialChangedBy } = computeInitialStatus(matterType);

  // band_c_subtrack: deferred. The Bible defines three sub-tracks qualitatively
  // (fast_transaction, window_shopper, wrong_fit) but the numeric thresholds
  // are not yet locked. Leave NULL at insert; the portal can compute from the
  // axes columns or a later cron sweep can backfill once thresholds are pinned.
  const bandCSubtrack: string | null = null;

  // ── Insert ────────────────────────────────────────────────────────────────
  const { data: inserted, error: insertErr } = await supabase
    .from('screened_leads')
    .insert({
      lead_id: v.lead_id,
      firm_id: firmIdParam,
      screen_version: 2,
      status: initialStatus,
      status_changed_by: initialChangedBy,
      // APP-006: role column added 2026-05-14. New rows are
      // created by the system (or system:backstop on declined OOS);
      // a lawyer or operator only enters the picture on later
      // take/pass.
      status_changed_by_role: "system",
      brief_json: v.brief_json,
      brief_html: sanitizedBriefHtml,
      slot_answers: v.slot_answers,
      band,
      matter_type: matterType,
      practice_area: v.practice_area,
      value_score: clampAxis(axes.value),
      complexity_score: clampAxis(axes.complexity),
      urgency_score: clampAxis(axes.urgency),
      readiness_score: clampAxis(axes.readiness),
      readiness_answered: !!axes.readinessAnswered,
      whale_nurture: whaleNurture,
      band_c_subtrack: bandCSubtrack,
      decision_deadline: decisionDeadline.toISOString(),
      contact_name: v.contact?.name ?? null,
      contact_email: v.contact?.email ?? null,
      contact_phone: v.contact?.phone ?? null,
      submitted_at: v.submitted_at ?? now.toISOString(),
      intake_language: v.intake_language ?? 'en',
      raw_transcript: v.raw_transcript ?? null,
      // Module 1 lead enrichment — passive web-attribution. Each is null
      // when the widget URL had no corresponding ?utm_* param or the
      // request had no Referer header.
      utm_source: v.utm_source ?? null,
      utm_medium: v.utm_medium ?? null,
      utm_campaign: v.utm_campaign ?? null,
      utm_term: v.utm_term ?? null,
      utm_content: v.utm_content ?? null,
      referrer: referrer ?? null,
    })
    .select('id, lead_id, status, decision_deadline, whale_nurture')
    .single();

  if (insertErr) {
    // Duplicate lead_id is the realistic failure mode (re-submit, double-fire).
    // Return 409 so the screen can either ignore (idempotent) or surface.
    if (insertErr.code === '23505') {
      return NextResponse.json(
        { persisted: false, mode: 'duplicate', lead_id: v.lead_id },
        { status: 409, headers: corsHeaders }
      );
    }
    return NextResponse.json(
      { error: `insert failed: ${insertErr.message}` },
      { status: 500, headers: corsHeaders }
    );
  }

  // Lead notification email. Doctrine (2026-05-15): "The engine sorts
  // attention, the lawyer decides outcome." OOS leads now carry band='D'
  // and status='triaging' so the lawyer can Refer / Take / Pass. The
  // decline-with-grace GHL cadence fires only on lawyer-initiated Pass
  // or the deadline backstop, never at intake.
  if (inserted.status === "triaging" || inserted.status === "declined") {
    // Narrow band to the email-render shape. Declined OOS rows have band=null.
    const notifyBand: "A" | "B" | "C" | "D" | null =
      band === "A" || band === "B" || band === "C" || band === "D" ? band : null;
    waitUntil(notifyLawyersOfNewLead({
      firmId: firmIdParam,
      leadId: inserted.lead_id,
      contactName: v.contact?.name ?? null,
      matterType: matterType,
      practiceArea: v.practice_area,
      band: notifyBand,
      decisionDeadlineIso: inserted.decision_deadline,
      whaleNurture: !!inserted.whale_nurture,
      intakeLanguage: v.intake_language ?? 'en',
      channel: inboundChannel,
      lifecycleStatus: inserted.status as "triaging" | "declined",
    }).catch((err) => {
      // Visible in Vercel function logs; not surfaced to the screen.
      console.error("[intake-v2] notifyLawyersOfNewLead failed:", err);
    }));
  }

  return NextResponse.json(
    {
      persisted: true,
      mode: 'live',
      id: inserted.id,
      lead_id: inserted.lead_id,
      status: inserted.status,
      decision_deadline: inserted.decision_deadline,
      whale_nurture: inserted.whale_nurture,
    },
    { status: 200, headers: corsHeaders }
  );
}

export async function OPTIONS(req: NextRequest) {
  // Origin-aware preflight. Echo the Origin back ONLY when it's allowed;
  // otherwise omit the allow-origin header (browser will block the
  // cross-origin POST without it). Mirrors the runtime check in POST.
  const check = await originAllowed(req);
  const requestOrigin = req.headers.get('origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  if (check.ok && requestOrigin) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
  }
  return new NextResponse(null, { status: 204, headers });
}

