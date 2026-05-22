/**
 * Pure helpers for the matter-stage state machine (S8 Phase 1 Story 3).
 *
 * The matter goes through five stages, forward-only:
 *
 *   intake → retainer_pending → active → closing → closed
 *
 * Reverse transitions are not exposed in the UI; the operator unlocks
 * manually via direct DB UPDATE if a matter needs to move backwards
 * (rare edge case).
 *
 * Each forward transition fires a journey cadence per the existing
 * sequence-engine triggers:
 *
 *   intake               → retainer_pending : J6 (retainer awaiting)
 *   retainer_pending     → active           : J7 (welcome / onboarding)
 *   active               → closing          : J9 (review request)
 *   closing              → closed           : J11 + J12 (relationship +
 *                                             long-term nurture)
 *
 * No DB / IO in this file. Imported by both the stage transition route
 * and the take-handler matter-creation effect.
 */

import type { MatterStage } from './types';

const FORWARD_TRANSITIONS: Record<MatterStage, MatterStage | null> = {
  intake: 'retainer_pending',
  retainer_pending: 'active',
  active: 'closing',
  closing: 'closed',
  closed: null,
};

/**
 * Returns true if `to` is the legal next stage for `from`. Reverse
 * transitions, same-stage no-ops, and skipped stages all return false.
 */
export function validateStageTransition(from: MatterStage, to: MatterStage): boolean {
  if (from === to) return false;
  const expected = FORWARD_TRANSITIONS[from];
  return expected !== null && expected === to;
}

/**
 * Returns the sequence-engine trigger_event name to fire when a matter
 * transitions from `from` to `to`. Returns null if no journey is
 * scheduled for that transition.
 *
 * Trigger names match the existing values accepted by
 * sequence-engine.triggerSequence (see src/lib/sequence-engine.ts and
 * the 12-journey table in the master CLAUDE.md).
 */
export function journeyTriggerForTransition(
  from: MatterStage,
  to: MatterStage,
): string | null {
  if (!validateStageTransition(from, to)) return null;
  if (from === 'intake' && to === 'retainer_pending') return 'retainer_awaiting';
  if (from === 'retainer_pending' && to === 'active') return 'client_won';
  if (from === 'active' && to === 'closing') return 'review_request';
  if (from === 'closing' && to === 'closed') return 'relationship_milestone';
  return null;
}

/**
 * Returns the next stage after `from`, or null if `from` is the
 * terminal stage (closed). Used by the UI to render the "advance to:"
 * button label.
 */
export function nextStage(from: MatterStage): MatterStage | null {
  return FORWARD_TRANSITIONS[from];
}

/**
 * Returns true if the actor role is permitted to advance the matter
 * stage. Phase 1 permission model:
 *
 *   admin    : all transitions
 *   staff    : intake → retainer_pending only (staff can move a matter
 *              into retainer-pending; only admin can mark active /
 *              closing / closed because those have legal-billing
 *              implications)
 *   operator : all transitions (cross-firm override)
 *   client   : NEVER
 *   system   : forward transitions only (driven by automated triggers
 *              such as the post-OTP routing pipeline)
 *
 * Application route enforces this; DB has no role-check trigger.
 */
export function canAdvanceStage(
  role: 'admin' | 'staff' | 'operator' | 'client' | 'system',
  from: MatterStage,
  to: MatterStage,
): boolean {
  if (role === 'client') return false;
  if (!validateStageTransition(from, to)) return false;
  if (role === 'admin' || role === 'operator' || role === 'system') return true;
  // staff: only intake → retainer_pending
  return role === 'staff' && from === 'intake' && to === 'retainer_pending';
}
