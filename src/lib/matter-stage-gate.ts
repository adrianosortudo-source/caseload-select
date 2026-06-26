/**
 * Stage-transition compliance gate for client_matters.
 *
 * Checks domain prerequisites before a stage advance is committed. Wired into
 * transitionMatterStage between the state-graph validation and the DB write.
 *
 * Implemented:
 *   Gate 1: Mandatory contact -- intake to retainer_pending requires primary_name
 *     and at least one of primary_email / primary_phone.
 *   Gate 2: Canonical conflict check -- retainer_pending and active require a
 *     human-cleared or human-waived row in screened_conflict_checks for this
 *     matter. No auto-clear. No row = blocked. Waived requires waiver_consent_id.
 *     The legacy conflict_checks table (rooted on leads/law_firm_clients) is NOT
 *     consulted here.
 *
 * Stubbed (always returns allowed; wired when backing data exists):
 *   Gate 3: Comms consent (DR-075 migration pending operator approval)
 */

import type { MatterStage } from '@/lib/types';
import { supabaseAdmin } from '@/lib/supabase-admin';

export type StageGateCode =
  | 'missing_contact_info'
  | 'conflict_not_cleared'
  | 'consent_gate_blocked';

export type StageGateResult =
  | { allowed: true }
  | { allowed: false; reason: string; code: StageGateCode };

export interface GateMatterInput {
  id: string;
  source_screened_lead_id: string | null;
  primary_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
}

const CONTACT_REQUIRED_TARGETS = new Set<MatterStage>(['retainer_pending']);

// Both stages involve external parties and financial commitment; conflict must
// be cleared before either is permitted.
const CONFLICT_GATE_TARGETS = new Set<MatterStage>(['retainer_pending', 'active']);

/**
 * Returns { allowed: true } when all compliance checks pass, or a
 * { allowed: false, reason, code } when a gate blocks the transition.
 *
 * @param matter  Contact and FK fields from the client_matters row.
 * @param to      Target stage being requested.
 */
export async function checkStageGate(
  matter: GateMatterInput,
  to: MatterStage,
): Promise<StageGateResult> {
  // Gate 1: mandatory contact fields before the retainer step.
  if (CONTACT_REQUIRED_TARGETS.has(to)) {
    if (!matter.primary_name?.trim()) {
      return {
        allowed: false,
        reason: 'primary_name is required before advancing to retainer_pending',
        code: 'missing_contact_info',
      };
    }
    if (!matter.primary_email?.trim() && !matter.primary_phone?.trim()) {
      return {
        allowed: false,
        reason: 'primary_email or primary_phone is required before advancing to retainer_pending',
        code: 'missing_contact_info',
      };
    }
  }

  // Gate 2: canonical conflict check (screened_conflict_checks, NOT legacy conflict_checks).
  // No auto-clear: absence of a check is a block, not a pass.
  if (CONFLICT_GATE_TARGETS.has(to)) {
    const { data: check } = await supabaseAdmin
      .from('screened_conflict_checks')
      .select('check_status, waiver_consent_id')
      .eq('matter_id', matter.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!check) {
      return {
        allowed: false,
        reason: 'No conflict check on file. A conflict check must be completed and cleared before advancing.',
        code: 'conflict_not_cleared',
      };
    }

    if (check.check_status === 'cleared') {
      // Human reviewer confirmed no conflict; gate passes.
    } else if (check.check_status === 'waived') {
      if (!check.waiver_consent_id) {
        return {
          allowed: false,
          reason: 'Conflict waiver must reference a consent or waiver record (waiver_consent_id is required).',
          code: 'conflict_not_cleared',
        };
      }
      // Waived with a consent/waiver reference on file; gate passes.
    } else {
      // pending, potential, or blocked
      return {
        allowed: false,
        reason: `Conflict check status is '${check.check_status}'. A human must clear or waive before advancing.`,
        code: 'conflict_not_cleared',
      };
    }
  }

  // Gate 3: comms consent (stub).
  // TODO (DR-075 activation): query screened_leads by matter.source_screened_lead_id;
  // for transitions that trigger cadences (retainer_pending, active), call isConsentGated.
  // Activate after the DR-075 migration is applied and widget consent checkbox is live.

  return { allowed: true };
}
