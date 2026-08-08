/**
 * POST /api/marketing-lead-intake
 *
 * Persistence endpoint for MARKETING lead-magnet leads originating from a
 * firm website (checklist downloads today; other non-matter tools later).
 * Deliberately NOT a variant of /api/tool-intake: a checklist downloader
 * is a marketing lead, not a screened matter, so this route never touches
 * `screened_leads`. No CPI score, no band, no decision deadline, no
 * lawyer Take/Pass. It writes consent evidence to
 * `marketing_lead_consent_log` and upserts a tagged contact into the
 * firm's own GHL sub-account, where the firm's GHL workflows (welcome
 * email, later newsletter enrollment) pick it up.
 *
 * Auth: Bearer token (TOOL_INTAKE_SECRET, the same shared secret
 * /api/tool-intake already uses for this exact trust boundary -- the firm
 * website's server calling this app's server). Server-to-server only.
 *
 * Consent is a hard, write-ahead gate, same invariant the checklist
 * rebuild has held since 2026-07-13: reject outright (400, nothing
 * persisted, nothing called) unless the visitor's own request carries
 * `consent.granted === true`, the checked checkbox on the caller's form,
 * never an assumption derived from the submission itself. Once past that
 * gate, the consent row is inserted into `marketing_lead_consent_log`
 * BEFORE the GHL call is attempted, and that insert is NOT best-effort --
 * without a durable consent record there is no evidence consent was ever
 * captured, so a failure there is a genuine 500. The GHL contact
 * upsert, its custom-field enrichment, and its tagging are all
 * best-effort AFTER that: the caller (checklist-magnet) already renders
 * the checklist on the thanks page regardless, so a downstream GHL outage
 * must not be treated as a hard failure. Every GHL step outcome is
 * reported in the response so a capture that could not reach GHL is
 * still recoverable (`marketing_lead_consent_log.ghl_contact_id` stays
 * null and the row itself is the audit trail).
 *
 * Required env vars:
 *   - TOOL_INTAKE_SECRET   (shared with /api/tool-intake's auth)
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { constantTimeEquals } from '@/lib/cron-auth';
import { upsertGhlContact, setGhlContactCustomFields, addGhlTags } from '@/lib/ghl-contacts-write-api';

function isMarketingLeadIntakeAuthorized(req: NextRequest): boolean {
  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return false;
  const presented = header.slice('Bearer '.length).trim();
  if (!presented) return false;

  const secret = process.env.TOOL_INTAKE_SECRET;
  if (!secret) return false;

  return constantTimeEquals(presented, secret);
}

interface MarketingLeadIntakeBody {
  source: string;
  asset?: string | null;
  locale?: string | null;
  contact: {
    name?: string | null;
    email: string;
  };
  consent: {
    granted: boolean;
    textVersion: string;
    capturedAtIso: string;
    ip?: string | null;
    userAgent?: string | null;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildTags(source: string, asset: string | null, locale: string): string[] {
  return ['lead-magnet', `source:${source}`, asset ? `asset:${asset}` : null, `locale:${locale}`].filter(
    (t): t is string => !!t,
  );
}

export async function POST(req: NextRequest) {
  if (!isMarketingLeadIntakeAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: MarketingLeadIntakeBody;
  try {
    body = (await req.json()) as MarketingLeadIntakeBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body?.source) {
    return NextResponse.json({ ok: false, error: 'Missing source' }, { status: 400 });
  }
  if (!body.contact?.email || !body.contact.email.includes('@')) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid contact email' }, { status: 400 });
  }
  // Affirmative consent is a hard prerequisite. No consent, nothing
  // persisted, nothing called -- same gate checklist-magnet already
  // enforces on its own side; this route enforces it again independently
  // rather than trusting the caller checked it.
  if (body.consent?.granted !== true) {
    return NextResponse.json({ ok: false, error: 'Consent required' }, { status: 400 });
  }
  if (!body.consent.textVersion || !body.consent.capturedAtIso) {
    return NextResponse.json({ ok: false, error: 'Missing consent evidence fields' }, { status: 400 });
  }

  const url = new URL(req.url);
  const firmIdParam = (url.searchParams.get('firmId') ?? '').trim();
  if (!firmIdParam || !UUID_RE.test(firmIdParam)) {
    return NextResponse.json({ ok: false, error: 'missing or invalid firmId' }, { status: 400 });
  }

  const { data: firm, error: firmErr } = await supabase
    .from('intake_firms')
    .select('id, ghl_location_id, ghl_contacts_write_token')
    .eq('id', firmIdParam)
    .maybeSingle();

  if (firmErr) {
    return NextResponse.json({ ok: false, error: `firm lookup failed: ${firmErr.message}` }, { status: 500 });
  }
  if (!firm) {
    return NextResponse.json({ ok: false, error: 'firm not found' }, { status: 404 });
  }

  const locale = body.locale === 'pt' ? 'pt' : 'en';
  const asset = body.asset ?? null;
  const tags = buildTags(body.source, asset, locale);

  // Write-ahead insert. NOT best-effort: this is the one durable record
  // that consent was captured, and it must exist before the GHL call is
  // attempted, so it survives a GHL outage intact.
  const { data: consentRow, error: consentErr } = await supabase
    .from('marketing_lead_consent_log')
    .insert({
      firm_id: firmIdParam,
      email: body.contact.email,
      source: body.source,
      asset,
      locale,
      consent_text_version: body.consent.textVersion,
      basis_evidence: {
        textVersion: body.consent.textVersion,
        capturedAtIso: body.consent.capturedAtIso,
        asset,
        locale,
        source: body.source,
        ip: body.consent.ip ?? null,
        userAgent: body.consent.userAgent ?? null,
      },
      ip_address: body.consent.ip ?? null,
      user_agent: body.consent.userAgent ?? null,
      captured_at: body.consent.capturedAtIso,
    })
    .select('id')
    .single();

  if (consentErr || !consentRow) {
    console.error('[marketing-lead-intake] consent log insert failed:', consentErr);
    return NextResponse.json(
      { ok: false, error: `consent log insert failed: ${consentErr?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  // Everything below is best-effort. The consent record above already
  // exists regardless of what happens here.
  if (!firm.ghl_location_id || !firm.ghl_contacts_write_token) {
    console.error(`[marketing-lead-intake] firm ${firmIdParam} has no GHL contacts-write config`);
    return NextResponse.json({
      ok: true,
      consent_logged: true,
      ghl_captured: false,
      reason: 'ghl_not_configured',
    });
  }

  const upsertResult = await upsertGhlContact(firm.ghl_location_id, firm.ghl_contacts_write_token, {
    email: body.contact.email,
    firstName: body.contact.name ?? null,
    source: body.source,
  });

  if (!upsertResult.ok) {
    console.error('[marketing-lead-intake] GHL contact upsert failed:', upsertResult);
    return NextResponse.json({
      ok: true,
      consent_logged: true,
      ghl_captured: false,
      reason: upsertResult.reason,
    });
  }

  const { contactId } = upsertResult;
  const token = firm.ghl_contacts_write_token;

  // Enrichment and tagging are both isolated, best-effort follow-ups: the
  // contact already exists at this point regardless of whether either
  // succeeds. See ghl-contacts-write-api.ts module header for why tags
  // and custom fields are never sent through the upsert call itself.
  const [customFieldsResult, tagsResult] = await Promise.all([
    setGhlContactCustomFields(contactId, token, [
      { key: 'consent_text_version', field_value: body.consent.textVersion },
      { key: 'consent_captured_at', field_value: body.consent.capturedAtIso },
    ]),
    addGhlTags(contactId, token, tags),
  ]);
  if (!customFieldsResult.ok) {
    console.error('[marketing-lead-intake] GHL custom-field enrichment failed (non-fatal):', customFieldsResult);
  }
  if (!tagsResult.ok) {
    console.error('[marketing-lead-intake] GHL tagging failed (non-fatal):', tagsResult);
  }

  // The one legal mutation on marketing_lead_consent_log: backfilling
  // ghl_contact_id from null. Best-effort -- the consent row and the GHL
  // contact both already exist even if this particular UPDATE fails.
  const { error: backfillErr } = await supabase
    .from('marketing_lead_consent_log')
    .update({ ghl_contact_id: contactId })
    .eq('id', consentRow.id);
  if (backfillErr) {
    console.error('[marketing-lead-intake] ghl_contact_id backfill failed (non-fatal):', backfillErr);
  }

  return NextResponse.json({
    ok: true,
    consent_logged: true,
    ghl_captured: true,
    contact_id: contactId,
    ghl_contact_is_new: upsertResult.isNew,
  });
}
