/**
 * Minimum discovery floor for async lead-intake channels (#170, 2026-06-08).
 *
 * Doctrine: on WhatsApp / Messenger / Instagram the channel processor MUST
 * NOT finalize until both:
 *   (a) the contact-doctrine gate is satisfied (name + reachable), AND
 *   (b) this discovery floor is satisfied.
 *
 * Background: the engine's stop / present_insight / readyToStop logic
 * declared "done" after the matter-specific gap chain bottomed out, which
 * could be as little as one substantive answer (e.g. `advisory_path` on a
 * `business_setup_advisory` matter). Field repro 2026-06-08: a WhatsApp
 * lead said "I need to open my business in canada", answered ONE
 * qualifier ("Starting a new business"), and the engine finalized with
 * a single user-answered substantive fact. That is not enough for a
 * brief.
 *
 * This floor is a processor-side guard, not an engine rewrite. The
 * engine's internal stopping rule still drives the question SELECTION;
 * the processor refuses to act on `stop` / `present_insight` for async
 * channels until the floor is met, and falls back to `selectNextSlot`
 * to keep asking.
 *
 * Counting discipline (key invariants):
 *  - Only substantive (matter-discovery) slots are counted. Contact
 *    slots (`client_name`/`email`/`phone`/`postal_code`) are excluded
 *    because reachability vs identity is a separate gate.
 *  - Only USER-ANSWERED facts are counted. Source provenance must be
 *    one of `'answered'` (UI / numeric option mapping), `'explicit'`
 *    (regex evidence span from user's text), or the legacy `'inferred'`
 *    bucket (also user-text-derived). Excluded: `'llm_inferred'`
 *    (Gemini hint, no user evidence), `'profile_metadata'` (WhatsApp/
 *    Messenger profile name; not identity-confirming), `'system_metadata'`
 *    (carrier-verified phone; reachability not discovery), `'unknown'`
 *    (defensive bucket).
 *  - Matter-specific floors (business_setup_advisory, contract_dispute,
 *    will_drafting) restrict counting to a curated candidate set so
 *    answering off-axis slots does not satisfy the lane's floor.
 *
 * Exception matters (early finalize permitted):
 *  - `'out_of_scope'`: the engine has already classified the matter as
 *    outside the firm's practice. Asking more discovery is wasted; the
 *    lawyer reviews and refers.
 *  - `'unknown'`: the engine could not classify. We have nothing
 *    matter-specific to ask, so asking generic discovery would be
 *    confused. Allow finalize (the lawyer triages from the raw input).
 *  - Future explicit-abort signals (e.g. lead types "stop", refusal
 *    detected): not implemented today; add to EARLY_FINALIZE_MATTERS
 *    or a separate predicate when introduced.
 */

import type { EngineState } from './screen-engine/types';

/** Matter types for which the processor may finalize without discovery depth. */
export const EARLY_FINALIZE_MATTERS: ReadonlySet<string> = new Set([
  'out_of_scope',
  'unknown',
]);

/** Slot ids that are contact (NAP), not matter discovery. Excluded from counts. */
const CONTACT_SLOTS: ReadonlySet<string> = new Set([
  'client_name',
  'client_email',
  'client_phone',
  'client_postal_code',
]);

/** Slot meta source values that count as user-grounded (toward the floor). */
const COUNTABLE_SOURCES: ReadonlySet<string> = new Set([
  'answered',
  'explicit',
  'inferred', // legacy: regex-evidence-from-user-text
]);

/** Default minimum for matter types without a curated candidate set. */
export const GLOBAL_MIN_DISCOVERY = 3;

interface MatterFloor {
  minCount: number;
  /**
   * Curated candidate set. Only slots in this set are counted toward
   * the floor for this matter type. Encodes "what counts as substantive
   * for THIS lane" so a stray off-axis answer does not green-light
   * finalize.
   */
  candidateSlots: ReadonlySet<string>;
}

/** Per-matter floors for the DRG launch lanes (#170, 2026-06-08). */
export const MATTER_DISCOVERY_FLOOR: Readonly<Record<string, MatterFloor>> = {
  business_setup_advisory: {
    minCount: 3,
    candidateSlots: new Set([
      'advisory_path',
      'business_activity_type',
      'co_owner_count',
      'advisory_concern',
      'advisory_timing',
      'hiring_timeline',
      'revenue_expectation',
    ]),
  },
  contract_dispute: {
    minCount: 3,
    candidateSlots: new Set([
      'written_terms',
      'contract_exists',
      'communications_exist',
      'amount_at_stake',
      'dispute_reason',
      'desired_outcome_contract',
      'hiring_timeline',
    ]),
  },
  will_drafting: {
    minCount: 3,
    candidateSlots: new Set([
      'existing_will_status',
      'marital_status',
      'children_count',
      'estate_complexity',
      'hiring_timeline',
    ]),
  },
};

/**
 * Count substantive user-answered slots in engine state. Used for the
 * generic floor (matters not in MATTER_DISCOVERY_FLOOR) and for diagnostic
 * reporting. Excludes contact slots and non-user-grounded provenance.
 */
export function countUserAnsweredSubstantive(state: EngineState): number {
  let count = 0;
  for (const [slotId, value] of Object.entries(state.slots)) {
    if (!value) continue;
    if (CONTACT_SLOTS.has(slotId)) continue;
    const meta = state.slot_meta[slotId];
    const source = meta?.source ?? 'unknown';
    if (!COUNTABLE_SOURCES.has(source)) continue;
    count++;
  }
  return count;
}

/**
 * Returns true when the engine state satisfies the discovery floor for
 * the current matter. Exception matters (out_of_scope, unknown) pass
 * automatically. Matter-specific lanes use a curated candidate set;
 * everything else falls back to GLOBAL_MIN_DISCOVERY substantive
 * non-contact user-answered slots.
 */
export function meetsDiscoveryFloor(state: EngineState): boolean {
  const matter = state.matter_type;
  if (EARLY_FINALIZE_MATTERS.has(matter)) return true;

  const floor = MATTER_DISCOVERY_FLOOR[matter];
  if (floor) {
    let count = 0;
    for (const slotId of floor.candidateSlots) {
      const value = state.slots[slotId];
      if (!value) continue;
      const meta = state.slot_meta[slotId];
      const source = meta?.source ?? 'unknown';
      if (!COUNTABLE_SOURCES.has(source)) continue;
      count++;
    }
    return count >= floor.minCount;
  }

  // Generic floor: any GLOBAL_MIN_DISCOVERY substantive user-answered
  // non-contact slots across all matter types.
  return countUserAnsweredSubstantive(state) >= GLOBAL_MIN_DISCOVERY;
}
