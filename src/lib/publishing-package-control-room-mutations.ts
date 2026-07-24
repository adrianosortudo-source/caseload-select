/**
 * CR-16: asset mutation actions (Section 11 operator actions + Section 18
 * receipts). Every function: (1) loads the package, (2) loads/validates
 * the target row(s), (3) runs the relevant pure guard -- any guard failure
 * returns before any write, (4) performs the single write, (5) appends one
 * publishing_package_events row via buildEventReceipt.
 *
 * NOT UNIT TESTED against a real database in this build -- no migration is
 * applied anywhere and no local Postgres exists in this environment. The
 * pure guards this module calls (checkSha256Shape,
 * checkCandidateNotSuperseded, checkSingleSelectedCandidate) each have
 * their own full test coverage in publishing-package-control-room-
 * manifest.test.ts; the route handlers that call these functions are
 * tested against a MOCKED version of this module (see the
 * package-assets/__tests__ files), not against this module's own DB
 * round-trips. That gap closes only once a real database exists to test
 * against -- see docs/publishing/weekly-package-control-room.md's Known
 * limits.
 */
import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  validatePackageManifest,
  checkSha256Shape,
  checkCandidateNotSuperseded,
  checkSingleSelectedCandidate,
  type AssetGuardCandidate,
  type AssetRole,
  type PackageLocale,
  type TextPolicy,
  type OverlayLanguage,
} from "@/lib/publishing-package-control-room-manifest";
import { buildEventReceipt } from "@/lib/publishing-package-events";
import { loadControlRoomPackage, type ControlRoomPackageResult } from "@/lib/publishing-package-control-room-loader";
import { assembleOverviewViewModel } from "@/lib/publishing-package-control-room-overview";
import { assembleReleaseGates, type PublicationInputs, type PieceReleaseGates } from "@/lib/publishing-package-control-room-release";

export type MutationResult = { ok: true; assetId: string } | { ok: false; error: string };
export type CreateManifestResult =
  | { ok: true; packageId: string; manifestRevision: number }
  | { ok: false; error: string };
export type PreflightRunResult =
  | { ok: true; piecesClear: number; piecesBlocked: number; packageStatus: string }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface PackageRow {
  id: string;
  manifest: unknown;
}

async function loadPackageRow(firmId: string, periodId: string): Promise<PackageRow | { error: string }> {
  const res = await supabase
    .from("publishing_packages")
    .select("id, manifest")
    .eq("firm_id", firmId)
    .eq("period_id", periodId)
    .order("manifest_revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error || !res.data) return { error: "package not found" };
  return { id: res.data.id as string, manifest: res.data.manifest };
}

function isPackageRow(v: PackageRow | { error: string }): v is PackageRow {
  return "id" in v;
}

interface AssetRow {
  id: string;
  content_slot_id: string;
  asset_role: AssetRole;
  locale: PackageLocale;
  destination: string;
  overlay_language: OverlayLanguage | null;
  width: number | null;
  height: number | null;
  sha256: string;
  filename: string;
  status: AssetGuardCandidate["status"];
  is_selected: boolean;
}

function toGuardCandidate(row: AssetRow): AssetGuardCandidate {
  return {
    id: row.id,
    role: row.asset_role,
    locale: row.locale,
    destination: row.destination,
    overlayLanguage: row.overlay_language,
    width: row.width ?? 0,
    height: row.height ?? 0,
    sha256: row.sha256,
    status: row.status,
    isSelected: row.is_selected,
  };
}

async function appendEvent(input: {
  packageId: string; periodId: string; firmId: string; contentSlotId: string | null;
  assetId: string | null; eventType: string; actorType: string;
  filename?: string | null; assetRole?: string | null; destination?: string | null; locale?: string | null;
  expectedHash?: string | null; computedHash?: string | null;
  extra?: Record<string, unknown>;
}) {
  const receipt = buildEventReceipt({
    packageId: input.packageId, periodId: input.periodId, firmId: input.firmId,
    contentSlotId: input.contentSlotId, deliverableId: null, sourceVersionId: null,
    assetId: input.assetId,
    filename: input.filename ?? null, assetRole: input.assetRole ?? null,
    destination: input.destination ?? null, locale: input.locale ?? null,
    expectedHash: input.expectedHash ?? null, computedHash: input.computedHash ?? null,
    previousBinding: null,
    resultingBinding: input.extra ?? null, actorType: input.actorType,
    outcome: "success", failureReason: null,
  });
  const { error } = await supabase.from("publishing_package_events").insert({
    package_id: input.packageId, firm_id: input.firmId, period_id: input.periodId,
    content_slot_id: input.contentSlotId, asset_id: input.assetId,
    event_type: input.eventType, actor_type: input.actorType,
    operation_id: receipt.operation_id, receipt,
  });
  return error;
}

export interface RegisterCandidateInput {
  contentSlotId: string; assetRole: AssetRole; locale: PackageLocale; destination: string;
  filename: string; mimeType: string; byteSize: number; width: number; height: number;
  sha256: string; altText: string; textPolicy: TextPolicy; overlayLanguage: OverlayLanguage | null;
}

export async function registerCandidate(
  firmId: string, periodId: string, input: RegisterCandidateInput,
): Promise<MutationResult> {
  // Pure input-shape checks first, before any DB call -- none of these
  // need the package or manifest, so there's no reason to pay for a query
  // just to reject a request that was never going to insert anything.
  if (!input.altText || input.altText.trim().length === 0) return { ok: false, error: "alt_text is required" };
  if (!input.filename || input.filename.trim().length === 0) return { ok: false, error: "filename is required" };
  if (!input.mimeType || input.mimeType.trim().length === 0) return { ok: false, error: "mime_type is required" };
  if (!(input.byteSize > 0)) return { ok: false, error: "byte_size must be a positive number" };
  if (input.assetRole !== "pdf_document" && !(input.width > 0 && input.height > 0)) {
    return { ok: false, error: "width and height must be positive for image assets" };
  }
  const shaCheck = checkSha256Shape(input.sha256);
  if (!shaCheck.ok) return { ok: false, error: shaCheck.reason! };

  const pkg = await loadPackageRow(firmId, periodId);
  if (!isPackageRow(pkg)) return { ok: false, error: pkg.error };

  const validated = validatePackageManifest(pkg.manifest);
  if (!validated.ok) return { ok: false, error: "stored manifest failed validation" };

  const piece = validated.manifest.pieces.find((p) => p.contentSlotId === input.contentSlotId);
  const requirement = piece?.requiredAssets.find(
    (r) => r.assetRole === input.assetRole && r.destination === input.destination,
  );
  if (!piece || !requirement) return { ok: false, error: "no matching requirement in manifest" };
  if (input.locale !== requirement.locale) return { ok: false, error: "locale does not match the requirement's locale" };

  const insertRes = await supabase
    .from("publishing_package_assets")
    .insert({
      package_id: pkg.id, firm_id: firmId, period_id: periodId,
      content_slot_id: input.contentSlotId, asset_role: input.assetRole,
      locale: input.locale, destination: input.destination,
      filename: input.filename, mime_type: input.mimeType, byte_size: input.byteSize,
      width: input.width, height: input.height, sha256: input.sha256,
      alt_text: input.altText, text_policy: input.textPolicy, overlay_language: input.overlayLanguage,
      status: "candidate", is_selected: false,
    })
    .select("id")
    .single();
  if (insertRes.error || !insertRes.data) return { ok: false, error: `insert failed: ${insertRes.error?.message}` };

  const eventError = await appendEvent({
    packageId: pkg.id, periodId, firmId, contentSlotId: input.contentSlotId,
    assetId: insertRes.data.id as string, eventType: "candidate_registered", actorType: "operator",
    filename: input.filename, assetRole: input.assetRole, destination: input.destination, locale: input.locale,
    expectedHash: input.sha256, computedHash: input.sha256,
  });
  if (eventError) return { ok: false, error: `mutation succeeded but receipt append failed: ${eventError.message}` };

  return { ok: true, assetId: insertRes.data.id as string };
}

export async function selectCandidate(firmId: string, periodId: string, assetId: string): Promise<MutationResult> {
  const pkg = await loadPackageRow(firmId, periodId);
  if (!isPackageRow(pkg)) return { ok: false, error: pkg.error };

  const targetRes = await supabase
    .from("publishing_package_assets")
    .select("*")
    .eq("id", assetId)
    .eq("package_id", pkg.id)
    .maybeSingle();
  if (targetRes.error || !targetRes.data) return { ok: false, error: "asset not found" };
  const target = targetRes.data as AssetRow;

  const supersededCheck = checkCandidateNotSuperseded(toGuardCandidate(target));
  if (!supersededCheck.ok) return { ok: false, error: supersededCheck.reason! };

  // Non-atomic by necessity: supabase-js has no transactions here, so this
  // is a clear-then-set, not a single write. Clear runs FIRST (not
  // set-first) so that if this call dies between the two steps, the group
  // is left with zero selected candidates -- a fail-closed state nothing
  // downstream mistakes for a valid selection -- rather than transiently
  // having two candidates selected at once. The next successful select
  // call repairs it; checkSingleSelectedCandidate below is a post-write
  // assertion, not a guarantee this sequence enforces on its own.
  const clearRes = await supabase
    .from("publishing_package_assets")
    .update({ is_selected: false, updated_at: new Date().toISOString() })
    .eq("package_id", pkg.id)
    .eq("content_slot_id", target.content_slot_id)
    .eq("asset_role", target.asset_role)
    .eq("destination", target.destination)
    .eq("is_selected", true)
    .neq("id", assetId);
  if (clearRes.error) return { ok: false, error: `failed to clear prior selection: ${clearRes.error.message}` };

  const updateRes = await supabase
    .from("publishing_package_assets")
    .update({ is_selected: true, status: "visually_selected", updated_at: new Date().toISOString() })
    .eq("id", assetId);
  if (updateRes.error) return { ok: false, error: `select failed: ${updateRes.error.message}` };

  const groupRes = await supabase
    .from("publishing_package_assets")
    .select("*")
    .eq("package_id", pkg.id)
    .eq("content_slot_id", target.content_slot_id)
    .eq("asset_role", target.asset_role)
    .eq("destination", target.destination);
  if (!groupRes.error && groupRes.data) {
    const singleCheck = checkSingleSelectedCandidate((groupRes.data as AssetRow[]).map(toGuardCandidate));
    if (!singleCheck.ok) return { ok: false, error: `mutation succeeded but post-write invariant failed: ${singleCheck.reason}` };
  }

  const eventError = await appendEvent({
    packageId: pkg.id, periodId, firmId, contentSlotId: target.content_slot_id,
    assetId, eventType: "candidate_selected", actorType: "operator",
    filename: target.filename, assetRole: target.asset_role, destination: target.destination, locale: target.locale,
    expectedHash: target.sha256, computedHash: target.sha256,
  });
  if (eventError) return { ok: false, error: `mutation succeeded but receipt append failed: ${eventError.message}` };

  return { ok: true, assetId };
}

export async function rejectCandidate(
  firmId: string, periodId: string, assetId: string, reason: string,
): Promise<MutationResult> {
  if (!reason || reason.trim().length === 0) return { ok: false, error: "a rejection reason is required" };

  const pkg = await loadPackageRow(firmId, periodId);
  if (!isPackageRow(pkg)) return { ok: false, error: pkg.error };

  const targetRes = await supabase
    .from("publishing_package_assets")
    .select("id, content_slot_id, asset_role, locale, destination, filename, sha256")
    .eq("id", assetId)
    .eq("package_id", pkg.id)
    .maybeSingle();
  if (targetRes.error || !targetRes.data) return { ok: false, error: "asset not found" };
  const target = targetRes.data as Pick<AssetRow, "id" | "content_slot_id" | "asset_role" | "locale" | "destination" | "filename" | "sha256">;

  const updateRes = await supabase
    .from("publishing_package_assets")
    .update({ status: "rejected", is_selected: false, updated_at: new Date().toISOString() })
    .eq("id", assetId);
  if (updateRes.error) return { ok: false, error: `reject failed: ${updateRes.error.message}` };

  const eventError = await appendEvent({
    packageId: pkg.id, periodId, firmId, contentSlotId: target.content_slot_id,
    assetId, eventType: "asset_rejected", actorType: "operator", extra: { rejection_reason: reason },
    filename: target.filename, assetRole: target.asset_role, destination: target.destination, locale: target.locale,
    expectedHash: target.sha256, computedHash: target.sha256,
  });
  if (eventError) return { ok: false, error: `mutation succeeded but receipt append failed: ${eventError.message}` };

  return { ok: true, assetId };
}

export async function supersedeCandidate(
  firmId: string, periodId: string, assetId: string, replacementAssetId: string,
): Promise<MutationResult> {
  if (!replacementAssetId || !UUID_RE.test(replacementAssetId)) {
    return { ok: false, error: "a replacement asset reference is required" };
  }

  const pkg = await loadPackageRow(firmId, periodId);
  if (!isPackageRow(pkg)) return { ok: false, error: pkg.error };

  const targetRes = await supabase
    .from("publishing_package_assets")
    .select("id, content_slot_id, asset_role, locale, destination, filename, sha256")
    .eq("id", assetId)
    .eq("package_id", pkg.id)
    .maybeSingle();
  if (targetRes.error || !targetRes.data) return { ok: false, error: "asset not found" };
  const target = targetRes.data as Pick<AssetRow, "id" | "content_slot_id" | "asset_role" | "locale" | "destination" | "filename" | "sha256">;

  const replacementRes = await supabase
    .from("publishing_package_assets")
    .select("id")
    .eq("id", replacementAssetId)
    .eq("package_id", pkg.id)
    .maybeSingle();
  if (replacementRes.error || !replacementRes.data) return { ok: false, error: "replacement asset not found in this package" };

  const updateRes = await supabase
    .from("publishing_package_assets")
    .update({ status: "superseded", is_selected: false, updated_at: new Date().toISOString() })
    .eq("id", assetId);
  if (updateRes.error) return { ok: false, error: `supersede failed: ${updateRes.error.message}` };

  const eventError = await appendEvent({
    packageId: pkg.id, periodId, firmId, contentSlotId: target.content_slot_id,
    assetId, eventType: "asset_superseded", actorType: "operator",
    extra: { superseded_by: replacementAssetId },
    filename: target.filename, assetRole: target.asset_role, destination: target.destination, locale: target.locale,
    expectedHash: target.sha256, computedHash: target.sha256,
  });
  if (eventError) return { ok: false, error: `mutation succeeded but receipt append failed: ${eventError.message}` };

  return { ok: true, assetId };
}

/**
 * The activation path: creates the first (or a revised) publishing_packages
 * row for a period. Validated with the same pure validator every other
 * surface trusts (validatePackageManifest), a firm_id/period_id
 * cross-check against the route's own params (so an operator can't paste
 * another firm's manifest into this period even if it's internally valid),
 * and a real existence check against content_periods before any write.
 */
export async function createPackageManifest(
  firmId: string, periodId: string, rawManifest: unknown, expectedPieceCount: number,
): Promise<CreateManifestResult> {
  const validated = validatePackageManifest(rawManifest);
  if (!validated.ok) {
    const summary = validated.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join("; ");
    return { ok: false, error: `manifest failed validation: ${summary}` };
  }

  if (validated.manifest.firmId !== firmId || validated.manifest.periodId !== periodId) {
    return { ok: false, error: "manifest firm_id/period_id must match this period" };
  }

  const periodRes = await supabase
    .from("content_periods")
    .select("id")
    .eq("id", periodId)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (periodRes.error || !periodRes.data) return { ok: false, error: "period not found for this firm" };

  const latestRes = await supabase
    .from("publishing_packages")
    .select("manifest_revision")
    .eq("firm_id", firmId)
    .eq("period_id", periodId)
    .order("manifest_revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestRes.error) return { ok: false, error: `failed to check existing revisions: ${latestRes.error.message}` };

  const manifestRevision = ((latestRes.data?.manifest_revision as number | undefined) ?? 0) + 1;

  const insertRes = await supabase
    .from("publishing_packages")
    .insert({
      firm_id: firmId, period_id: periodId, manifest_revision: manifestRevision,
      schema_version: 1, expected_piece_count: expectedPieceCount,
      status: "draft", manifest: rawManifest,
    })
    .select("id")
    .single();
  if (insertRes.error || !insertRes.data) return { ok: false, error: `insert failed: ${insertRes.error?.message}` };

  const packageId = insertRes.data.id as string;
  const manifestEventError = await appendEvent({
    packageId, periodId, firmId, contentSlotId: null, assetId: null,
    eventType: manifestRevision === 1 ? "manifest_created" : "manifest_revised",
    actorType: "operator", extra: { manifest_revision: manifestRevision },
  });
  if (manifestEventError) return { ok: false, error: `mutation succeeded but receipt append failed: ${manifestEventError.message}` };

  return { ok: true, packageId, manifestRevision };
}

/**
 * Pure row-builder for publishing_package_checks, kept separate from
 * runPackagePreflight so it's testable without a database. Every row uses
 * asset_scope: "piece" (none of these checks are asset-scoped yet -- see
 * the migration's own comment on why asset_id itself can't serve as the
 * dedup discriminator). checked_at is omitted deliberately: the column
 * defaults to now() in Postgres, and every other timestamp in this schema
 * is stamped by the database, not the app.
 *
 * Severity mapping: any failing Asset or Publication check is "critical"
 * (these two gates are the ones that actually block a real release --
 * missing/blocked assets and missing authorization); a failing Editorial
 * or Experience check is "high"; every passing check is "informational".
 */
export function buildPreflightCheckRows(
  packageId: string,
  pieces: PieceReleaseGates[],
): Record<string, unknown>[] {
  const checkRows: Record<string, unknown>[] = [];
  for (const piece of pieces) {
    for (const gate of piece.gates) {
      for (const check of gate.checks) {
        const severity =
          check.status === "pass"
            ? "informational"
            : gate.gate === "asset" || gate.gate === "publication"
              ? "critical"
              : "high";
        checkRows.push({
          package_id: packageId,
          content_slot_id: piece.contentSlotId,
          asset_id: null,
          asset_scope: "piece",
          check_key: check.checkKey,
          status: check.status,
          severity,
          message: check.message,
          evidence: { reason_code: check.reasonCode, piece_title: piece.pieceTitle },
          checked_by_type: "operator",
        });
      }
    }
  }
  return checkRows;
}

/**
 * Runs preflight for a package, persists every check to
 * publishing_package_checks (one upsert call, onConflict on the table's
 * own unique key), updates publishing_packages.status, and appends
 * package_preflight_run (always) + package_release_ready (only when every
 * piece passes). Accepts an optional pre-loaded package result so a
 * caller that already loaded it (the route, to derive deliverableIds for
 * loadPublicationInputs) doesn't pay for a second identical query.
 */
export async function runPackagePreflight(
  firmId: string, periodId: string, publicationInputs: PublicationInputs,
  preloaded?: ControlRoomPackageResult,
): Promise<PreflightRunResult> {
  const result = preloaded ?? (await loadControlRoomPackage(firmId, periodId));
  if (!result) return { ok: false, error: "package not found" };

  const overview = assembleOverviewViewModel(
    result.manifest, result.packageStatus,
    result.assets.map((a) => ({ id: a.id, status: a.status, filename: a.filename })),
  );
  const pieces = assembleReleaseGates(overview, result.manifest, publicationInputs);

  const checkRows = buildPreflightCheckRows(result.packageId, pieces);

  const upsertRes = await supabase
    .from("publishing_package_checks")
    .upsert(checkRows, { onConflict: "package_id,content_slot_id,asset_scope,check_key" });
  if (upsertRes.error) return { ok: false, error: `checks upsert failed: ${upsertRes.error.message}` };

  const piecesClear = pieces.filter((p) => p.allPass).length;
  const piecesBlocked = pieces.length - piecesClear;
  const packageStatus = piecesBlocked === 0 ? "release_ready" : "release_blocked";

  const statusRes = await supabase
    .from("publishing_packages")
    .update({ status: packageStatus, updated_at: new Date().toISOString() })
    .eq("id", result.packageId);
  if (statusRes.error) return { ok: false, error: `status update failed: ${statusRes.error.message}` };

  const preflightEventError = await appendEvent({
    packageId: result.packageId, periodId, firmId, contentSlotId: null, assetId: null,
    eventType: "package_preflight_run", actorType: "operator",
    extra: { pieces_clear: piecesClear, pieces_blocked: piecesBlocked, package_status: packageStatus },
  });
  if (preflightEventError) return { ok: false, error: `preflight ran but receipt append failed: ${preflightEventError.message}` };

  if (packageStatus === "release_ready") {
    const readyEventError = await appendEvent({
      packageId: result.packageId, periodId, firmId, contentSlotId: null, assetId: null,
      eventType: "package_release_ready", actorType: "operator",
      extra: { pieces_clear: piecesClear },
    });
    if (readyEventError) return { ok: false, error: `preflight ran but release-ready receipt append failed: ${readyEventError.message}` };
  }

  return { ok: true, piecesClear, piecesBlocked, packageStatus };
}
