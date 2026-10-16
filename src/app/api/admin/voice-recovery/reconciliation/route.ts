import { NextRequest, NextResponse } from 'next/server';
import { requireOperator } from '@/lib/admin-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read-only operator reconciliation surface. It exposes ledger metadata and
 * receipt gaps, never the raw webhook payload. */
export async function GET(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const firmId = req.nextUrl.searchParams.get('firm_id')?.trim() ?? '';
  if (!UUID.test(firmId)) return NextResponse.json({ error: 'firm_id must be a UUID' }, { status: 400 });
  const { data: events, error } = await supabase.from('voice_call_events')
    .select('id, ghl_call_event_id, ghl_contact_id, event_id_source, payload_sha256, webhook_signature_mode, integration_mode, workflow_version, prompt_version, schema_version, received_at')
    .eq('firm_id', firmId).order('received_at', { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: `voice event lookup failed: ${error.message}` }, { status: 500 });
  const ids = (events ?? []).map((event) => event.id as string);
  const { data: receipts, error: receiptError } = ids.length
    ? await supabase.from('voice_call_event_receipts').select('voice_call_event_id, outcome, recovery_case_id, screened_lead_id, created_at').in('voice_call_event_id', ids)
    : { data: [], error: null };
  if (receiptError) return NextResponse.json({ error: `voice receipt lookup failed: ${receiptError.message}` }, { status: 500 });
  const { data: claims, error: claimError } = ids.length
    ? await supabase.from('voice_call_event_processing_claims').select('voice_call_event_id, status, lease_expires_at, attempt_count, last_failure').in('voice_call_event_id', ids)
    : { data: [], error: null };
  if (claimError) return NextResponse.json({ error: `voice processing claim lookup failed: ${claimError.message}` }, { status: 500 });
  const receiptByEvent = new Map((receipts ?? []).map((receipt) => [receipt.voice_call_event_id as string, receipt]));
  const claimByEvent = new Map((claims ?? []).map((claim) => [claim.voice_call_event_id as string, claim]));
  const now = Date.now();
  const reconciledEvents = (events ?? []).map((event) => {
    const claim = claimByEvent.get(event.id as string) as { status?: string; lease_expires_at?: string } | undefined;
    const receipt = receiptByEvent.get(event.id as string) ?? null;
    return {
      ...event,
      receipt,
      processing: claim ?? null,
      retry_eligible: !receipt && (!claim || claim.status === 'retryable'
        || (!!claim.lease_expires_at && new Date(claim.lease_expires_at).getTime() <= now)),
    };
  });
  return NextResponse.json({
    events: reconciledEvents,
    unreconciled_count: (events ?? []).filter((event) => !receiptByEvent.has(event.id as string)).length,
    retry_eligible_count: reconciledEvents.filter((event) => event.retry_eligible).length,
  });
}
