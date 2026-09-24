import { NextRequest, NextResponse } from "next/server";

import { parseProspectEnrichmentEnvelope, PROSPECT_ENRICHMENT_MAX_BODY_BYTES, PROSPECT_ENRICHMENT_SCHEMA_VERSION } from "@/lib/prospect-enrichment-contract";
import { stageGtaProspectAgentDraft } from "@/lib/gta-prospect-agent-draft-inbox";
import { readBoundedJson } from "@/lib/prospect-enrichment-auth";
import { isProspectEnrichmentAgentAuthorized, prospectEnrichmentAgentActor } from "@/lib/prospect-enrichment-agent-auth";
import { prospectEnrichmentIdempotencyKey } from "@/lib/prospect-enrichment-hash";
import { ProspectEnrichmentStoreError, stageProspectEnrichmentPackage } from "@/lib/prospect-enrichment-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

type JsonRecord = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

function legacyPayload(value: unknown): { sourceName: string; records: unknown[]; sourceSha256?: string } | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Expected a JSON object with sourceName and records." };
  const item = value as JsonRecord;
  const unexpected = Object.keys(item).filter((key) => !["sourceName", "records", "sourceSha256"].includes(key));
  if (unexpected.length) return { error: `Unexpected field(s): ${unexpected.join(", ")}.` };
  if (typeof item.sourceName !== "string" || !Array.isArray(item.records)) return { error: "sourceName and records are required." };
  if (item.sourceSha256 !== undefined && (typeof item.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sourceSha256))) return { error: "sourceSha256 must be a lowercase SHA-256 value when supplied." };
  return { sourceName: item.sourceName, records: item.records, sourceSha256: item.sourceSha256 as string | undefined };
}

/**
 * Bounded external intake. A valid token may stage a reviewed public-evidence
 * package, but this route cannot create firms, contacts, CRM entries, messages,
 * contact submissions, chat sessions, outreach, or canonical imports.
 */
export async function POST(request: NextRequest) {
  if (!isProspectEnrichmentAgentAuthorized(request)) return json({ error: "Unauthorized" }, 401);
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  const body = await readBoundedJson(request, PROSPECT_ENRICHMENT_MAX_BODY_BYTES);
  if (!body.ok) return json({ error: body.error }, body.status);
  if (body.value && typeof body.value === "object" && !Array.isArray(body.value) && Object.prototype.hasOwnProperty.call(body.value, "schemaVersion")) {
    const candidate = body.value as JsonRecord;
    if (candidate.schemaVersion !== PROSPECT_ENRICHMENT_SCHEMA_VERSION) return json({ error: "Unsupported prospect-enrichment schema version." }, 400);
    const parsed = parseProspectEnrichmentEnvelope(candidate);
    if (!parsed.ok) {
      const hasUnknownKey = parsed.issues.some((issue) => issue.message === "unrecognized field is forbidden");
      return json({ error: hasUnknownKey ? "The prospect-enrichment package contains an unrecognized field." : "The prospect-enrichment package is structurally invalid.", issues: parsed.issues }, hasUnknownKey ? 400 : 422);
    }
    if (key !== prospectEnrichmentIdempotencyKey(parsed.envelope.sourceSystem, parsed.envelope.runId, parsed.envelope.packageId)) {
      return json({ error: "Idempotency-Key does not match this immutable run and package." }, 400);
    }
    try {
      const receipt = await stageProspectEnrichmentPackage({ submittedBy: prospectEnrichmentAgentActor(), rawBody: body.text, envelope: parsed.envelope });
      return json({
        packageId: receipt.packageId,
        clientPackageId: receipt.clientPackageId,
        runId: receipt.runId,
        payloadSha256: receipt.payloadSha256,
        state: receipt.state,
        identityState: receipt.identityState,
        counts: receipt.counts,
        receivedAt: receipt.receivedAt,
        receiptUrl: `/api/internal/prospect-enrichment/drafts/${encodeURIComponent(receipt.packageId)}/receipt`,
      }, receipt.outcome === "created" ? 201 : 200);
    } catch (error) {
      if (error instanceof ProspectEnrichmentStoreError) return json({ error: error.message, code: error.code }, error.status);
      console.error("[prospect-enrichment] stage failed", { code: "unexpected" });
      return json({ error: "The research package could not be staged." }, 503);
    }
  }

  const parsed = legacyPayload(body.value);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  try {
    const receipt = await stageGtaProspectAgentDraft({
      submittedBy: prospectEnrichmentAgentActor(), sourceName: parsed.sourceName, idempotencyKey: key,
      records: parsed.records, expectedPayloadSha256: parsed.sourceSha256,
    });
    return json({
      mode: receipt.state, draftId: receipt.draftId, payloadSha256: receipt.payloadSha256,
      state: receipt.review.summary.invalid || receipt.review.summary.duplicate || receipt.review.summary.reviewRequired ? "review_required" : "ready_for_operator",
      summary: receipt.review.summary,
      note: "The package is private staging only. An operator must review and explicitly import it before any prospect record changes.",
    }, receipt.state === "created" ? 201 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The AI draft could not be staged.";
    const status = /^(submittedBy|sourceName|Idempotency-Key|sourceSha256|Submit)\b/.test(message) ? 400 : 503;
    console.error("[gta-prospect-agent-draft-inbox] stage failed", error);
    return json({ error: message, note: "No prospect, contact, CRM, or outreach record was changed." }, status);
  }
}
