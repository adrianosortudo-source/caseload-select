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
  | "needs_reverification"
  | "use_new_idempotency_key";

export type ReleasePath = "individual_approval" | "standing_authorization";

export interface ClaimPlacementResult {
  ok: boolean;
  claimId?: string;
  idempotentReplay?: boolean;
  status?: "active" | "released" | "superseded";
  error?: string;
  existingClaimId?: string;
  nextAction?: ClaimNextAction;
  /**
   * Which release path authorized this claim: an individually approved
   * version, or an enabled standing publishing authorization (see
   * supabase/migrations/20260717230956_standing_publishing_authorization.sql).
   * Optional in this parser (not required on every ok:true response) so a
   * caller mocking an RPC response predating this field keeps working;
   * the real RPC always includes it on every ok:true response.
   */
  releasePath?: ReleasePath;
}

const KNOWN_CLAIM_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "released",
  "superseded",
]);

const KNOWN_RELEASE_PATHS: ReadonlySet<string> = new Set([
  "individual_approval",
  "standing_authorization",
]);

const KNOWN_NEXT_ACTIONS: ReadonlySet<string> = new Set([
  "approve_deliverable",
  "resolve_version_drift",
  "already_published",
  "needs_reverification",
  "use_new_idempotency_key",
]);

// RFC 4122 textual form, case-insensitive (Postgres's uuid::text output is
// lowercase, but this guards the wire shape, not a specific serializer).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Runtime guard for the claim_placement_for_publish RPC's jsonb response
 * (authoritative shape: supabase/migrations/
 * 20260717001510_publication_placement_claim_idempotency_identity_scoping.sql,
 * the current definition of the function). Postgres returns untyped jsonb
 * over the wire, so nothing upstream of this function guarantees the shape
 * actually matches ClaimPlacementResult -- a bare `as` cast previously
 * trusted it blindly, and `Boolean(result.ok)` coerced any truthy-but-wrong
 * value (e.g. `{ok: "true"}`, `{ok: 1}`) into an accepted claim. This
 * hand-written guard replaces both: no schema library is used because none
 * is a dependency of this codebase and the shape is small enough that a
 * manual check is simpler than adding one.
 *
 * Adversarial-review follow-up: an ok:true response now also requires
 * claim_id to be UUID-shaped (not merely non-empty), and status /
 * idempotent_replay to both be PRESENT (not just correctly typed when
 * present) -- the RPC always returns both on every ok:true path, so their
 * absence is itself a signal the response does not match the documented
 * contract and must fail closed, not be treated as "optional and missing."
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

  const releasePathRaw = data.release_path;
  if (
    releasePathRaw !== undefined &&
    (typeof releasePathRaw !== "string" || !KNOWN_RELEASE_PATHS.has(releasePathRaw))
  ) {
    return fail(`unrecognized "release_path" value: ${JSON.stringify(releasePathRaw)}`);
  }

  const claimIdRaw = data.claim_id;
  if (data.ok === true) {
    // Fail-closed shape requirements for every ok:true response: the RPC
    // always returns claim_id, status, and idempotent_replay together on
    // every ok:true code path (see the migration), so a response missing
    // any of them, or substituting a non-UUID/whitespace/nested value for
    // claim_id, does not match the documented contract and must not be
    // treated as an accepted claim.
    if (!isValidUuid(claimIdRaw)) {
      return fail(
        `"claim_id" must be a UUID string when ok is true, got ${describeType(claimIdRaw)}: ${JSON.stringify(claimIdRaw)}`,
      );
    }
    if (statusRaw === undefined) {
      return fail(`"status" is required when ok is true`);
    }
    if (idempotentReplayRaw === undefined) {
      return fail(`"idempotent_replay" is required when ok is true`);
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
    releasePath: releasePathRaw as ReleasePath | undefined,
  };
}

export interface PlacementClaimRecord {
  id: string;
  placement_id: string;
  approved_version_id: string;
  status: "active" | "released" | "superseded";
  release_path: ReleasePath;
  standing_authorization_event_id: string | null;
  claimed_by_role: "operator" | "lawyer" | "system";
  claimed_by_name: string | null;
  claimed_at: string;
}

/**
 * The most recent claim for a placement, regardless of status -- used to
 * render publication status (which release path authorized the current
 * or most recent release attempt) on the deliverable detail page. Read
 * directly, not through the RPC: this is a display query, not a mutation.
 */
export async function getLatestClaimForPlacement(
  placementId: string,
): Promise<PlacementClaimRecord | null> {
  const { data, error } = await supabase
    .from("publication_placement_claims")
    .select("id, placement_id, approved_version_id, status, release_path, standing_authorization_event_id, claimed_by_role, claimed_by_name, claimed_at")
    .eq("placement_id", placementId)
    .order("claimed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestClaimForPlacement failed: ${error.message}`);
  return (data as PlacementClaimRecord | null) ?? null;
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
