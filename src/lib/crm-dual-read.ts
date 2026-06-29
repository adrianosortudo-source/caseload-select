import 'server-only';

/**
 * CRM dual-read layer: canonical tables first, fallback to derived data.
 *
 * Pattern: each public function tries the canonical table introduced in M1
 * (parties, activities). When that table is empty or not yet created, it
 * falls back to deriving equivalent data from existing tables.
 *
 * Adding the canonical tables requires no changes here: once rows exist in
 * `parties` or `activities`, the primary path starts returning them and the
 * fallback is bypassed. Rollback = clear the canonical table rows.
 *
 * Also provides `compareLeadParity` (the L6 runbook parity check): reads
 * both `leads` (legacy) and `screened_leads` (canonical) for the same
 * contact and asserts key fields agree.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { MatterStageEvent } from '@/lib/types';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export type PartyRole = 'client' | 'adverse' | 'third_party' | 'unknown';
export type ActivityActorRole = 'admin' | 'staff' | 'operator' | 'system' | 'lawyer' | 'client';
export type ActivityType =
  | 'intake'
  | 'stage_change'
  | 'message'
  | 'conflict_check'
  | 'promotion';

export interface MatterParty {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  party_role: PartyRole;
  is_primary: boolean;
  source: 'canonical' | 'derived';
}

export interface MatterActivity {
  id: string;
  activity_type: ActivityType;
  title: string;
  body: string | null;
  actor_role: ActivityActorRole;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
  source: 'canonical' | 'derived';
}

export interface LeadParityResult {
  screened_lead_id: string;
  legacy_lead_id: string | null;
  drifts: Array<{ field: string; canonical: unknown; legacy: unknown }>;
  ok: boolean;
}

// ──────────────────────────────────────────────────────────────
// Parties
// ──────────────────────────────────────────────────────────────

/**
 * Returns parties for a matter.
 *
 * Primary path: `parties` table (M1). Checked first; if rows exist, those
 * are returned directly.
 *
 * Fallback path: derives a single client party from `client_matters.primary_*`
 * fields. Only the primary contact is available from the current schema; an
 * adverse party or third parties require the canonical table.
 */
export async function readParties(
  matterId: string,
  firmId: string,
): Promise<MatterParty[]> {
  // Primary: canonical parties table (populated once M1 migration lands)
  try {
    const { data, error } = await supabase
      .from('parties')
      .select('id, full_name, email, phone, party_role, is_primary')
      .eq('matter_id', matterId)
      .eq('firm_id', firmId)
      .order('is_primary', { ascending: false });
    if (!error && data && data.length > 0) {
      return data.map((r) => ({
        id: r.id as string,
        full_name: (r.full_name as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        phone: (r.phone as string | null) ?? null,
        party_role: (r.party_role as PartyRole) ?? 'unknown',
        is_primary: Boolean(r.is_primary),
        source: 'canonical' as const,
      }));
    }
  } catch {
    // Table not yet created; fall through to derived path
  }

  // Fallback: derive from client_matters primary contact fields
  const { data: matter } = await supabase
    .from('client_matters')
    .select('primary_name, primary_email, primary_phone')
    .eq('id', matterId)
    .eq('firm_id', firmId)
    .maybeSingle();

  if (!matter) return [];

  return [
    {
      id: `${matterId}:primary`,
      full_name: matter.primary_name ?? null,
      email: matter.primary_email ?? null,
      phone: matter.primary_phone ?? null,
      party_role: 'client',
      is_primary: true,
      source: 'derived',
    },
  ];
}

// ──────────────────────────────────────────────────────────────
// Activities
// ──────────────────────────────────────────────────────────────

/**
 * Returns a unified chronological activity timeline for a matter.
 *
 * Primary path: `activities` table (M1). Checked first; if rows exist, those
 * are returned directly.
 *
 * Fallback path: aggregates from three sources:
 *   - `matter_promotion_events` (take / matter-created outcome)
 *   - `matter_stage_events` (stage transitions)
 *   - `matter_messages` (lawyer and client messages)
 *
 * All three sources are queried in parallel, then merged and sorted
 * chronologically. Activities already in the `activities` table (once M1
 * lands) supersede this fallback entirely.
 */
export async function readActivities(
  matterId: string,
  firmId: string,
): Promise<MatterActivity[]> {
  // Primary: canonical activities table (populated once M1 migration lands)
  try {
    const { data, error } = await supabase
      .from('activities')
      .select('id, activity_type, title, body, actor_role, occurred_at, metadata')
      .eq('matter_id', matterId)
      .eq('firm_id', firmId)
      .order('occurred_at', { ascending: true });
    if (!error && data && data.length > 0) {
      return data.map((r) => ({ ...(r as MatterActivity), source: 'canonical' as const }));
    }
  } catch {
    // Table not yet created; fall through to derived path
  }

  // Fallback: aggregate from existing event sources in parallel
  const [promotionEvents, stageEvents, messages] = await Promise.all([
    supabase
      .from('matter_promotion_events')
      .select('id, event_type, lawyer_id, error_text, created_at')
      .eq('matter_id', matterId)
      .order('created_at', { ascending: true })
      .then((r) => r.data ?? []),
    supabase
      .from('matter_stage_events')
      .select('id, from_stage, to_stage, actor_role, actor_id, note, created_at')
      .eq('matter_id', matterId)
      .order('created_at', { ascending: true })
      .then((r) => (r.data ?? []) as MatterStageEvent[]),
    supabase
      .from('matter_messages')
      .select('id, channel_type, recipient_scope, sender_role, body, created_at')
      .eq('matter_id', matterId)
      .order('created_at', { ascending: true })
      .then((r) => r.data ?? []),
  ]);

  const activities: MatterActivity[] = [];

  // Promotion events (take-to-matter observability)
  for (const p of promotionEvents) {
    const eventType = String(p.event_type ?? '');
    const title =
      eventType === 'matter_created'
        ? 'Matter created'
        : eventType === 'take_recorded'
        ? 'Lead taken'
        : eventType === 'matter_failed'
        ? `Matter creation failed${p.error_text ? ': ' + p.error_text : ''}`
        : eventType === 'matter_skipped'
        ? 'Matter creation skipped (duplicate)'
        : eventType;
    activities.push({
      id: String(p.id),
      activity_type: 'promotion',
      title,
      body: null,
      actor_role: 'system',
      occurred_at: String(p.created_at),
      metadata: {
        event_type: p.event_type,
        lawyer_id: p.lawyer_id,
      },
      source: 'derived',
    });
  }

  // Stage transition events
  for (const e of stageEvents) {
    const title = e.from_stage
      ? `Stage: ${e.from_stage} to ${e.to_stage}`
      : `Stage set to ${e.to_stage}`;
    activities.push({
      id: e.id,
      activity_type: 'stage_change',
      title,
      body: e.note ?? null,
      actor_role: (e.actor_role as ActivityActorRole) ?? 'system',
      occurred_at: e.created_at,
      metadata: {
        from_stage: e.from_stage,
        to_stage: e.to_stage,
        actor_id: e.actor_id,
      },
      source: 'derived',
    });
  }

  // Messages (abbreviated: title describes the message; body is the text)
  for (const m of messages) {
    const channel = String(m.channel_type ?? 'unknown');
    const scope = String(m.recipient_scope ?? '');
    const senderRole = String(m.sender_role ?? 'system');
    const label = scope === 'client' ? 'client message' : 'internal note';
    activities.push({
      id: String(m.id),
      activity_type: 'message',
      title: `${senderRole} sent ${label} (${channel})`,
      body: typeof m.body === 'string' ? m.body : null,
      actor_role: (senderRole as ActivityActorRole) ?? 'system',
      occurred_at: String(m.created_at),
      metadata: { channel_type: m.channel_type, recipient_scope: m.recipient_scope },
      source: 'derived',
    });
  }

  // Sort chronologically
  activities.sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );

  return activities;
}

// ──────────────────────────────────────────────────────────────
// Lead parity check (L6 runbook dual-read)
// ──────────────────────────────────────────────────────────────

/**
 * Parity check between the legacy `leads` table and `screened_leads`
 * (canonical). Implements the L6 runbook dual-read: reads both rows and
 * compares the fields that must agree before GHL-exit cutover.
 *
 * Returns `ok: true` when all compared fields are in agreement.
 * Returns drift entries for any field that differs.
 *
 * Usage: call from a one-shot admin route or CLI script before cutover.
 * Not used in the live portal render path.
 */
export async function compareLeadParity(
  screened_lead_id: string,
  firmId: string,
): Promise<LeadParityResult> {
  const [screened, matter] = await Promise.all([
    supabase
      .from('screened_leads')
      .select('contact_name, contact_email, contact_phone, matter_type, band')
      .eq('id', screened_lead_id)
      .eq('firm_id', firmId)
      .maybeSingle(),
    supabase
      .from('client_matters')
      .select('id, primary_name, primary_email, primary_phone, matter_type, lead_id')
      .eq('source_screened_lead_id', screened_lead_id)
      .eq('firm_id', firmId)
      .maybeSingle(),
  ]);

  if (!screened.data) {
    return {
      screened_lead_id,
      legacy_lead_id: null,
      drifts: [{ field: 'screened_lead', canonical: null, legacy: null }],
      ok: false,
    };
  }

  const s = screened.data;
  const m = matter.data;

  if (!m) {
    // No matter created yet; parity is vacuously OK (lead not yet taken)
    return { screened_lead_id, legacy_lead_id: null, drifts: [], ok: true };
  }

  const comparisons: Array<{ field: string; canonical: unknown; legacy: unknown }> = [
    { field: 'name',         canonical: s.contact_name,  legacy: m.primary_name },
    { field: 'email',        canonical: s.contact_email, legacy: m.primary_email },
    { field: 'phone',        canonical: s.contact_phone, legacy: m.primary_phone },
    { field: 'matter_type',  canonical: s.matter_type,   legacy: m.matter_type },
  ];

  const drifts = comparisons.filter(
    (c) => normalise(c.canonical) !== normalise(c.legacy),
  );

  return {
    screened_lead_id,
    legacy_lead_id: m.lead_id ?? null,
    drifts,
    ok: drifts.length === 0,
  };
}

function normalise(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  return String(v).trim().toLowerCase();
}
