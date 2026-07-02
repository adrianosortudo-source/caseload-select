/**
 * PATCH /api/portal/[firmId]/conflict-checks/[checkId]
 *
 * Disposition a conflict check: clear, waive, or block.
 * Body: { disposition: 'cleared' | 'waived' | 'blocked', notes?: string }
 *
 * A 'waived' disposition requires a non-empty `notes` (the stated basis for
 * the waiver) and creates an append-only consent_log row with
 * consent_type='conflict_waiver' before the check itself is updated; the
 * new row's id becomes waiver_consent_id. This closes the dead end where a
 * lawyer could pick "Waived" and nothing ever populated waiver_consent_id,
 * permanently blocking the stage-advance gate (matter-stage-gate.ts) that
 * requires it. If the consent_log insert fails, the disposition is not
 * applied -- a waived check with no linked consent record is never written.
 *
 * Auth: portal session (lawyer or operator) scoped to firmId.
 * Returns the updated check row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

const VALID_DISPOSITIONS = ['cleared', 'waived', 'blocked'] as const;
type Disposition = (typeof VALID_DISPOSITIONS)[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; checkId: string }> },
) {
  const { firmId, checkId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  let body: { disposition?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { disposition, notes } = body;
  if (!disposition || !VALID_DISPOSITIONS.includes(disposition as Disposition)) {
    return NextResponse.json(
      { error: `disposition must be one of ${VALID_DISPOSITIONS.join(', ')}` },
      { status: 400 },
    );
  }

  const trimmedNotes = notes?.trim() || null;
  if (disposition === 'waived' && !trimmedNotes) {
    return NextResponse.json(
      { error: 'notes is required when waiving a conflict check (the stated basis for the waiver)' },
      { status: 400 },
    );
  }

  // Verify check belongs to this firm and exists
  const { data: existing } = await supabase
    .from('screened_conflict_checks')
    .select('id, firm_id, screened_lead_id, check_status')
    .eq('id', checkId)
    .eq('firm_id', firmId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'conflict check not found' }, { status: 404 });
  }

  if (['cleared', 'waived', 'blocked'].includes(existing.check_status)) {
    return NextResponse.json(
      { error: `check is already dispositioned as '${existing.check_status}'` },
      { status: 409 },
    );
  }

  const actor =
    session.role === 'operator' ? 'operator' : (session.lawyer_id ?? 'lawyer');
  const now = new Date().toISOString();

  let waiverConsentId: string | null = null;
  if (disposition === 'waived') {
    const { data: consent, error: consentErr } = await supabase
      .from('consent_log')
      .insert({
        firm_id: firmId,
        subject_id: existing.screened_lead_id,
        // consent_log.channel is a NOT NULL comms-channel column; a conflict
        // waiver is not a communications event, so this is a required but
        // otherwise inert placeholder. The record's substance lives in
        // consent_type / purpose / note.
        channel: 'email',
        event_type: 'consent_granted',
        consent_type: 'conflict_waiver',
        consent_status: 'granted',
        purpose: 'Conflict of interest waiver',
        basis_source: 'portal_conflict_waiver',
        note: trimmedNotes,
        obtained_at: now,
        expires_at: null,
        created_by: actor,
      })
      .select('id')
      .single();

    if (consentErr || !consent) {
      return NextResponse.json(
        { error: `failed to record waiver consent: ${consentErr?.message ?? 'unknown error'}` },
        { status: 500 },
      );
    }
    waiverConsentId = consent.id as string;
  }

  const { data: updated, error } = await supabase
    .from('screened_conflict_checks')
    .update({
      check_status: disposition as Disposition,
      disposition: disposition as Disposition,
      dispositioned_by: actor,
      dispositioned_at: now,
      notes: trimmedNotes,
      ...(waiverConsentId ? { waiver_consent_id: waiverConsentId } : {}),
      updated_at: now,
    })
    .eq('id', checkId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ check: updated });
}
