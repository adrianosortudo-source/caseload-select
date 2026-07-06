/**
 * I/O wrapper for consent_log writes. Best-effort: a logging failure never
 * blocks the caller's primary write path (matches the logPromotionEvent
 * pattern in matter-promotion.ts). Pure row-building lives in
 * consent-log-pure.ts.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { buildIntakeConsentLogRow, type IntakeConsentLogInput } from '@/lib/consent-log-pure';

/**
 * Writes the append-only consent_log row for an intake's email consent
 * capture. Never throws; a failure is logged to console and swallowed so the
 * intake persist path is never blocked by this audit trail. Returns whether
 * the write succeeded so a caller that wants to know (e.g. the repair sweep
 * in consent-log-repair.ts, or a future retry path) can check without this
 * function ever needing to throw or block.
 */
export async function logIntakeConsent(input: IntakeConsentLogInput): Promise<boolean> {
  try {
    const row = buildIntakeConsentLogRow(input);
    const { error } = await supabase.from('consent_log').insert(row);
    if (error) {
      console.error('[consent-log] logIntakeConsent write failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[consent-log] logIntakeConsent unexpected error:', err);
    return false;
  }
}
