import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { getDeliverableDetail } from "@/lib/deliverables";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type { PublicationArtifactAssetRole } from "@/lib/types";

const VALID_ROLES = new Set<PublicationArtifactAssetRole>([
  "website_article_hero_overlay",
  "website_homepage_cta_textless",
]);

function isAssetRole(value: unknown): value is PublicationArtifactAssetRole {
  return typeof value === "string" && VALID_ROLES.has(value as PublicationArtifactAssetRole);
}

/**
 * Explicitly place one historical, unassigned website image into one of the
 * two canonical website slots. This creates an append-only assignment record;
 * it never edits the historical publication_artifacts row or copies the file.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string; artifactId: string }> },
) {
  const { firmId, deliverableId, artifactId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "operator access required" }, { status: 403 });
  }
  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const assetRole = (body as { assetRole?: unknown } | null)?.assetRole;
  if (!isAssetRole(assetRole)) {
    return NextResponse.json({ error: "invalid website image role" }, { status: 400 });
  }

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId || detail.deliverable.deliverable_role !== "article") {
    return NextResponse.json({ error: "website article not found" }, { status: 404 });
  }
  const currentVersionId = detail.deliverable.current_version_id;
  if (!currentVersionId) return NextResponse.json({ error: "article has no current version" }, { status: 409 });

  const { data: artifact, error: artifactError } = await supabase
    .from("publication_artifacts")
    .select("*")
    .eq("id", artifactId)
    .eq("firm_id", firmId)
    .eq("deliverable_id", deliverableId)
    .maybeSingle();
  if (artifactError) return NextResponse.json({ error: "could not load artifact" }, { status: 500 });
  if (!artifact) return NextResponse.json({ error: "artifact not found" }, { status: 404 });
  if (artifact.version_id !== currentVersionId || artifact.artifact_type !== "hero_image") {
    return NextResponse.json({ error: "artifact is not a current website image" }, { status: 409 });
  }
  if (artifact.superseded_at || artifact.asset_role) {
    return NextResponse.json({ error: "artifact is already assigned or retracted" }, { status: 409 });
  }

  const { data: priorAssignment, error: priorError } = await supabase
    .from("publication_artifact_role_assignments")
    .select("id")
    .eq("artifact_id", artifactId)
    .is("superseded_at", null)
    .maybeSingle();
  if (priorError) return NextResponse.json({ error: "could not check artifact assignment" }, { status: 500 });
  if (priorAssignment) return NextResponse.json({ error: "artifact already has a placement" }, { status: 409 });

  const { data: occupiedSlot, error: slotError } = await supabase
    .from("publication_artifact_role_assignments")
    .select("id")
    .eq("deliverable_id", deliverableId)
    .eq("version_id", currentVersionId)
    .eq("asset_role", assetRole)
    .is("superseded_at", null)
    .maybeSingle();
  if (slotError) return NextResponse.json({ error: "could not check placement slot" }, { status: 500 });
  if (occupiedSlot) return NextResponse.json({ error: "that placement already has an image" }, { status: 409 });

  const { error: insertError } = await supabase.from("publication_artifact_role_assignments").insert({
    firm_id: firmId,
    artifact_id: artifactId,
    deliverable_id: deliverableId,
    version_id: currentVersionId,
    asset_role: assetRole,
    assigned_by_role: "operator",
    assigned_by_id: resolved.actor.id,
  });
  if (insertError) {
    if (insertError.code === "23505") return NextResponse.json({ error: "that placement is already occupied" }, { status: 409 });
    return NextResponse.json({ error: "could not save placement" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, assetRole });
}
