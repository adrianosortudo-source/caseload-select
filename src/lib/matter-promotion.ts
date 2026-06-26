/**
 * Observability helpers for the take-to-matter promotion path.
 *
 * Records promotion events to matter_promotion_events so silently failed
 * matter creates are recoverable from the DB rather than relying on
 * Vercel log access.
 *
 * All writes are best-effort: a logging failure is console.warn'd and
 * never propagates to the caller. The take route must not fail because
 * a metrics write failed.
 *
 * WIRED: logPromotionEvent is called from take/route.ts at 4 points:
 *   take_recorded (all bands), matter_created, matter_failed, matter_skipped (Band A).
 * Migration applied 2026-06-26: supabase/migrations/20260626_matter_promotion_events.sql
 *
 * DR reference: H3 (Codex audit v2, take-to-matter atomicity).
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

export type PromotionEventType =
  | 'take_recorded'     // written before the take response (always)
  | 'matter_created'    // written after createMatterFromBandATake succeeds
  | 'matter_skipped'    // written when pre-check fails (no contact info)
  | 'matter_failed';    // written when createMatterFromBandATake returns ok:false

export interface PromotionEventInput {
  screened_lead_id: string;
  firm_id: string;
  lawyer_id: string;
  event_type: PromotionEventType;
  matter_id?: string;
  error_text?: string;
}

/**
 * Appends a matter_promotion_events row. Never throws.
 * Returns the inserted row id on success, null on failure.
 */
export async function logPromotionEvent(input: PromotionEventInput): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('matter_promotion_events')
      .insert({
        screened_lead_id: input.screened_lead_id,
        firm_id: input.firm_id,
        lawyer_id: input.lawyer_id,
        event_type: input.event_type,
        matter_id: input.matter_id ?? null,
        error_text: input.error_text ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.warn('[matter-promotion] logPromotionEvent write failed:', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.warn('[matter-promotion] logPromotionEvent unexpected error:', err);
    return null;
  }
}
