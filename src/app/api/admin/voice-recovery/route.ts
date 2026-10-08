import { NextRequest, NextResponse } from 'next/server';
import { requireOperator } from '@/lib/admin-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

const FIRM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CASE_FIELDS = 'id, firm_id, ghl_call_event_id, ghl_contact_id, disposition, recovery_reason, status, urgency, owner_name, sla_due_at, acknowledged_at, acknowledged_by, acknowledgement_sla_escalated_at, acknowledgement_sla_escalation_attempts, acknowledgement_sla_escalation_error, caller_name, name_source, observed_caller_id, spoken_callback_number, callback_number_verified, sms_consent, whatsapp_consent, messaging_consent_provenance, messaging_consent_at, message_excerpt, raw_transcript, transcript_source, recording_url, evidence, alert_status, alert_sent_at, delivery_state, follow_up_state, follow_up_count, last_follow_up_at, last_follow_up_summary, promoted_screened_lead_id, created_at, updated_at';

/** Operator recovery queue. UI contract: `{ cases, counts }`, never a
 * callback-table-specific payload. */
export async function GET(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;

  const firmId = req.nextUrl.searchParams.get('firm_id')?.trim() ?? '';
  if (!FIRM_ID_RE.test(firmId)) {
    return NextResponse.json({ error: 'firm_id must be a UUID' }, { status: 400 });
  }
  const status = req.nextUrl.searchParams.get('status');
  if (status && !['open', 'acknowledged', 'resolved'].includes(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }
  const requestedLimit = Number(req.nextUrl.searchParams.get('limit') ?? '100');
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 100;

  let query = supabase
    .from('voice_recovery_cases')
    .select(CASE_FIELDS)
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) query = query.eq('status', status);
  const { data: cases, error } = await query;
  if (error) return NextResponse.json({ error: `recovery cases lookup failed: ${error.message}` }, { status: 500 });

  const { data: countRows, error: countError } = await supabase
    .from('voice_recovery_cases')
    .select('status, follow_up_state, promoted_screened_lead_id')
    .eq('firm_id', firmId);
  if (countError) return NextResponse.json({ error: `recovery counts lookup failed: ${countError.message}` }, { status: 500 });
  const counts = { open: 0, acknowledged: 0, resolved: 0, new: 0, follow_up: 0, promoted: 0, total: countRows?.length ?? 0 };
  for (const row of countRows ?? []) {
    if (row.status === 'open') counts.open++;
    // UI status buckets are deliberately mutually exclusive. A promotion is
    // also resolved at the storage layer, but must appear only as Promoted.
    if (row.promoted_screened_lead_id) counts.promoted++;
    else if (row.status === 'resolved') counts.resolved++;
    else if (row.follow_up_state === 'scheduled' || row.follow_up_state === 'attempted' || row.follow_up_state === 'completed') counts.follow_up++;
    else if (row.status === 'acknowledged') counts.acknowledged++;
    else counts.new++;
  }
  const shapedCases = (cases ?? []).map((row) => ({
    ...row,
    caller_name_provenance: row.name_source ?? 'unknown',
    // Compatibility aliases for the operator surface. The canonical columns
    // remain explicit above so no consent or callback provenance is lost.
    owner: row.owner_name ?? null,
    caller_id_phone: row.observed_caller_id ?? null,
    callback_phone_spoken: row.spoken_callback_number ?? null,
    messaging_consent: row.sms_consent ?? row.whatsapp_consent ?? null,
    transcript: row.raw_transcript ?? null,
    alert_state: row.alert_status ?? null,
    follow_up_note: row.last_follow_up_summary ?? null,
  }));
  return NextResponse.json({ cases: shapedCases, counts });
}
