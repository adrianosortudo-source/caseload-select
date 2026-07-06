/**
 * Repair sweep for the consent_log audit trail (H5/DR-075 follow-up).
 *
 * logIntakeConsent() in consent-log.ts is intentionally best-effort: a
 * consent_log insert failure never blocks the primary intake persist path.
 * That correctness leaves a gap: a transient failure loses the append-only
 * evidentiary record forever, even though screened_leads.email_consent_status
 * still reads 'explicit' or 'implied'. This module finds those gaps and
 * reconstructs the missing consent_log row from data already persisted on
 * screened_leads at intake time (no guessing, no synthetic timestamps).
 *
 * Reconstructed rows are labeled with basis_source='backfill_repair', a
 * value distinct from every other basis_source this codebase writes
 * ('widget_optin', 'screen_inquiry', etc.), so a repaired row is never
 * mistaken for a contemporaneous capture.
 *
 * Runs oldest-first (created_at ascending) so repeated ticks make steady
 * progress against the oldest gaps first.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { INTAKE_CONSENT_PURPOSE } from '@/lib/consent-log-pure';

const DEFAULT_LIMIT = 500;

/**
 * Row shape for a reconstructed consent_log insert. Deliberately not the
 * shared ConsentLogInsertRow from consent-log-pure.ts: that type's
 * basis_source is narrowed to the two values the live intake write path
 * uses ('widget_optin' | 'screen_inquiry'). basis_source has no DB CHECK
 * constraint (confirmed against the consent_log migration); it is free text
 * with a documented conventional set of values, so 'backfill_repair' is a
 * safe, honestly-labeled addition that only needs its own type here.
 */
interface ConsentLogRepairInsertRow {
  firm_id: string;
  subject_id: string;
  channel: 'email';
  event_type: 'consent_granted' | 'implied_set';
  consent_type: 'express' | 'implied_inquiry';
  consent_status: 'granted';
  purpose: string;
  basis_source: 'backfill_repair';
  ip_address: string | null;
  user_agent: string | null;
  obtained_at: string;
  expires_at: string | null;
  created_by: 'system';
  captured_at: string;
  note: string;
}

export interface ConsentLogRepairSummary {
  scanned: number;
  missing: number;
  repaired: number;
  failed: number;
  errors: string[];
}

interface CandidateLeadRow {
  id: string;
  firm_id: string;
  email_consent_status: string | null;
  email_consent_captured_at: string | null;
  six_month_expiry_date: string | null;
  consent_ip: string | null;
  consent_user_agent: string | null;
  submitted_at: string | null;
}

/**
 * Scans screened_leads for rows whose email consent state is 'explicit' or
 * 'implied' but which have no corresponding consent_log row, and inserts a
 * reconstructed row for each gap found. Never throws; per-lead failures are
 * counted and recorded in the returned errors array so the sweep can
 * continue to the next lead.
 */
export async function runConsentLogRepairSweep(
  opts: { limit?: number } = {},
): Promise<ConsentLogRepairSummary> {
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const summary: ConsentLogRepairSummary = {
    scanned: 0,
    missing: 0,
    repaired: 0,
    failed: 0,
    errors: [],
  };

  const { data: leads, error: leadsError } = await supabase
    .from('screened_leads')
    .select(
      'id, firm_id, email_consent_status, email_consent_captured_at, six_month_expiry_date, consent_ip, consent_user_agent, submitted_at',
    )
    .in('email_consent_status', ['explicit', 'implied'])
    .order('created_at', { ascending: true })
    .limit(limit);

  if (leadsError) {
    summary.errors.push(`load screened_leads failed: ${leadsError.message}`);
    return summary;
  }

  const rows = (leads ?? []) as CandidateLeadRow[];
  summary.scanned = rows.length;

  for (const lead of rows) {
    try {
      const { count, error: existsError } = await supabase
        .from('consent_log')
        .select('id', { count: 'exact', head: true })
        .eq('subject_id', lead.id)
        .eq('channel', 'email');

      if (existsError) {
        summary.failed += 1;
        const msg = `check existing consent_log failed for lead ${lead.id}: ${existsError.message}`;
        console.error('[consent-log-repair]', lead.id, existsError.message);
        summary.errors.push(msg);
        continue;
      }

      if ((count ?? 0) > 0) {
        // Evidence already exists for this lead; nothing to repair.
        continue;
      }

      summary.missing += 1;

      const explicit = lead.email_consent_status === 'explicit';
      const obtainedAt = lead.email_consent_captured_at ?? lead.submitted_at;

      const row: ConsentLogRepairInsertRow = {
        firm_id: lead.firm_id,
        subject_id: lead.id,
        channel: 'email',
        event_type: explicit ? 'consent_granted' : 'implied_set',
        consent_type: explicit ? 'express' : 'implied_inquiry',
        consent_status: 'granted',
        purpose: INTAKE_CONSENT_PURPOSE,
        basis_source: 'backfill_repair',
        ip_address: lead.consent_ip,
        user_agent: lead.consent_user_agent,
        obtained_at: obtainedAt as string,
        expires_at: explicit ? null : lead.six_month_expiry_date,
        created_by: 'system',
        captured_at: obtainedAt as string,
        note:
          'This row was reconstructed by the automated consent-log repair sweep because the original write appears to have failed at intake time.',
      };

      const { error: insertError } = await supabase.from('consent_log').insert(row);

      if (insertError) {
        summary.failed += 1;
        const msg = `insert failed for lead ${lead.id}: ${insertError.message}`;
        console.error('[consent-log-repair]', lead.id, insertError.message);
        summary.errors.push(msg);
        continue;
      }

      summary.repaired += 1;
    } catch (err) {
      summary.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[consent-log-repair]', lead.id, message);
      summary.errors.push(`unexpected error for lead ${lead.id}: ${message}`);
    }
  }

  return summary;
}
