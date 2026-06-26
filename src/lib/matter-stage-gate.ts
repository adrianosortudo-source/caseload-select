/**
 * Stage-transition compliance gate for client_matters.
 *
 * Checks domain prerequisites before a stage advance is committed. Wired into
 * transitionMatterStage between the state-graph validation and the DB write.
 *
 * Currently implemented:
 *   - Mandatory contact: intake -> retainer_pending requires primary_name
 *     and at least one of primary_email / primary_phone.
 *
 * Stubbed (always returns allowed; wired when backing data exists):
 *   - Conflict disposition (conflict_checks table not yet built)
 *   - Comms consent (DR-075 migration pending operator approval)
 *
 * DR-075: CASL consent gate architecture.
 */

import type { MatterStage } from '@/lib/types';

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

// Stages that require contact info before advancing.
const CONTACT_REQUIRED_TARGETS = new Set<MatterStage>(['retainer_pending']);

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

  // Gate 2: conflict disposition (stub).
  // TODO: query conflict_checks by matter.id; block if disposition = 'conflict_found'.
  // Activate when the conflict_checks table is built and migrations are applied.

  // Gate 3: comms consent (stub).
  // TODO (DR-075 activation): query screened_leads by matter.source_screened_lead_id;
  // for transitions that trigger cadences (retainer_pending, active), call isConsentGated.
  // Activate after the DR-075 migration is applied and widget consent checkbox is live.

  return { allowed: true };
}
