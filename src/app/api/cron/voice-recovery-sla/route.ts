/**
 * GET /api/cron/voice-recovery-sla
 *
 * Pre-production-safe acknowledgement-SLA escalator. It is deliberately NOT
 * registered in vercel.json: an operator must both schedule/call it and set
 * VOICE_RECOVERY_SLA_ESCALATION_ENABLED=true in that environment. This keeps
 * the recovery build observable without creating an unapproved production
 * notification job.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { notifyOperatorOfVoiceRecoverySla } from '@/lib/voice-callback-notify';
import { isVoiceRecoverySlaEscalationDue } from '@/lib/voice-recovery-sla';

const BATCH_LIMIT = 50;

interface RecoveryRow {
  id: string;
  firm_id: string;
  caller_name: string | null;
  disposition: string;
  urgency: string;
  status: string;
  sla_due_at: string | null;
  acknowledged_at: string | null;
  acknowledgement_sla_escalated_at: string | null;
  acknowledgement_sla_escalation_attempts: number | null;
}

function recoveryQueueUrl(firmId: string): string {
  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  const origin = domain
    ? `https://app.${domain}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
  return `${origin}/portal/${encodeURIComponent(firmId)}/triage?view=recovery`;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (process.env.VOICE_RECOVERY_SLA_ESCALATION_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, enabled: false, escalated: 0, message: 'Voice recovery SLA escalation is disabled outside an explicitly enabled pre-production environment.' });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const { data, error } = await supabase
    .from('voice_recovery_cases')
    .select('id, firm_id, caller_name, disposition, urgency, status, sla_due_at, acknowledged_at, acknowledgement_sla_escalated_at, acknowledgement_sla_escalation_attempts')
    .eq('status', 'open')
    .is('acknowledged_at', null)
    .is('acknowledgement_sla_escalated_at', null)
    .lte('sla_due_at', nowIso)
    .order('sla_due_at', { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) return NextResponse.json({ error: `voice recovery SLA lookup failed: ${error.message}` }, { status: 500 });

  const outcomes: Array<{ id: string; outcome: 'sent' | 'skipped' | 'failed'; error?: string }> = [];
  for (const row of (data ?? []) as RecoveryRow[]) {
    if (!isVoiceRecoverySlaEscalationDue(row, now)) {
      outcomes.push({ id: row.id, outcome: 'skipped' });
      continue;
    }
    const { data: firm, error: firmError } = await supabase
      .from('intake_firms').select('name').eq('id', row.firm_id).maybeSingle();
    if (firmError || !firm) {
      outcomes.push({ id: row.id, outcome: 'failed', error: firmError?.message ?? 'firm not found' });
      continue;
    }
    try {
      const dispatch = await notifyOperatorOfVoiceRecoverySla({
        caseId: row.id,
        firmId: row.firm_id,
        firmName: firm.name ?? null,
        callerName: row.caller_name,
        disposition: row.disposition,
        urgency: row.urgency,
        slaDueAt: row.sla_due_at!,
        triageUrl: recoveryQueueUrl(row.firm_id),
      });
      if (dispatch.email === 'skipped') {
        outcomes.push({ id: row.id, outcome: 'skipped' });
        continue;
      }
      // Guard all volatile state: an acknowledgement racing this sweep wins,
      // and the harmless Resend idempotency key protects a crash-after-send.
      const { error: stampError } = await supabase
        .from('voice_recovery_cases')
        .update({
          acknowledgement_sla_escalated_at: nowIso,
          acknowledgement_sla_escalation_attempts: (row.acknowledgement_sla_escalation_attempts ?? 0) + 1,
          acknowledgement_sla_escalation_error: null,
          alert_status: 'sent',
          alert_sent_at: nowIso,
        })
        .eq('id', row.id)
        .eq('status', 'open')
        .is('acknowledged_at', null)
        .is('acknowledgement_sla_escalated_at', null);
      outcomes.push(stampError ? { id: row.id, outcome: 'failed', error: stampError.message } : { id: row.id, outcome: 'sent' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase
        .from('voice_recovery_cases')
        .update({
          acknowledgement_sla_escalation_attempts: (row.acknowledgement_sla_escalation_attempts ?? 0) + 1,
          acknowledgement_sla_escalation_error: message.slice(0, 500),
          alert_status: 'failed',
        })
        .eq('id', row.id)
        .eq('status', 'open')
        .is('acknowledged_at', null)
        .is('acknowledgement_sla_escalated_at', null);
      outcomes.push({ id: row.id, outcome: 'failed', error: message });
    }
  }
  return NextResponse.json({
    ok: true,
    enabled: true,
    swept: outcomes.length,
    escalated: outcomes.filter((outcome) => outcome.outcome === 'sent').length,
    outcomes,
  });
}
