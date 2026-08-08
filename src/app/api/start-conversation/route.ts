/**
 * POST /api/start-conversation
 *
 * Persistence + notification endpoint for the "Start a Conversation" flow
 * (BUILD_PLAN_start_conversation_flow_v1.md). This replaces the bare
 * `mailto:` behind every "Start a conversation" CTA on the marketing site
 * with a short qualifying intake, in the site's own tool grammar, that
 * lands as a brief in Adriano's inbox either way.
 *
 * Unlike /api/marketing-lead-intake (server-to-server, bearer secret,
 * called by a client firm's own website server on behalf of ITS leads),
 * this route is called directly by the visitor's browser from the same
 * origin: no shared secret. Protected instead by rate limit (fail-closed,
 * see FAIL_CLOSED_BUCKETS in lib/rate-limit.ts), a honeypot field, and
 * server-side validation of every field.
 *
 * Consent is a hard, write-ahead gate: reject outright (400, nothing
 * persisted, nothing sent) unless the request carries
 * `consent.granted === true`, the checked checkbox on the visitor's own
 * form. There are no exceptions and no soft-fail. The exact consent
 * wording and version are stamped server-side from lib/start-conversation
 * /questions.ts rather than trusted from the request body, so the durable
 * evidence record can never diverge from what this build actually showed
 * the visitor.
 *
 * The Screen's own published rule -- never an automatic decline -- applies
 * to its maker: banding (the outcome rule) only ever changes which closing
 * screen renders. Both outcomes persist identically and both notify
 * Adriano.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from '@/lib/rate-limit';
import { sendEmail } from '@/lib/email';
import { validateSubmission, honeypotTripped } from '@/lib/start-conversation/validate';
import { CONSENT_LABEL, CONSENT_TEXT_VERSION } from '@/lib/start-conversation/questions';
import { buildBriefHtml, buildBriefSubject } from '@/lib/start-conversation/brief';

export const dynamic = 'force-dynamic';

const OPERATOR_EMAIL = 'adriano@caseloadselect.ca';

interface StartConversationResponseBody {
  ok: boolean;
  outcome?: 'booking' | 'reply';
  error?: string;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<StartConversationResponseBody>(
      { ok: false, error: 'invalid JSON body' },
      { status: 400 },
    );
  }

  // Honeypot: a form-filling script fills every field it finds, including
  // one no sighted or assistive-technology visitor ever sees. Respond as if
  // the submission succeeded (an arbitrary but plausible outcome) so a
  // scripted caller gets no signal it was caught, but persist nothing and
  // send nothing.
  if (honeypotTripped(body)) {
    return NextResponse.json<StartConversationResponseBody>({ ok: true, outcome: 'reply' });
  }

  const ip = ipFromRequest(req);
  const decision = await checkRateLimit('startConversation', ip);
  if (!decision.ok) {
    return NextResponse.json<StartConversationResponseBody>(
      { ok: false, error: 'rate limited, try again shortly' },
      { status: 429, headers: rateLimitHeaders(decision) },
    );
  }

  const validation = validateSubmission(body);
  if (!validation.valid) {
    return NextResponse.json<StartConversationResponseBody>(
      { ok: false, error: validation.error },
      { status: 400 },
    );
  }

  // Hard, write-ahead consent gate. No exceptions, no soft-fail: an
  // unchecked box (or a missing/malformed consent object) dies here with
  // nothing persisted and nothing sent, same invariant
  // /api/marketing-lead-intake enforces for lead-magnet consent.
  const consentGranted =
    typeof body === 'object' &&
    body !== null &&
    (body as { consent?: unknown }).consent !== undefined &&
    (body as { consent?: { granted?: unknown } }).consent?.granted === true;
  if (!consentGranted) {
    return NextResponse.json<StartConversationResponseBody>(
      { ok: false, error: 'Consent required' },
      { status: 400 },
    );
  }

  const { submission } = validation;
  const userAgent = req.headers.get('user-agent');

  const { data: rpcResult, error: rpcError } = await supabase.rpc(
    'insert_caseload_prospect_with_consent',
    {
      p_practice_area: submission.answers.practice_area,
      p_practice_area_other: submission.answers.practice_area_other,
      p_firm_size: submission.answers.firm_size,
      p_prompt_reason: submission.answers.prompt_reason,
      p_prompt_reason_other: submission.answers.prompt_reason_other,
      p_decision_role: submission.answers.decision_role,
      p_timeline: submission.answers.timeline,
      p_outcome: submission.outcome,
      p_name: submission.contact.name,
      p_firm_name: submission.contact.firm_name,
      p_email: submission.contact.email,
      p_province: submission.contact.province,
      p_consent_text_version: CONSENT_TEXT_VERSION,
      p_consent_label: CONSENT_LABEL,
      p_ip_address: ip,
      p_user_agent: userAgent,
    },
  );

  if (rpcError || !rpcResult || (rpcResult as { ok?: boolean }).ok !== true) {
    console.error('[start-conversation] persistence failed:', rpcError ?? rpcResult);
    return NextResponse.json<StartConversationResponseBody>(
      { ok: false, error: 'could not record your answers, try again' },
      { status: 500 },
    );
  }

  // The Resend brief is best-effort from here: the durable record already
  // exists (the RPC above is the hard gate), and a Resend outage must not
  // turn into a 500 the visitor sees after their answers are already safe.
  try {
    await sendEmail(OPERATOR_EMAIL, buildBriefSubject(submission), buildBriefHtml(submission));
  } catch (err) {
    console.error('[start-conversation] brief email failed (non-fatal):', err);
  }

  return NextResponse.json<StartConversationResponseBody>({ ok: true, outcome: submission.outcome });
}
