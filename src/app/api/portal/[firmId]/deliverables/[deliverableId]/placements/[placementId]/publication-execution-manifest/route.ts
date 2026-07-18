/**
 * GET /api/portal/[firmId]/deliverables/[deliverableId]/placements/[placementId]/publication-execution-manifest
 *
 * Publication Operator, Workstreams 1-3: the dry-run report for one
 * placement. Read-only, operator-only, no request body accepted. Assembles
 * the PublicationExecutionManifest (publication-execution-manifest.ts) from
 * stored immutable records only, then reports:
 *   - preflightStatus: the 7-way classification (publication-preflight-
 *     status.ts) -- ready / blocked_content / blocked_missing_configuration
 *     / blocked_authorization / blocked_destination_validation /
 *     already_published / ambiguous_external_state.
 *   - configuration: whether the destination account/integration is
 *     configured (publication-adapter.ts's validateConfiguration).
 *   - dryRun: the exact, redacted action shape that WOULD be taken
 *     (renderDryRun) -- endpoint/method/payload preview, never executed.
 *
 * This route never calls claim_placement_for_publish, never writes a
 * publication_receipts row, and never calls an adapter's execute (which is
 * itself structurally disabled this release regardless). It is the
 * Publication Operator's answer to "what would happen if we published
 * this, right now" -- nothing more.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { loadPublicationExecutionManifest } from "@/lib/publication-execution-manifest-loader";
import { getPublicationAdapter } from "@/lib/publication-adapter";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string; placementId: string }> },
) {
  const { firmId, deliverableId, placementId } = await params;

  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "operator session required" }, { status: 403 });
  }

  const result = await loadPublicationExecutionManifest(firmId, placementId, {
    role: "operator",
    id: resolved.actor.id ?? null,
    name: resolved.actor.name ?? null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { manifest } = result;
  if (manifest.deliverableId !== deliverableId) {
    return NextResponse.json({ error: "placement does not belong to this deliverable" }, { status: 404 });
  }

  const adapter = getPublicationAdapter(manifest.destination);

  return NextResponse.json({
    ok: true,
    manifest,
    preflightStatus: adapter.preflight(manifest),
    configuration: adapter.validateConfiguration(manifest),
    dryRun: adapter.renderDryRun(manifest),
  });
}
