/**
 * CR-18 (Section 18): the append-only operation-event receipt shape.
 * `publishing_package_events.event_type` is a Postgres CHECK-constrained
 * enum (15 values); `receipt` is unconstrained jsonb, so this module is
 * what actually enforces "every material operation produces an event with
 * the required receipt fields" at the application layer -- the table
 * itself only enforces append-only-ness (a trigger blocks UPDATE/DELETE),
 * not receipt shape.
 */
import { randomUUID } from "node:crypto";

/** The 15 values from publishing_package_events.event_type's CHECK constraint, verbatim. */
export type PackageEventType =
  | "manifest_created" | "manifest_revised" | "asset_required" | "candidate_registered"
  | "candidate_selected" | "hash_verified" | "asset_uploaded" | "asset_bound"
  | "rendered_verified" | "asset_blocked" | "asset_rejected" | "asset_superseded"
  | "package_preflight_run" | "package_release_ready" | "publication_receipt_recorded";

/** Section 18's required receipt fields, plus operation_id and timestamp which the same section names in prose ("Required receipt fields: operation ID; ... timestamp; outcome; failure reason"). */
export const REQUIRED_RECEIPT_FIELDS = [
  "operation_id", "package_id", "period_id", "firm_id", "content_slot_id",
  "deliverable_id", "source_version_id", "asset_id", "filename", "asset_role",
  "destination", "locale", "expected_hash", "computed_hash", "previous_binding",
  "resulting_binding", "actor_type", "timestamp", "outcome", "failure_reason",
] as const;

export interface BuildEventReceiptInput {
  packageId: string;
  periodId: string;
  firmId: string;
  contentSlotId: string | null;
  deliverableId: string | null;
  sourceVersionId: string | null;
  assetId: string | null;
  filename: string | null;
  assetRole: string | null;
  destination: string | null;
  locale: string | null;
  expectedHash: string | null;
  computedHash: string | null;
  previousBinding: unknown;
  resultingBinding: unknown;
  actorType: string;
  outcome: "success" | "failure";
  failureReason: string | null;
}

/**
 * Builds one event receipt containing every field REQUIRED_RECEIPT_FIELDS
 * names -- operation_id and timestamp are generated here, never accepted
 * from a caller (a caller-supplied operation id or timestamp would defeat
 * the point of this being the durable, trustworthy record).
 */
export function buildEventReceipt(input: BuildEventReceiptInput): Record<string, unknown> {
  if (input.outcome === "failure" && (!input.failureReason || input.failureReason.trim().length === 0)) {
    throw new Error("failure_reason is required when outcome is failure");
  }

  const receipt: Record<string, unknown> = {
    operation_id: randomUUID(),
    package_id: input.packageId,
    period_id: input.periodId,
    firm_id: input.firmId,
    content_slot_id: input.contentSlotId,
    deliverable_id: input.deliverableId,
    source_version_id: input.sourceVersionId,
    asset_id: input.assetId,
    filename: input.filename,
    asset_role: input.assetRole,
    destination: input.destination,
    locale: input.locale,
    expected_hash: input.expectedHash,
    computed_hash: input.computedHash,
    previous_binding: input.previousBinding ?? null,
    resulting_binding: input.resultingBinding ?? null,
    actor_type: input.actorType,
    timestamp: new Date().toISOString(),
    outcome: input.outcome,
    failure_reason: input.outcome === "failure" ? input.failureReason : null,
  };

  return receipt;
}
