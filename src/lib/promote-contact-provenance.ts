/**
 * Transcript-aware provenance promotion (#137 phase 2 wiring, #139).
 *
 * The engine (`report.ts` buildResolvedFactsV2) sets an honest BASE
 * provenance from slot_meta: contact facts floor at `explicit_from_caller`
 * ("Stated during call"). It deliberately does not claim readback
 * confirmation, because the engine layer has no transcript-pattern view.
 *
 * This app-layer helper does the promotion: for the contact facts
 * (Name / Phone / Email), it runs the readback detector against the call
 * transcript and upgrades the provenance when the caller actually
 * confirmed the value:
 *
 *   detector confirmed_after_readback -> confirmed_by_caller_after_readback (rank 5)
 *   detector spelled_by_caller        -> spelled_by_caller                  (rank 4)
 *   detector none                     -> unchanged
 *
 * Why the app layer, not the engine: `report.ts` is sandbox-mirrored
 * (DR-033); importing the detector there would force the sandbox to carry
 * it. Keeping the promotion in the app wiring (voice-intake route) means
 * the engine stays decoupled and only the channels that actually have a
 * bot transcript (voice) run the promotion. Web/Meta transcripts have no
 * bot readback turns, so the detector returns 'none' and nothing changes.
 *
 * Pure. Never downgrades: a fact is only upgraded when the detector signal
 * outranks the current source (per FACT_SOURCE_PRECEDENCE). This also
 * means re-running on the same transcript is idempotent (no churn).
 */

import { detectReadbackConfirmation } from './readback-detection';
import type { ResolvedFact, FactSource } from './screen-engine/types';
import { FACT_SOURCE_PRECEDENCE } from './screen-engine/types';

// Contact facts whose provenance can be confirmed via readback/spelling.
// Matched against ResolvedFact.label (see SLOT_LABELS in report.ts:
// client_name -> 'Name', client_phone -> 'Phone', client_email -> 'Email').
const CONTACT_LABELS = new Set(['name', 'phone', 'email']);

/**
 * Upgrade contact-fact provenance using transcript readback/spelling
 * evidence. Returns a new array; never mutates the input facts. Returns
 * the original array reference when there is nothing to do (no facts, no
 * transcript) so callers can cheaply detect a no-op.
 */
export function promoteContactProvenance(
  facts: ResolvedFact[] | null | undefined,
  transcript: string | null | undefined,
): ResolvedFact[] {
  if (!facts || facts.length === 0) return facts ?? [];
  if (!transcript || !transcript.trim()) return facts;

  let changed = false;
  const out = facts.map((fact) => {
    if (!CONTACT_LABELS.has(fact.label.trim().toLowerCase())) return fact;
    if (!fact.value || !fact.value.trim()) return fact;

    const result = detectReadbackConfirmation(transcript, fact.value);
    let promoted: FactSource | null = null;
    if (result.kind === 'confirmed_after_readback') {
      promoted = 'confirmed_by_caller_after_readback';
    } else if (result.kind === 'spelled_by_caller') {
      promoted = 'spelled_by_caller';
    }
    if (!promoted) return fact;

    // Never downgrade: only apply when the detected signal outranks the
    // current source. Keeps re-runs idempotent and respects a stronger
    // value that some other path may have already set.
    const currentRank = FACT_SOURCE_PRECEDENCE[fact.source] ?? 0;
    const promotedRank = FACT_SOURCE_PRECEDENCE[promoted] ?? 0;
    if (promotedRank <= currentRank) return fact;

    changed = true;
    return { ...fact, source: promoted };
  });

  return changed ? out : facts;
}
