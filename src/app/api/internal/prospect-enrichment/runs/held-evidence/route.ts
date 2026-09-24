import { NextRequest, NextResponse } from "next/server";
import { prospectEnrichmentProtocolHash, stableProspectEnrichmentJson } from "@/lib/prospect-enrichment-hash";
import { readBoundedJson } from "@/lib/prospect-enrichment-auth";
import { isProspectEnrichmentAgentAuthorized, prospectEnrichmentAgentActor } from "@/lib/prospect-enrichment-agent-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nonempty = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> { return record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function response(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: noStore }); }

function validEvidence(value: unknown): value is Record<string, unknown> {
  if (!exact(value, ["schemaVersion", "runId", "entryId", "researchKey", "source", "originalJson", "issues", "evidenceSha256"])
    || value.schemaVersion !== "prospect-enrichment-held-candidate-evidence/v1" || !nonempty(value.runId, 200)
    || !nonempty(value.entryId, 200) || !nonempty(value.researchKey, 2000) || !hash(value.evidenceSha256)
    || !exact(value.source, ["sourceRoot", "relativePath", "sourcePointer", "fileSha256"])
    || !(value.source.sourceRoot === null || nonempty(value.source.sourceRoot, 2000))
    || !nonempty(value.source.relativePath, 4000) || typeof value.source.sourcePointer !== "string" || value.source.sourcePointer.length > 4000
    || !(value.source.fileSha256 === null || hash(value.source.fileSha256))
    || typeof value.originalJson !== "string" || value.originalJson.length === 0
    || !Array.isArray(value.issues) || value.issues.length > 500) return false;
  if (!value.issues.every((issue: unknown) => exact(issue, ["code", "path", "reason"])
    && nonempty(issue.code, 300) && typeof issue.path === "string" && issue.path.length <= 4000
    && typeof issue.reason === "string" && issue.reason.length <= 4000)) return false;
  try { if (stableProspectEnrichmentJson(JSON.parse(value.originalJson)) !== value.originalJson) return false; } catch { return false; }
  const core = { ...value };
  delete core.evidenceSha256;
  delete core.runId;
  return prospectEnrichmentProtocolHash(core) === value.evidenceSha256;
}

export async function POST(request: NextRequest) {
  if (!isProspectEnrichmentAgentAuthorized(request)) return response({ error: "Unauthorized" }, 401);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return response({ error: "Content-Type must be application/json." }, 400);
  const body = await readBoundedJson(request, 8_388_608);
  if (!body.ok) return response({ error: body.error }, body.status);
  if (!exact(body.value, ["evidence"]) || !validEvidence(body.value.evidence)) return response({ error: "The held-candidate evidence is invalid." }, 422);
  const evidence = body.value.evidence;
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  const expectedKey = "pe-held-evidence-v1-" + prospectEnrichmentProtocolHash([evidence.runId, evidence.entryId, evidence.evidenceSha256]);
  if (key !== expectedKey) return response({ error: "Idempotency-Key does not match this held-candidate evidence." }, 400);
  try {
    const { data, error } = await supabaseAdmin.rpc("record_prospect_enrichment_manifest_hold_evidence_v1", {
      p_submitted_by: prospectEnrichmentAgentActor(), p_run_key: evidence.runId, p_entry_id: evidence.entryId, p_evidence: evidence,
    });
    if (error) {
      const code = error.message?.split(":", 1)[0] ?? error.code ?? "database_unavailable";
      const status = code === "held_evidence_conflict" ? 409 : code === "invalid_held_evidence" ? 422 : 503;
      return response({ error: "Held-candidate evidence could not be durably recorded.", code }, status);
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    if (!record(receipt) || !["held_evidence_recorded", "held_evidence_replayed"].includes(String(receipt.outcome))
      || receipt.runId !== evidence.runId || receipt.entryId !== evidence.entryId || receipt.evidenceSha256 !== evidence.evidenceSha256) {
      return response({ error: "The database did not return an exact held-evidence receipt." }, 409);
    }
    return response(receipt, receipt.outcome === "held_evidence_recorded" ? 201 : 200);
  } catch {
    return response({ error: "Held-candidate evidence could not be durably recorded." }, 503);
  }
}
