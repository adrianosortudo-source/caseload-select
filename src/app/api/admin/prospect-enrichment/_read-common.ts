import "server-only";
import type { NextRequest } from "next/server";
import { prospectEnrichmentJson, requireProspectEnrichmentOperator, unexpectedEnrichmentError } from "@/lib/prospect-enrichment-auth";
import { ProspectEnrichmentReadError } from "@/lib/prospect-enrichment-reader";

export const READ_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ReadDiagnostic = Readonly<{ databaseErrorCode: string | null; dataShape: string; callSite: string[] }>;
export class ReadApiError extends Error {
  constructor(message: string, readonly status: 404 | 422 | 503 = 503, readonly diagnostic?: ReadDiagnostic) { super(message); this.name = "ReadApiError"; }
}
export function readId(value: unknown): string { if (typeof value !== "string" || !READ_UUID.test(value)) throw new ReadApiError("A valid database UUID is required.", 422); return value.toLowerCase(); }
export function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function requiredText(value: unknown, name: string): string { if (typeof value !== "string" || !value.length) throw new ReadApiError("The stored " + name + " is incomplete."); return value; }
export function nullableText(value: unknown, name: string): string | null { return value === null ? null : requiredText(value, name); }
export function databaseRows(result: { data: unknown; error: unknown }): Record<string, unknown>[] {
  if (result.error || !Array.isArray(result.data) || result.data.some((item) => !isRecord(item))) {
    const errorCode = isRecord(result.error) && typeof result.error.code === "string" ? result.error.code : null;
    const callSite = new Error().stack?.split("\n").slice(2, 6).map((line) => line.trim()) ?? [];
    const dataShape = Array.isArray(result.data) ? `array:${result.data.length}` : result.data === null ? "null" : typeof result.data;
    if (result.error) {
      console.error("[prospect-enrichment] database read unavailable", { errorCode, callSite });
    }
    throw new ReadApiError("Research records could not be loaded.", 503, { databaseErrorCode: errorCode, dataShape, callSite });
  }
  return result.data as Record<string, unknown>[];
}
export function readQuery(request: NextRequest, allowed: readonly string[]): URLSearchParams {
  const params = request.nextUrl.searchParams;
  for (const [key, value] of params) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new ReadApiError("Unknown or repeated query parameter.", 422);
    if (value.length > 2048 || !value.length) throw new ReadApiError("Query parameters must be nonempty and bounded.", 422);
  }
  return params;
}
export function readLimit(params: URLSearchParams): number {
  const raw = params.get("limit"); if (raw === null) return 25;
  if (!/^[1-9][0-9]{0,2}$/.test(raw) || Number(raw) > 100) throw new ReadApiError("Page size must be an integer from 1 to 100.", 422);
  return Number(raw);
}
export function opaqueCursor(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value)) throw new ReadApiError("The pagination cursor is invalid.", 422);
  return value;
}
export function encodeCursor(value: Record<string, string>): string { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
export function decodeCursor(value: string | undefined, kind: string, scope: string): Record<string, string> | null {
  if (!value) return null;
  try {
    const result = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isRecord(result) || result.kind !== kind || result.scope !== scope || Object.values(result).some((item) => typeof item !== "string")) throw new Error();
    return result as Record<string, string>;
  } catch { throw new ReadApiError("The pagination cursor does not belong to this view.", 422); }
}
export function datedCursor(value: string | undefined, kind: string, scope: string) {
  const cursor = decodeCursor(value, kind, scope); if (!cursor) return null;
  if (Object.keys(cursor).sort().join(",") !== "createdAt,id,kind,scope" || !READ_UUID.test(cursor.id) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(cursor.createdAt) || !Number.isFinite(Date.parse(cursor.createdAt))) throw new ReadApiError("The pagination cursor is invalid.", 422);
  return cursor;
}
export async function readRoute(request: NextRequest, operation: string, work: () => Promise<unknown>) {
  try {
    const auth = await requireProspectEnrichmentOperator(request);
    if (!auth.ok) return auth.response;
    if (auth.operator.session.role !== "operator") return prospectEnrichmentJson({ error: "An operator session is required." }, 403);
    return prospectEnrichmentJson(await work());
  } catch (cause) {
    if (cause instanceof ReadApiError) return prospectEnrichmentJson({ error: cause.message, ...(process.env.PROSPECT_ENRICHMENT_TEST_DIAGNOSTICS === "1" && cause.diagnostic ? { diagnostic: cause.diagnostic } : {}) }, cause.status);
    if (cause instanceof ProspectEnrichmentReadError) return prospectEnrichmentJson({ error: cause.message, errorId: cause.errorId }, cause.status);
    return prospectEnrichmentJson(unexpectedEnrichmentError(operation), 503);
  }
}
