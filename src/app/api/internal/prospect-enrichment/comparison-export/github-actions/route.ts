import { NextRequest } from "next/server";
import { prospectEnrichmentJson } from "@/lib/prospect-enrichment-auth";
import { verifyProspectComparisonWorkflowToken } from "@/lib/prospect-enrichment-github-oidc";
import { CASEY_MOSS_HELD_EVIDENCE_RECOVERY } from "../../../../../../scripts/prospect-enrichment/manifest-delivery";
import { handleComparisonExport } from "../../../../admin/prospect-enrichment/comparison-export/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.length > 17_000 || !/^Bearer [A-Za-z0-9._-]+$/.test(authorization)) return prospectEnrichmentJson({ error: "Unauthorized" }, 401);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "") || (request.headers.get("content-encoding") ?? "identity").toLowerCase() !== "identity") return prospectEnrichmentJson({ error: "A canonical JSON request is required." }, 400);
  let identity;
  try { identity = await verifyProspectComparisonWorkflowToken(authorization.slice(7)); }
  catch {
    console.info("[prospect-comparison-machine-audit]", JSON.stringify({ outcome: "authentication_rejected" }));
    return prospectEnrichmentJson({ error: "Unauthorized" }, 401);
  }
  const response = await handleComparisonExport(request, "bootstrap", identity);
  console.info("[prospect-comparison-machine-audit]", JSON.stringify({
    outcome: response.status >= 200 && response.status < 300 ? "read_complete" : "read_rejected",
    repository: identity.repository, repositoryId: identity.repositoryId, ref: identity.ref, sha: identity.sha,
    workflowRef: identity.workflowRef, environment: identity.environment, eventName: identity.eventName,
    runId: identity.runId, runAttempt: identity.runAttempt, jtiSha256: identity.jtiSha256, httpStatus: response.status,
    requestSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.comparisonRequestSha256,
    sourceManifestSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.sourceManifestSha256,
    runManifestSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256,
  }));
  return response;
}
