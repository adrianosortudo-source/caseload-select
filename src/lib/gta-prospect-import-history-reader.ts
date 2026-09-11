import "server-only";

const RPC_NAME = "list_gta_prospect_import_history_for_operator";

type RpcError = { code?: string; message?: string } | null;
export type GtaProspectImportHistoryReaderClient = {
  rpc: (functionName: string) => Promise<{ data: unknown; error: RpcError }>;
};

export type GtaProspectImportHistoryItem = Readonly<{
  sourceName: string;
  sourceSha256: string;
  sourceRecordCount: number;
  state: "staged" | "applied" | "failed";
  appliedAt: string | null;
  createdAt: string;
}>;

function projectionError(message: string): Error {
  return new Error(`Invalid GTA prospect import-history projection: ${message}`);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}(?::?\d{2})?|Z)$/.test(value);
}

function parseItem(value: unknown): GtaProspectImportHistoryItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw projectionError("row is not an object");
  const row = value as Record<string, unknown>;
  const expected = ["source_name", "source_sha256", "source_record_count", "state", "applied_at", "created_at"];
  const unexpected = Object.keys(row).filter((key) => !expected.includes(key));
  if (unexpected.length) throw projectionError(`unexpected column(s): ${unexpected.join(", ")}`);
  if (typeof row.source_name !== "string" || !/^[-_a-z0-9]{1,200}$/.test(row.source_name)) throw projectionError("source_name is invalid");
  if (typeof row.source_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.source_sha256)) throw projectionError("source_sha256 is invalid");
  if (typeof row.source_record_count !== "number" || !Number.isInteger(row.source_record_count) || row.source_record_count < 0) throw projectionError("source_record_count is invalid");
  if (row.state !== "staged" && row.state !== "applied" && row.state !== "failed") throw projectionError("state is invalid");
  if (row.applied_at !== null && !isTimestamp(row.applied_at)) throw projectionError("applied_at is invalid");
  if (!isTimestamp(row.created_at)) throw projectionError("created_at is invalid");
  if ((row.state === "applied") !== (row.applied_at !== null)) throw projectionError("state and applied_at disagree");
  return {
    sourceName: row.source_name,
    sourceSha256: row.source_sha256,
    sourceRecordCount: row.source_record_count,
    state: row.state,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
  };
}

export async function listGtaProspectImportHistoryForOperator(
  client?: GtaProspectImportHistoryReaderClient,
): Promise<readonly GtaProspectImportHistoryItem[]> {
  const reader = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectImportHistoryReaderClient;
  })();
  const { data, error } = await reader.rpc(RPC_NAME);
  if (error) throw new Error(`Could not read GTA prospect import history: ${error.message ?? "unknown database error"}`);
  if (!Array.isArray(data) || data.length > 10) throw projectionError("RPC did not return at most ten rows");
  return Object.freeze(data.map(parseItem));
}
