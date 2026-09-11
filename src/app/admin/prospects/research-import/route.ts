import { NextResponse } from "next/server";

import { applyGtaProspectOperatorImport, defaultGtaProspectImportSourceName, importRecordSummary } from "@/lib/gta-prospect-operator-import";
import { listGtaProspectImportHistoryForOperator } from "@/lib/gta-prospect-import-history-reader";
import { reviewGtaProspectImport } from "@/lib/gta-prospect-research-import";
import { listGtaProspectResearchForOperator } from "@/lib/gta-prospect-research-reader";
import { getOperatorSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

const MAX_RECORDS = 2_000;
const DEFAULT_SOURCE_NAME = "gta-operator-upload";
const noStore = { "Cache-Control": "private, no-store" };
const unauthorizedStatus = { status: 401 };

type ImportRequest = Readonly<{
  sourceName: string;
  records: unknown[];
  sourceSha256?: string;
}>;

function parseRequest(payload: unknown): { request: ImportRequest } | { error: string; status: number } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { error: "Expected a JSON object with a records array.", status: 400 };
  const raw = payload as { records?: unknown; sourceName?: unknown; sourceSha256?: unknown };
  if (!Array.isArray(raw.records)) return { error: "Expected a records array.", status: 400 };
  if (raw.records.length > MAX_RECORDS) return { error: `At most ${MAX_RECORDS.toLocaleString("en-CA")} research records may be reviewed at once.`, status: 413 };
  const sourceName = raw.sourceName === undefined ? DEFAULT_SOURCE_NAME : defaultGtaProspectImportSourceName(raw.sourceName);
  if (!sourceName) return { error: "sourceName must use 1-200 lowercase letters, numbers, hyphens, or underscores.", status: 400 };
  if (raw.sourceSha256 !== undefined && (typeof raw.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.sourceSha256))) {
    return { error: "sourceSha256 must be a lowercase SHA-256 hex value.", status: 400 };
  }
  return { request: { sourceName, records: raw.records, sourceSha256: raw.sourceSha256 as string | undefined } };
}

async function requestPayload(request: Request): Promise<{ request: ImportRequest } | { error: string; status: number }> {
  try { return parseRequest(await request.json()); }
  catch { return { error: "Expected a JSON body with a records array.", status: 400 }; }
}

async function review(request: ImportRequest) {
  const existing = await listGtaProspectResearchForOperator();
  return reviewGtaProspectImport(request.records, new Set(existing.map((record) => record.id)));
}

/** Operator-only, read-only metadata for the last ten reviewed import batches. */
export async function GET() {
  if (!(await getOperatorSession())) return NextResponse.json({ error: "Unauthorized" }, { ...unauthorizedStatus, headers: noStore });
  try {
    return NextResponse.json({ history: await listGtaProspectImportHistoryForOperator() }, { headers: noStore });
  } catch (error) {
    console.error("[gta-prospect-research] operator import history failed", error);
    return NextResponse.json({ error: "GTA prospect import history could not be loaded." }, { status: 503, headers: noStore });
  }
}

/**
 * Operator-only, zero-write import review. A browser may use this endpoint to
 * present the outcome before a separate explicit apply request. It never
 * returns raw audit records, service credentials, CRM data, or outreach state.
 */
export async function POST(request: Request) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: "Unauthorized" }, { ...unauthorizedStatus, headers: noStore });
  const parsed = await requestPayload(request);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: noStore });
  try {
    const result = await review(parsed.request);
    return NextResponse.json({
      mode: "dry_run",
      sourceName: parsed.request.sourceName,
      sourceSha256: result.plan.sourceSha256,
      summary: result.summary,
      records: result.records,
      accepted: result.plan.accepted.map(importRecordSummary),
      rejected: result.plan.rejected,
    }, { headers: noStore });
  } catch (error) {
    console.error("[gta-prospect-research] operator import review failed", error);
    return NextResponse.json({ error: "GTA prospect records could not be reviewed against the current ledger." }, { status: 503, headers: noStore });
  }
}

/**
 * Explicit, operator-gated apply endpoint. It re-runs validation and the
 * ledger comparison server-side: a browser cannot promote an earlier dry run
 * into a write by changing its payload or omitting an identity-review gate.
 */
export async function PUT(request: Request) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: "Unauthorized" }, { ...unauthorizedStatus, headers: noStore });
  const parsed = await requestPayload(request);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: noStore });
  try {
    const result = await review(parsed.request);
    if (parsed.request.sourceSha256 !== result.plan.sourceSha256) {
      return NextResponse.json({ error: "The reviewed file changed. Run review again before applying it.", sourceSha256: result.plan.sourceSha256 }, { status: 409, headers: noStore });
    }
    if (result.summary.invalid || result.summary.duplicate || result.summary.reviewRequired) {
      return NextResponse.json({
        error: "Resolve invalid, duplicate, and identity-review records before applying this batch.",
        sourceSha256: result.plan.sourceSha256,
        summary: result.summary,
        records: result.records,
      }, { status: 422, headers: noStore });
    }
    const applied = await applyGtaProspectOperatorImport({ sourceName: parsed.request.sourceName, plan: result.plan });
    return NextResponse.json({
      mode: applied.state,
      sourceName: parsed.request.sourceName,
      sourceSha256: applied.sourceSha256,
      summary: result.summary,
      receipts: applied.receipts,
    }, { headers: noStore });
  } catch (error) {
    console.error("[gta-prospect-research] operator import apply failed", error);
    return NextResponse.json({ error: "GTA prospect records could not be applied. No CRM, outreach, or contact action was attempted." }, { status: 503, headers: noStore });
  }
}
