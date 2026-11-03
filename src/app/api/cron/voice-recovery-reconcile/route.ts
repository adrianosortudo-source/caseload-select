/** Preproduction-only reconciliation report. It intentionally writes nothing:
 * operators decide how an accepted-but-unreceipted call should be replayed. */
import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

const LIMIT = 100;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (process.env.VOICE_RECOVERY_RECONCILIATION_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, enabled: false, unreconciled: [], message: 'Voice reconciliation is disabled outside an explicitly enabled pre-production environment.' });
  }
  const { data: events, error } = await supabase.from('voice_call_events')
    .select('id, firm_id, ghl_call_event_id, ghl_contact_id, payload_sha256, received_at, integration_mode')
    .order('received_at', { ascending: true }).limit(LIMIT);
  if (error) return NextResponse.json({ error: `voice event ledger lookup failed: ${error.message}` }, { status: 500 });
  const eventIds = (events ?? []).map((event) => event.id as string);
  if (eventIds.length === 0) return NextResponse.json({ ok: true, enabled: true, scanned: 0, unreconciled: [] });
  const { data: receipts, error: receiptError } = await supabase.from('voice_call_event_receipts')
    .select('voice_call_event_id').in('voice_call_event_id', eventIds);
  if (receiptError) return NextResponse.json({ error: `voice event receipt lookup failed: ${receiptError.message}` }, { status: 500 });
  const { data: claims, error: claimError } = await supabase.from('voice_call_event_processing_claims')
    .select('voice_call_event_id, status, lease_expires_at, attempt_count, last_failure').in('voice_call_event_id', eventIds);
  if (claimError) return NextResponse.json({ error: `voice event claim lookup failed: ${claimError.message}` }, { status: 500 });
  const receipted = new Set((receipts ?? []).map((receipt) => receipt.voice_call_event_id as string));
  const claimByEvent = new Map((claims ?? []).map((claim) => [claim.voice_call_event_id as string, claim]));
  const now = Date.now();
  const unreconciled = (events ?? [])
    .filter((event) => !receipted.has(event.id as string))
    .map((event) => {
      const claim = claimByEvent.get(event.id as string) as { status?: string; lease_expires_at?: string; attempt_count?: number; last_failure?: string | null } | undefined;
      const retryEligible = !claim || claim.status === 'retryable'
        || (!!claim.lease_expires_at && new Date(claim.lease_expires_at).getTime() <= now);
      return { ...event, processing: claim ?? null, retry_eligible: retryEligible };
    });
  return NextResponse.json({ ok: true, enabled: true, scanned: events?.length ?? 0, unreconciled });
}
