// Pure gate-condition logic for the Content Studio legal_gate enforcement
// (Ses.16, WP-2). No I/O, no Supabase: the route
// (pieces/[id]/route.ts) fetches the data and calls these functions with
// plain values. Kept pure and separate so the conditions are directly
// unit-testable without a server-only import chain.

import { canPublishUnderDelegation, type DelegationGrant } from "./deliverables-pure";

export interface ValidationRunSummary {
  status: string;
}

/**
 * Entry condition for advancing a piece INTO legal_gate: a current EN
 * version must exist, and the most recent validate_deterministic run
 * recorded against that version must have zero failing checks. Warnings do
 * not block; only fail-severity findings do.
 */
export function checkLegalGateEntryCondition(input: {
  hasCurrentVersion: boolean;
  latestValidationResults: ValidationRunSummary[] | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.hasCurrentVersion) {
    return {
      ok: false,
      reason: "No current EN version exists for this piece. Generate a draft first.",
    };
  }
  if (!input.latestValidationResults) {
    return {
      ok: false,
      reason: "No validation run recorded for the current version. Run validate before advancing to legal_gate.",
    };
  }
  const failCount = input.latestValidationResults.filter((r) => r.status === "fail").length;
  if (failCount > 0) {
    return {
      ok: false,
      reason: `The most recent validation run has ${failCount} failing check${
        failCount === 1 ? "" : "s"
      }. All checks must pass (warnings are acceptable) before advancing to legal_gate.`,
    };
  }
  return { ok: true };
}

/**
 * Exit condition for advancing a piece OUT of legal_gate (into authoring or
 * production): the linked deliverable must be lawyer-approved, OR an active
 * publish delegation must cover this piece's format. The delegation grant is
 * passed in already resolved (or null); the caller is responsible for
 * treating a missing content_publish_delegations table as "no delegation"
 * (that table is not yet applied to prod as of this writing).
 */
export function checkLegalGateExitCondition(input: {
  deliverableStatus: string | null;
  delegation: DelegationGrant | null;
  format: string;
  now?: Date;
}): { ok: true } | { ok: false; reason: string } {
  if (input.deliverableStatus === "approved") return { ok: true };
  if (canPublishUnderDelegation("operator", input.delegation, input.format, input.now)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      "This piece's linked deliverable has not been approved by the firm's lawyer, and no active publish delegation covers this format. Advance blocked until sign-off.",
  };
}

/**
 * Sibling of checkLegalGateEntryCondition, for advancing a piece INTO
 * authoring (or production, since forward-only gates allow skipping
 * authoring entirely): a bilingual piece must have a current Portuguese
 * version before it can leave legal_gate. English-only pieces are exempt.
 * Checked alongside checkLegalGateExitCondition, not instead of it: both
 * must pass (Ses.17 WP-4).
 */
export function checkBilingualAuthoringCondition(input: {
  languageMode: string;
  hasCurrentPtVersion: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.languageMode !== "bilingual") return { ok: true };
  if (!input.hasCurrentPtVersion) {
    return {
      ok: false,
      reason:
        "This piece is bilingual but has no current Portuguese version. Generate the Portuguese draft before advancing past legal_gate.",
    };
  }
  return { ok: true };
}
