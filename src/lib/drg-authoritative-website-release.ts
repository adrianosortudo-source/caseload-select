import "server-only";

import {
  buildContentExportBundle,
  type ContentExportBundle,
  type ContentExportDeliverable,
} from "@/lib/content-period-export";
import {
  buildDrgWebsitePackageExport,
  type DrgDoctrinePin,
  type DrgWebsitePackageBuildInput,
  type DrgWebsitePackageExport,
  type DrgWebsitePieceSelection,
} from "@/lib/drg-package-protocol";
import { verifyDrgReleaseAuthorizationEnvelope } from "@/lib/drg-release-authorization-envelope";
import { loadConfiguredDrgReleaseAuthorizationSigner } from "@/lib/drg-release-authorization-envelope-server";

const WEBSITE_PIECES = [
  { pieceId: "CN-EN", locale: "en-CA", role: "counsel_note" },
  { pieceId: "CN-PT", locale: "pt-BR", role: "counsel_note" },
  { pieceId: "CIM-EN", locale: "en-CA", role: "clause_in_margin" },
  { pieceId: "CIM-PT", locale: "pt-BR", role: "clause_in_margin" },
  { pieceId: "CHECKLIST-LANDING-EN", locale: "en-CA", role: "checklist" },
  { pieceId: "CHECKLIST-LANDING-PT", locale: "pt-BR", role: "checklist" },
] as const;

// These are the exact staging doctrine pins. Changing any one is a protocol
// change and must move through the stacked PRs rather than through a request.
export const DRG_AUTHORITATIVE_WEBSITE_DOCTRINE: readonly DrgDoctrinePin[] = Object.freeze([
  { id: "DRGLaw_ContentStrategy", version: "4.18", sha256: "7435afd74244ceef85be3d29f8b69ab11e5d72b5f9b3453502f84e6cf372c69e" },
  { id: "DRGLaw_BrandBook", version: "13", sha256: "9bc8594764cd242c498dab1b1d3ec194289cae4411c930750bf5819c11cec818" },
  { id: "DRG_Terminology", version: "2", sha256: "0f39469b752c043f3d7bc0ca3351a544c2d12d0a139ee1eaf47fcb982d374d16" },
  { id: "DECISION_RECORDS", version: "DR-118", sha256: "289fadf02782af6b3af35079b29d2d056233687deae416011a6dae6738884d37" },
]);

export type AuthoritativeDrgWebsiteReleaseResult =
  | { ok: true; release: DrgWebsitePackageExport }
  | { ok: false; error: string };

function slugFromRoute(route: string): string | null {
  const segments = route.split("/").filter(Boolean);
  const slug = segments.at(-1) ?? "";
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}

function requiredStructuredData(role: DrgWebsitePieceSelection["role"]): string[] {
  return [role === "checklist" ? "WebPage" : "Article", "BreadcrumbList"];
}

function buildInput(bundle: ContentExportBundle): DrgWebsitePackageBuildInput | string {
  const rawEnvelope = bundle.release_authorization_envelope;
  if (!rawEnvelope) return "authoritative export did not issue a release authorization envelope";
  let envelope;
  try {
    envelope = verifyDrgReleaseAuthorizationEnvelope(rawEnvelope).envelope;
  } catch (error) {
    return `authoritative release envelope verification failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  const deliverableById = new Map(bundle.deliverables.map((item) => [item.id, item]));
  const snapshotByPiece = new Map(envelope.pieces.map((item) => [item.piece_id, item]));
  const resolved = new Map<string, { definition: (typeof WEBSITE_PIECES)[number]; deliverable: ContentExportDeliverable; route: string; slug: string }>();
  for (const definition of WEBSITE_PIECES) {
    const snapshot = snapshotByPiece.get(definition.pieceId);
    const deliverable = snapshot ? deliverableById.get(snapshot.deliverable_id) : undefined;
    if (!snapshot || !deliverable || deliverable.current_version_id !== snapshot.current_version_id) return `website projection source is missing exact current ${definition.pieceId}`;
    if (deliverable.locale !== definition.locale || deliverable.publication_destination !== "firm_website" || !deliverable.publication_path?.startsWith("/")) return `website placement is incomplete for ${definition.pieceId}`;
    const slug = slugFromRoute(deliverable.publication_path);
    if (!slug) return `website route slug is invalid for ${definition.pieceId}`;
    resolved.set(definition.pieceId, { definition, deliverable, route: deliverable.publication_path, slug });
  }
  const pieces: DrgWebsitePieceSelection[] = [];
  for (const item of resolved.values()) {
    const counterpartId = WEBSITE_PIECES.find((candidate) => candidate.role === item.definition.role && candidate.locale !== item.definition.locale)?.pieceId;
    const counterpart = counterpartId ? resolved.get(counterpartId) : null;
    if (!counterpart) return `localized counterpart is missing for ${item.definition.pieceId}`;
    const alternateRoutes = item.definition.locale === "en-CA"
      ? { "en-CA": item.route, "pt-BR": counterpart.route }
      : { "en-CA": counterpart.route, "pt-BR": item.route };
    pieces.push({
      piece_id: item.definition.pieceId,
      deliverable_id: item.deliverable.id,
      deliverable_version_id: item.deliverable.current_version_id!,
      locale: item.definition.locale,
      role: item.definition.role,
      slug: item.slug,
      route: item.route,
      expected_metadata: {
        canonical_route: item.route,
        alternate_routes: alternateRoutes,
        required_structured_data: requiredStructuredData(item.definition.role),
      },
    });
  }
  return {
    package_id: envelope.package.id,
    package_version: envelope.package.version,
    doctrine: DRG_AUTHORITATIVE_WEBSITE_DOCTRINE.map((pin) => ({ ...pin })),
    source_versions: envelope.pieces.map((piece) => ({
      source_id: piece.piece_id,
      source_kind: "package_piece_source" as const,
      version: String(piece.version_number),
      sha256: piece.source_sha256,
    })),
    pieces,
    dependencies: [
      { piece_id: "CIM-EN", depends_on_piece_id: "CN-EN" },
      { piece_id: "CHECKLIST-LANDING-EN", depends_on_piece_id: "CN-EN" },
      { piece_id: "CIM-PT", depends_on_piece_id: "CN-PT" },
      { piece_id: "CHECKLIST-LANDING-PT", depends_on_piece_id: "CN-PT" },
    ],
  };
}

/**
 * The real operator release path. It owns every authority-bearing input:
 * current versions, package identity, holds, client authorization, routes,
 * content, assets, doctrine and source pins. No request body can reconstruct
 * or assert either signed authorization.
 */
export async function buildAuthoritativeDrgWebsiteRelease(
  periodId: string,
): Promise<AuthoritativeDrgWebsiteReleaseResult> {
  const result = await buildContentExportBundle(periodId, { issueReleaseAuthorization: true });
  if (!result.ok) return result;
  const input = buildInput(result.bundle);
  if (typeof input === "string") return { ok: false, error: input };
  let signer;
  try {
    signer = loadConfiguredDrgReleaseAuthorizationSigner();
  } catch (error) {
    return { ok: false, error: `website projection signer is unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
  const projected = buildDrgWebsitePackageExport(result.bundle, input, signer);
  if (!projected.ok) return { ok: false, error: projected.errors.map((item) => `${item.path}: ${item.message}`).join("; ") };
  return { ok: true, release: projected.value };
}
