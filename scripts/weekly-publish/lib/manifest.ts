/**
 * Phase 2.2 (Appendix B): build this week's publishing_packages manifest.
 * Ported from ToDelete/kit-build-manifest.mts (Standing Rule 4): same
 * structural-mirror-of-canon approach, config-driven instead of hardcoded,
 * validated with the REAL app validator imported directly (Phase 0.3 proved
 * publishing-package-control-room-manifest.ts has no server-only guard --
 * no verbatim copy needed, unlike the one-off script's _validator-verbatim-
 * copy.mts workaround for running from ToDelete/ as cwd).
 *
 * Read-only: queries content_deliverables for live title/current_version_id
 * per piece, builds the manifest object, and validates it. Never writes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePackageManifest } from "../../../src/lib/publishing-package-control-room-manifest";
import { buildRequiredAssets, CTA_DOWNLOAD, CTA_NONE, type RequiredAssetShape } from "../canon/manifest-shapes";
import type { WeekConfig } from "../config";

export interface RawManifestPiece {
  content_slot_id: string;
  deliverable_id: string;
  source_deliverable_id: string;
  source_version_id: string | null;
  reader_title: string;
  format_family: string;
  locale: string;
  destination: string;
  body_relationship: string;
  required_assets: RequiredAssetShape[];
  cta: { label: null; target: null; behavior: string; required: boolean };
  pdf_asset_id: null;
  planned_publish_at: null;
  placement_status: string;
  approval_status: string;
}

export interface RawManifest {
  schema_version: 1;
  firm_id: string;
  period_id: string;
  expected_piece_count: number;
  revision: number;
  pieces: RawManifestPiece[];
}

export interface BuildManifestResult {
  ok: boolean;
  manifest: RawManifest | null;
  errors: { path: string; message: string }[];
}

export async function buildManifest(
  supabase: SupabaseClient,
  weekConfig: WeekConfig,
): Promise<BuildManifestResult> {
  const ids = weekConfig.pieces.map((p) => p.deliverableId);
  const { data: rows, error } = await supabase
    .from("content_deliverables")
    .select("id, title, current_version_id")
    .in("id", ids);
  if (error) throw new Error(`deliverable lookup failed: ${error.message}`);
  if (!rows || rows.length !== ids.length) {
    throw new Error(`expected ${ids.length} deliverables, found ${rows?.length ?? 0}`);
  }
  const byId = new Map(rows.map((r) => [r.id as string, r as { id: string; title: string; current_version_id: string | null }]));

  const manifest: RawManifest = {
    schema_version: 1,
    firm_id: weekConfig.firmId,
    period_id: weekConfig.periodId,
    expected_piece_count: weekConfig.expectedPieceCount,
    revision: 1,
    pieces: weekConfig.pieces.map((piece) => {
      const d = byId.get(piece.deliverableId);
      if (!d) throw new Error(`deliverable ${piece.deliverableId} (slot ${piece.contentSlotId}) not found`);
      return {
        content_slot_id: piece.contentSlotId,
        deliverable_id: piece.deliverableId,
        source_deliverable_id: piece.deliverableId,
        source_version_id: d.current_version_id,
        reader_title: d.title,
        format_family: piece.formatFamily,
        locale: piece.locale,
        destination: piece.destination,
        body_relationship: weekConfig.bodyRelationship,
        required_assets: buildRequiredAssets(piece.assetShape, piece.locale),
        cta: piece.cta === "download" ? CTA_DOWNLOAD : CTA_NONE,
        pdf_asset_id: null,
        planned_publish_at: null,
        placement_status: "not_placed",
        approval_status: "in_review",
      };
    }),
  };

  const result = validatePackageManifest(manifest);
  return { ok: result.ok, manifest: result.ok ? manifest : null, errors: result.errors };
}
