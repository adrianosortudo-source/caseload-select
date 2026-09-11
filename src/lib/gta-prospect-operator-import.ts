import "server-only";

import type { CanonicalRecord, GtaProspectImportPlan } from "@/lib/gta-prospect-research-import";

type RpcError = { message?: string } | null;
export type GtaProspectOperatorImportClient = {
  rpc: (functionName: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
};

export type GtaProspectOperatorImportReceipt = Readonly<{
  sourceRecordKey: string;
  state: "created" | "updated" | "already_present" | "already_applied";
  publicContacts: number;
}>;

export type GtaProspectOperatorImportResult = Readonly<{
  state: "applied" | "already_applied";
  sourceSha256: string;
  receipts: readonly GtaProspectOperatorImportReceipt[];
}>;

const SOURCE_NAME_PATTERN = /^[-_a-z0-9]{1,200}$/;

function rpcError(error: RpcError, fallback: string): Error {
  return new Error(error?.message ?? fallback);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBatchStart(value: unknown): { state: "ready" | "already_applied"; batchId: string } {
  if (!isObject(value) || (value.state !== "ready" && value.state !== "already_applied") || typeof value.batch_id !== "string") {
    throw new Error("The GTA prospect import batch RPC returned an invalid receipt.");
  }
  return { state: value.state, batchId: value.batch_id };
}

function parseApplyReceipt(value: unknown, sourceRecordKey: string): GtaProspectOperatorImportReceipt {
  if (!isObject(value) || (value.state !== "created" && value.state !== "updated" && value.state !== "already_present") || typeof value.public_contacts !== "number") {
    throw new Error(`${sourceRecordKey}: the GTA prospect import RPC returned an invalid record receipt.`);
  }
  return {
    sourceRecordKey,
    state: value.state,
    publicContacts: value.public_contacts,
  };
}

/**
 * Server-only writer for a previously reviewed GTA research batch. It uses
 * only the ledger's service-role RPC boundary. Browser code cannot call these
 * operations or obtain a service key.
 */
export async function applyGtaProspectOperatorImport({
  sourceName,
  plan,
  client,
}: Readonly<{
  sourceName: string;
  plan: GtaProspectImportPlan;
  client?: GtaProspectOperatorImportClient;
}>): Promise<GtaProspectOperatorImportResult> {
  if (!SOURCE_NAME_PATTERN.test(sourceName)) {
    throw new Error("sourceName must use 1-200 lowercase letters, numbers, hyphens, or underscores.");
  }
  if (plan.rejected.length > 0) {
    throw new Error("Invalid GTA prospect records cannot be applied.");
  }

  const db = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectOperatorImportClient;
  })();
  const started = await db.rpc("begin_gta_prospect_operator_import_batch", {
    p_source_name: sourceName,
    p_source_sha256: plan.sourceSha256,
    p_source_record_count: plan.accepted.length,
  });
  if (started.error) throw rpcError(started.error, "Could not begin the GTA prospect import batch.");
  const batch = parseBatchStart(started.data);
  if (batch.state === "already_applied") {
    return {
      state: "already_applied",
      sourceSha256: plan.sourceSha256,
      receipts: Object.freeze(plan.accepted.map((record) => ({ sourceRecordKey: record.sourceRecordKey, state: "already_applied" as const, publicContacts: record.publicContacts.length }))),
    };
  }

  const receipts: GtaProspectOperatorImportReceipt[] = [];
  try {
    for (const record of plan.accepted) {
      const hash = await db.rpc("gta_prospect_research_record_with_contacts_sha256", { p_record: record });
      if (hash.error || typeof hash.data !== "string") throw rpcError(hash.error, `${record.sourceRecordKey}: could not canonicalize record.`);
      const applied = await db.rpc("apply_gta_prospect_research_record_with_contacts", {
        p_batch_id: batch.batchId,
        p_record: record,
        p_record_sha256: hash.data,
      });
      if (applied.error) throw rpcError(applied.error, `${record.sourceRecordKey}: could not apply record.`);
      receipts.push(parseApplyReceipt(applied.data, record.sourceRecordKey));
    }
  } catch (error) {
    const failed = await db.rpc("fail_gta_prospect_import_batch", { p_batch_id: batch.batchId });
    if (failed.error) throw new Error(`Import failed and its batch could not be marked failed: ${failed.error.message ?? "unknown database error"}`);
    throw error;
  }

  const completed = await db.rpc("complete_gta_prospect_import_batch", { p_batch_id: batch.batchId });
  if (completed.error) throw rpcError(completed.error, "Could not complete the GTA prospect import batch.");
  return { state: "applied", sourceSha256: plan.sourceSha256, receipts: Object.freeze(receipts) };
}

export function defaultGtaProspectImportSourceName(sourceName: unknown): string | null {
  if (typeof sourceName !== "string") return null;
  const normalized = sourceName.trim().toLocaleLowerCase("en-CA");
  return SOURCE_NAME_PATTERN.test(normalized) ? normalized : null;
}

/** A narrow adapter keeps import routes from serializing private canonical fields by accident. */
export function importRecordSummary(record: CanonicalRecord): Readonly<{ sourceRecordKey: string; firmName: string; city: string }> {
  return { sourceRecordKey: record.sourceRecordKey, firmName: record.firmName, city: record.city };
}
