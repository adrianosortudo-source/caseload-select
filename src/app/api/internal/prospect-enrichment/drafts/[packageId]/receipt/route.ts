import { NextRequest } from "next/server";
import { getProspectEnrichmentOperatorReceipt } from "@/lib/prospect-enrichment-store";
import { isProspectEnrichmentAgentAuthorized, prospectEnrichmentAgentActor } from "@/lib/prospect-enrichment-agent-auth";
import { PROSPECT_ENRICHMENT_NO_STORE_HEADERS } from "@/lib/prospect-enrichment-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: PROSPECT_ENRICHMENT_NO_STORE_HEADERS });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ packageId: string }> },
) {
  if (!isProspectEnrichmentAgentAuthorized(request)) return json({ error: "Not found." }, 404);
  const { packageId } = await context.params;
  if (!uuid.test(packageId)) return json({ error: "Not found." }, 404);
  try {
    const receipt = await getProspectEnrichmentOperatorReceipt({
      packageId,
      submittedBy: prospectEnrichmentAgentActor(),
    });
    if (!receipt) return json({ error: "Not found." }, 404);
    return json(receipt);
  } catch {
    return json({ error: "The research receipt could not be loaded." }, 503);
  }
}
