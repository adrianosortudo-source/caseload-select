/**
 * CR-23: manifest export + gateway dry run (Section 19). The Publishing
 * Package Gateway binds exactly one thing -- content_deliverables.
 * hero_image_url -- via exactly one role, website_article_hero (see
 * docs/publication-operator/publishing-package-gateway.md, principle 6:
 * "must not become a generic publishing back door"). This module builds
 * the gateway's own hero-binding manifest shape from the Control Room's
 * richer package data, including ONLY assets the gateway can actually
 * bind, then validates the result with the gateway's OWN validator
 * (validatePublishingPackageManifest) -- export fails closed if that
 * validator itself would reject the manifest, rather than trusting this
 * module's own eligibility filter alone.
 */
import type { PackageManifest } from "@/lib/publishing-package-control-room-manifest";
import type { ControlRoomAssetDetail } from "@/lib/publishing-package-control-room-assets";
import {
  validatePublishingPackageManifest,
  type PublishingPackageManifest,
  type ManifestValidationError,
} from "@/lib/publishing-package-manifest";

const GATEWAY_ELIGIBLE_ROLE = "website_article_hero";
const GATEWAY_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set(["hash_verified", "uploaded"]);

export interface GatewayExportExclusion {
  assetId: string;
  contentSlotId: string;
  reason:
    | "not_selected" | "rejected" | "superseded" | "missing" | "already_bound"
    | "unsupported_role" | "deliverable_not_resolved" | "not_hash_verified";
}

export interface GatewayExportManifestResult {
  ok: boolean;
  manifest: PublishingPackageManifest | null;
  raw: { schema_version: 1; firm_id: string; operations: unknown[] };
  errors: ManifestValidationError[];
  included: string[]; // asset ids
  excluded: GatewayExportExclusion[];
}

function exclusionReasonFor(
  asset: ControlRoomAssetDetail,
  deliverableIdResolved: boolean,
): GatewayExportExclusion["reason"] | null {
  if (asset.asset_role !== GATEWAY_ELIGIBLE_ROLE) return "unsupported_role";
  if (!asset.is_selected) return "not_selected";
  if (asset.status === "rejected") return "rejected";
  if (asset.status === "superseded") return "superseded";
  if (asset.status === "missing") return "missing";
  if (asset.status === "bound" || asset.status === "rendered_verified" || asset.status === "release_ready") return "already_bound";
  if (!deliverableIdResolved) return "deliverable_not_resolved";
  if (!GATEWAY_ELIGIBLE_STATUSES.has(asset.status)) return "not_hash_verified"; // role is supported, stage isn't there yet (still "candidate"/"visually_selected")
  return null;
}

/**
 * Builds the gateway's own hero-binding manifest shape. `firmId` is
 * required separately because the gateway manifest is firm-scoped at the
 * top level (one firm per manifest), not derivable from an individual
 * asset row.
 */
export function buildGatewayExportManifest(
  firmId: string,
  manifest: PackageManifest,
  assets: ControlRoomAssetDetail[],
): GatewayExportManifestResult {
  const deliverableIdBySlot = new Map(manifest.pieces.map((p) => [p.contentSlotId, p.deliverableId]));

  const included: string[] = [];
  const excluded: GatewayExportExclusion[] = [];
  const operations: unknown[] = [];

  for (const asset of assets) {
    const deliverableId = deliverableIdBySlot.get(asset.content_slot_id) ?? null;
    const reason = exclusionReasonFor(asset, !!deliverableId);
    if (reason) {
      excluded.push({ assetId: asset.id, contentSlotId: asset.content_slot_id, reason });
      continue;
    }

    included.push(asset.id);
    operations.push({
      deliverable_id: deliverableId,
      expected_locale: asset.locale,
      expected_content_kind: "image",
      // Relative to the manifest's own folder -- never an absolute path,
      // never a caller-supplied storage key.
      asset_path: `assets/${asset.filename}`,
      expected_sha256: asset.sha256,
      alt_text: asset.alt_text,
    });
  }

  const raw = { schema_version: 1 as const, firm_id: firmId, operations };

  if (operations.length === 0) {
    return { ok: false, manifest: null, raw, errors: [{ path: "operations", message: "no gateway-eligible assets to export" }], included, excluded };
  }

  const validated = validatePublishingPackageManifest(raw);
  return {
    ok: validated.ok,
    manifest: validated.manifest,
    raw,
    errors: validated.errors,
    included,
    excluded,
  };
}

export interface ExportBundle {
  packageManifestJson: string;
  gatewayManifestJson: string | null;
  humanReadableSummary: string;
  blockerReport: string;
}

/** Section 19's 4 artifacts. Does not trigger any upload -- Export never has network side effects. */
export function buildExportBundle(
  firmId: string,
  manifest: PackageManifest,
  assets: ControlRoomAssetDetail[],
): ExportBundle {
  const gatewayResult = buildGatewayExportManifest(firmId, manifest, assets);

  const summaryLines = [
    `Package: ${manifest.pieces.length} pieces (expected ${manifest.expectedPieceCount})`,
    `Gateway-eligible operations: ${gatewayResult.included.length}`,
    `Excluded: ${gatewayResult.excluded.length}`,
  ];

  const blockerLines = gatewayResult.excluded.map(
    (e) => `${e.contentSlotId} (asset ${e.assetId}): excluded -- ${e.reason.replace(/_/g, " ")}`,
  );
  if (!gatewayResult.ok) {
    blockerLines.push(...gatewayResult.errors.map((e) => `gateway manifest invalid at ${e.path}: ${e.message}`));
  }

  return {
    packageManifestJson: JSON.stringify(manifest, null, 2),
    gatewayManifestJson: gatewayResult.ok ? JSON.stringify(gatewayResult.raw, null, 2) : null,
    humanReadableSummary: summaryLines.join("\n"),
    blockerReport: blockerLines.length > 0 ? blockerLines.join("\n") : "No blockers.",
  };
}

export interface DryRunOperationResult {
  index: number;
  deliverableId: string | null;
  eligible: boolean;
  reason: string | null;
}

export interface DryRunResult {
  ok: boolean;
  operations: DryRunOperationResult[];
  errors: ManifestValidationError[];
}

/**
 * Re-validates an already-built gateway export manifest and re-checks each
 * operation's structural eligibility. Makes zero network calls and zero
 * writes -- the real bind still only ever happens through
 * scripts/publishing-bind-heroes.mjs's own --dry-run flag or a real run,
 * never from this portal code.
 */
export function runAssetBindingDryRun(exportResult: GatewayExportManifestResult): DryRunResult {
  const revalidated = validatePublishingPackageManifest(exportResult.raw);
  const operations: DryRunOperationResult[] = (exportResult.raw.operations as Array<{ deliverable_id: unknown }>).map(
    (op, index) => ({
      index,
      deliverableId: typeof op.deliverable_id === "string" ? op.deliverable_id : null,
      eligible: revalidated.ok,
      reason: revalidated.ok ? null : "manifest failed gateway validation",
    }),
  );
  return { ok: revalidated.ok, operations, errors: revalidated.errors };
}
