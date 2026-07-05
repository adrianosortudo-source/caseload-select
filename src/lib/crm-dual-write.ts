/**
 * Canonical-model dual-write helpers (M1: parties + activities).
 *
 * crm-dual-read.ts already reads these tables first, falling back to derived
 * data (matter_promotion_events, matter_stage_events, matter_messages) when
 * they are empty. This module is the write side that starts populating them
 * for real, going forward, from the moment a matter is created.
 *
 * All writes are best-effort: a failure here never blocks the primary write
 * path it accompanies (matches the logPromotionEvent / matter_stage_events
 * AUDIT GAP pattern already used in matter-stage.ts). Historical rows made
 * before this shipped are NOT backfilled by this module; that is a separate,
 * explicit one-shot script (scripts/backfill-m1-parties-activities.ts).
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

export type PartyRole = 'client' | 'adverse' | 'third_party' | 'unknown' | 'prospect' | 'referrer' | 'lawyer' | 'related';
export type ActivityType = 'intake' | 'stage_change' | 'message' | 'conflict_check' | 'promotion';
export type ActivityActorRole = 'admin' | 'staff' | 'operator' | 'system' | 'lawyer' | 'client';

/**
 * Writes the primary party row for a newly created matter. Idempotent via
 * the DB's uq_parties_primary_per_matter partial unique index: a second call
 * for the same matter conflicts and is ignored rather than erroring loudly.
 */
export async function writePrimaryParty(input: {
  matterId: string;
  firmId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  partyRole?: PartyRole;
}): Promise<void> {
  try {
    const { error } = await supabase.from('parties').insert({
      matter_id: input.matterId,
      firm_id: input.firmId,
      full_name: input.fullName,
      email: input.email,
      phone: input.phone,
      party_role: input.partyRole ?? 'client',
      is_primary: true,
    });
    // 23505 = unique_violation: a primary party already exists for this
    // matter (re-run, race). Not an error worth logging.
    if (error && error.code !== '23505') {
      console.warn('[crm-dual-write] writePrimaryParty failed:', error.message);
    }
  } catch (err) {
    console.warn('[crm-dual-write] writePrimaryParty unexpected error:', err);
  }
}

/**
 * Appends one row to the canonical activities timeline for a matter.
 */
export async function writeActivity(input: {
  matterId: string;
  firmId: string;
  activityType: ActivityType;
  title: string;
  body?: string | null;
  actorRole?: ActivityActorRole;
  occurredAt?: string;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const { error } = await supabase.from('activities').insert({
      matter_id: input.matterId,
      firm_id: input.firmId,
      activity_type: input.activityType,
      title: input.title,
      body: input.body ?? null,
      actor_role: input.actorRole ?? 'system',
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      metadata: input.metadata ?? null,
    });
    if (error) {
      console.warn('[crm-dual-write] writeActivity failed:', error.message);
    }
  } catch (err) {
    console.warn('[crm-dual-write] writeActivity unexpected error:', err);
  }
}
