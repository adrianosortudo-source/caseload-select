/**
 * Content Studio publishing evidence system: atomic placement claim
 * (corrective-release finding 4). I/O wrapper over the
 * claim_placement_for_publish RPC (see
 * supabase/migrations/20260716150130_publication_placement_claims.sql).
 *
 * This is the authority a caller uses to atomically reserve a
 * placement/version BEFORE any external publish action begins --
 * buildPreflightReport() (publication-preflight.ts) stays a read-only
 * preview; it is never sufficient permission to publish on its own. Two
 * concurrent callers claiming the same placement cannot both succeed: the
 * RPC locks the deliverable and placement rows, re-runs readiness, and a
 * repeated idempotency_key always returns the same result rather than
 * creating a second claim.
 *
 * No external publisher is wired to this module. It is the reservation
 * primitive a future publisher workstream calls before acting.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type { DeliverableActor } from "@/lib/deliverables";

export interface ClaimPlacementInput {
  firmId: string;
  deliverableId: string;
  placementId: string;
  approvedVersionId: string;
  idempotencyKey: string;
  actor: DeliverableActor;
  supersedesClaimId?: string | null;
}

export type ClaimNextAction =
  | "approve_deliverable"
  | "resolve_version_drift"
  | "already_published"
  | "needs_reverification";

export interface ClaimPlacementResult {
  ok: boolean;
  claimId?: string;
  idempotentReplay?: boolean;
  status?: "active" | "released" | "superseded";
  error?: string;
  existingClaimId?: string;
  nextAction?: ClaimNextAction;
}

/**
 * Atomically claims a placement/version for publish. Returns ok:false
 * (never throws) for every expected rejection -- version drift, an
 * already-active competing claim, an already-published placement -- so
 * the calling route can surface a precise reason rather than a generic
 * 500.
 */
export async function claimPlacementForPublish(
  input: ClaimPlacementInput,
): Promise<ClaimPlacementResult> {
  const { data, error } = await supabase.rpc("claim_placement_for_publish", {
    p_firm_id: input.firmId,
    p_deliverable_id: input.deliverableId,
    p_placement_id: input.placementId,
    p_approved_version_id: input.approvedVersionId,
    p_idempotency_key: input.idempotencyKey,
    p_actor_role: input.actor.role,
    p_actor_id: input.actor.id ?? null,
    p_actor_name: input.actor.name ?? null,
    p_supersedes_claim_id: input.supersedesClaimId ?? null,
  });
  if (error) {
    return { ok: false, error: `claim rpc failed: ${error.message}` };
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    claim_id?: string;
    idempotent_replay?: boolean;
    status?: "active" | "released" | "superseded";
    error?: string;
    existing_claim_id?: string;
    next_action?: ClaimNextAction;
  };
  return {
    ok: Boolean(result.ok),
    claimId: result.claim_id,
    idempotentReplay: result.idempotent_replay,
    status: result.status,
    error: result.error,
    existingClaimId: result.existing_claim_id,
    nextAction: result.next_action,
  };
}
