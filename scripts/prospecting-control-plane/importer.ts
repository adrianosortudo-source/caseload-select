import type { ValidatedProspectManifest } from "./manifest";

export interface ProspectBatchRpcClient {
  rpc(
    name: "provision_prospect_source_batch",
    args: { p_manifest: Record<string, unknown>; p_operator_id: string; p_apply: boolean },
  ): PromiseLike<{ data: unknown; error: null | { message: string } }>;
}

export interface ProspectProvisioningResult {
  mode: "dry-run" | "apply";
  source_system: "prospecting_control_plane";
  counts: {
    input: number; BA: number; AE: number; existing: number; absent: number;
    provisioned: number; total_after: number; activities_before: number; activities_after: number;
  };
  assertions: {
    exact_record_count: true;
    exact_arm_split: true;
    canonical_bijection_after_apply: true | "not_applicable_dry_run";
    activity_count_unchanged: true;
    transaction: "rpc_read_only" | "rpc_atomic_apply";
  };
  records: Array<{
    cls_record_id: string;
    arm: "BA" | "AE";
    idempotency_key: string;
    state: "existing" | "absent" | "provisioned";
    source_link_id: string | null;
    conversation_id: string | null;
  }>;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function expectedIdempotencyKey(clsRecordId: string): string {
  return `prospecting_control_plane:provision:${clsRecordId}:v1`;
}

function parseResult(value: unknown, manifest: ValidatedProspectManifest): ProspectProvisioningResult {
  if (!object(value) || (value.mode !== "dry-run" && value.mode !== "apply")
    || value.source_system !== "prospecting_control_plane" || !object(value.counts)
    || !object(value.assertions) || !Array.isArray(value.records)) {
    throw new Error("Batch RPC returned an invalid receipt shape.");
  }
  const counts = value.counts;
  const assertions = value.assertions;
  const records = value.records;
  const countKeys = ["input", "BA", "AE", "existing", "absent", "provisioned", "total_after", "activities_before", "activities_after"] as const;
  if (countKeys.some((key) => !nonNegativeInteger(counts[key]))
    || counts.input !== 100 || counts.BA !== 50 || counts.AE !== 50) {
    throw new Error("Batch RPC returned invalid cohort counts.");
  }
  if (assertions.exact_record_count !== true || assertions.exact_arm_split !== true
    || assertions.activity_count_unchanged !== true
    || counts.activities_before !== counts.activities_after) {
    throw new Error("Batch RPC reported a changed activity count.");
  }
  const expected = new Map(manifest.records.map((record) => [record.cls_record_id, record]));
  const received = new Set<string>();
  let existingReceipts = 0;
  let absentReceipts = 0;
  let provisionedReceipts = 0;
  for (const receipt of records) {
    if (!object(receipt) || typeof receipt.cls_record_id !== "string" || received.has(receipt.cls_record_id)) {
      throw new Error("Batch RPC returned duplicate or invalid record receipts.");
    }
    const manifestRecord = expected.get(receipt.cls_record_id);
    if (!manifestRecord || receipt.arm !== manifestRecord.arm
      || receipt.idempotency_key !== expectedIdempotencyKey(receipt.cls_record_id)
      || (receipt.state !== "existing" && receipt.state !== "absent" && receipt.state !== "provisioned")) {
      throw new Error("Batch RPC returned a receipt that does not match the manifest identity.");
    }
    const hasIdentity = typeof receipt.source_link_id === "string" && receipt.source_link_id.length > 0
      && typeof receipt.conversation_id === "string" && receipt.conversation_id.length > 0;
    if ((receipt.state === "absent" && (receipt.source_link_id !== null || receipt.conversation_id !== null))
      || (receipt.state !== "absent" && !hasIdentity)) {
      throw new Error("Batch RPC returned an invalid source/conversation identity pair.");
    }
    received.add(receipt.cls_record_id);
    if (receipt.state === "existing") existingReceipts += 1;
    if (receipt.state === "absent") absentReceipts += 1;
    if (receipt.state === "provisioned") provisionedReceipts += 1;
  }
  if (records.length !== 100 || received.size !== 100 || received.size !== expected.size) {
    throw new Error("Batch RPC returned duplicate or invalid record receipts.");
  }
  if (counts.existing + counts.absent !== 100 || counts.existing !== existingReceipts) {
    throw new Error("Batch RPC receipt states do not match preflight counts.");
  }
  if (value.mode === "dry-run" && (counts.provisioned !== 0 || counts.total_after !== counts.existing
    || absentReceipts !== counts.absent || provisionedReceipts !== 0
    || assertions.canonical_bijection_after_apply !== "not_applicable_dry_run"
    || assertions.transaction !== "rpc_read_only")) {
    throw new Error("Batch RPC dry-run assertions are inconsistent.");
  }
  if (value.mode === "apply" && (counts.provisioned !== counts.absent || counts.total_after !== 100
    || absentReceipts !== 0 || provisionedReceipts !== counts.provisioned
    || assertions.canonical_bijection_after_apply !== true
    || assertions.transaction !== "rpc_atomic_apply")) {
    throw new Error("Batch RPC apply assertions are incomplete.");
  }
  return value as unknown as ProspectProvisioningResult;
}

/** Makes exactly one service-role RPC call; PostgreSQL owns the transaction. */
export async function executeProspectProvisioningRpc(
  client: ProspectBatchRpcClient,
  manifest: ValidatedProspectManifest,
  operatorId: string,
  apply: boolean,
): Promise<ProspectProvisioningResult> {
  const rpcManifest = {
    schema_version: manifest.schema_version,
    generated_at: manifest.generated_at,
    records: manifest.records,
  };
  const { data, error } = await client.rpc("provision_prospect_source_batch", {
    p_manifest: rpcManifest,
    p_operator_id: operatorId,
    p_apply: apply,
  });
  if (error) throw new Error(error.message);
  const result = parseResult(data, manifest);
  if (result.mode !== (apply ? "apply" : "dry-run")) throw new Error("Batch RPC mode does not match the requested mode.");
  if (apply && (result.counts.total_after !== 100 || result.assertions.canonical_bijection_after_apply !== true
    || result.assertions.transaction !== "rpc_atomic_apply")) throw new Error("Batch RPC apply assertions are incomplete.");
  if (!apply && result.assertions.transaction !== "rpc_read_only") throw new Error("Batch RPC dry-run did not report the read-only path.");
  return result;
}
