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

const KNOWN_CLAIM_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "released",
  "superseded",
]);

const KNOWN_NEXT_ACTIONS: ReadonlySet<string> = new Set([
  "approve_deliverable",
  "resolve_version_drift",
  "already_published",
  "needs_reverification",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Runtime guard for the claim_placement_for_publish RPC's jsonb response
 * (authoritative shape: supabase/migrations/20260716200000_publication_
 * receipt_claim_binding.sql). Postgres returns untyped jsonb over the wire,
 * so nothing upstream of this function guarantees the shape actually
 * matches ClaimPlacementResult -- a bare `as` cast previously trusted it
 * blindly, and `Boolean(result.ok)` coerced any truthy-but-wrong value
 * (e.g. `{ok: "true"}`, `{ok: 1}`) into an accepted claim. This hand-written
 * guard replaces both: no schema library is used because none is a
 * dependency of this codebase and the shape is small enough that a manual
 * check is simpler than adding one.
 *
 * Every branch that cannot prove the response matches the documented shape
 * returns a fail-closed ok:false result instead of throwing or silently
 * passing an ambiguous value through as ok:true.
 */
function parseClaimPlacementResponse(data: unknown): ClaimPlacementResult {
  const fail = (reason: string): ClaimPlacementResult => ({
    ok: false,
    error: `malformed claim_placement_for_publish response: ${reason}`,
  });

  if (!isPlainObject(data)) {
    return fail(`expected an object, got ${describeType(data)}`);
  }
  if (typeof data.ok !== "boolean") {
    return fail(`"ok" must be a boolean, got ${describeType(data.ok)}`);
  }

  const idempotentReplayRaw = data.idempotent_replay;
  if (idempotentReplayRaw !== undefined && typeof idempotentReplayRaw !== "boolean") {
    return fail(
      `"idempotent_replay" must be a boolean when present, got ${describeType(idempotentReplayRaw)}`,
    );
  }

  const statusRaw = data.status;
  if (
    statusRaw !== undefined &&
    (typeof statusRaw !== "string" || !KNOWN_CLAIM_STATUSES.has(statusRaw))
  ) {
    return fail(`unrecognized "status" value: ${JSON.stringify(statusRaw)}`);
  }

  const errorRaw = data.error;
  if (errorRaw !== undefined && typeof errorRaw !== "string") {
    return fail(`"error" must be a string when present, got ${describeType(errorRaw)}`);
  }

  const existingClaimIdRaw = data.existing_claim_id;
  if (existingClaimIdRaw !== undefined && typeof existingClaimIdRaw !== "string") {
    return fail(
      `"existing_claim_id" must be a string when present, got ${describeType(existingClaimIdRaw)}`,
    );
  }

  const nextActionRaw = data.next_action;
  if (
    nextActionRaw !== undefined &&
    (typeof nextActionRaw !== "string" || !KNOWN_NEXT_ACTIONS.has(nextActionRaw))
  ) {
    return fail(`unrecognized "next_action" value: ${JSON.stringify(nextActionRaw)}`);
  }

  const claimIdRaw = data.claim_id;
  if (data.ok === true) {
    if (typeof claimIdRaw !== "string" || claimIdRaw.length === 0) {
      return fail(
        `"claim_id" must be a non-empty string when ok is true, got ${describeType(claimIdRaw)}`,
      );
    }
  } else if (claimIdRaw !== undefined && typeof claimIdRaw !== "string") {
    return fail(`"claim_id" must be a string when present, got ${describeType(claimIdRaw)}`);
  }

  return {
    ok: data.ok,
    claimId: typeof claimIdRaw === "string" ? claimIdRaw : undefined,
    idempotentReplay: idempotentReplayRaw as boolean | undefined,
    status: statusRaw as ClaimPlacementResult["status"],
    error: errorRaw as string | undefined,
    existingClaimId: existingClaimIdRaw as string | undefined,
    nextAction: nextActionRaw as ClaimNextAction | undefined,
  };
}

/**
 * Atomically claims a placement/version for publish. Returns ok:false
 * (never throws) for every expected rejection -- version drift, an
 * already-active competing claim, an already-published placement -- so
 * the calling route can surface a precise reason rather than a generic
 * 500. Also returns ok:false, fail-closed, if the RPC response itself
 * does not match the documented shape (see parseClaimPlacementResponse).
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
  return parseClaimPlacementResponse(data);
}
