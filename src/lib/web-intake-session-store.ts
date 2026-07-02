/**
 * Web intake session store: checkpoint / finalize for the web widget's
 * drop-off tracking (qualification audit F2/F6/item 5, 2026-07-02).
 *
 * Distinct from channel-intake-session-store.ts (the Meta-channel
 * multi-turn store): the web widget runs the engine client-side and never
 * needs to RESUME state across separate HTTP requests the way an async
 * WhatsApp webhook does. The only job here is a best-effort checkpoint so
 * an abandoned session leaves a trace, plus a matching finalize call when
 * the widget's real submission succeeds.
 *
 * Service-role only.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { EngineState } from '@/lib/screen-engine/types';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface WebAttributionFields {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  referrer: string | null;
}

export interface WebSessionRow extends WebAttributionFields {
  id: string;
  firm_id: string;
  lead_id: string;
  engine_state: EngineState;
  finalized: boolean;
  screened_lead_id: string | null;
  expires_at: string;
  created_at: string;
}

export interface CheckpointArgs extends Partial<WebAttributionFields> {
  firmId: string;
  leadId: string;
  engineState: EngineState;
}

export interface CheckpointResult {
  ok: boolean;
  skipped?: 'already_finalized';
  error?: string;
}

/**
 * Upsert the open session for (firmId, leadId). Read-then-write rather
 * than a DB-level upsert so a late checkpoint arriving after finalization
 * (a tab that kept firing after a successful submit) is a harmless no-op
 * instead of resurrecting a closed row.
 */
export async function checkpointWebSession(args: CheckpointArgs): Promise<CheckpointResult> {
  const { data: existing, error: readErr } = await supabase
    .from('web_intake_sessions')
    .select('id, finalized')
    .eq('firm_id', args.firmId)
    .eq('lead_id', args.leadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readErr) return { ok: false, error: readErr.message };

  if (existing?.finalized) {
    return { ok: true, skipped: 'already_finalized' };
  }

  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  if (existing) {
    const { error: updateErr } = await supabase
      .from('web_intake_sessions')
      .update({
        engine_state: args.engineState,
        last_activity_at: nowIso,
        expires_at: expiresAtIso,
        updated_at: nowIso,
        utm_source: args.utm_source ?? null,
        utm_medium: args.utm_medium ?? null,
        utm_campaign: args.utm_campaign ?? null,
        utm_term: args.utm_term ?? null,
        utm_content: args.utm_content ?? null,
        referrer: args.referrer ?? null,
      })
      .eq('id', existing.id);
    if (updateErr) return { ok: false, error: updateErr.message };
    return { ok: true };
  }

  const { error: insertErr } = await supabase.from('web_intake_sessions').insert({
    firm_id: args.firmId,
    lead_id: args.leadId,
    engine_state: args.engineState,
    utm_source: args.utm_source ?? null,
    utm_medium: args.utm_medium ?? null,
    utm_campaign: args.utm_campaign ?? null,
    utm_term: args.utm_term ?? null,
    utm_content: args.utm_content ?? null,
    referrer: args.referrer ?? null,
  });
  if (insertErr) return { ok: false, error: insertErr.message };
  return { ok: true };
}

/**
 * Mark the open session for (firmId, leadId) finalized after a successful
 * /api/intake-v2 submission. Best-effort: called from a try/catch that
 * never blocks or fails the intake response. No-op when no open session
 * exists (checkpoint may never have fired, e.g. a one-turn submission
 * faster than the debounce, or the widget's demo mode).
 */
export async function finalizeWebSessionOnSubmit(
  firmId: string,
  leadId: string,
  screenedLeadId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('web_intake_sessions')
    .update({
      finalized: true,
      screened_lead_id: screenedLeadId,
      last_activity_at: new Date().toISOString(),
    })
    .eq('firm_id', firmId)
    .eq('lead_id', leadId)
    .eq('finalized', false);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
