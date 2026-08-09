/**
 * Content Studio: the session-independent publishing export.
 *
 * A read-only, period-scoped "publishing bundle": every existing
 * deliverable and its exact, already-stored content_deliverables /
 * deliverable_versions / approval_records / deliverable_comments /
 * publication_artifacts source, so an operator or a publishing agent can
 * retrieve exactly what already exists in the client portal without
 * searching the filesystem, guessing asset locations, or regenerating
 * anything.
 *
 * This is a SEPARATE feature from Publication Readiness (publication-
 * readiness.ts / publication-manifest.ts / publication-readiness-loader.ts)
 * and does not import from, extend, or require it. It reads the same
 * content_deliverables columns Publication Readiness also reads
 * (deliverable_role, locale, publication_destination, publication_path)
 * because those columns are just data on the table, independent of
 * whichever period-lifecycle/enforcement state that other feature layers
 * on top -- this bundle exports them "where available" regardless of
 * whether Publication Readiness exists, is merged, or is activated for
 * this period.
 *
 * It also does not depend on the separate content_pieces / Content Studio
 * drafting system's approval-identity re-render checks
 * (checkApprovalIdentity in content-studio.ts): that system re-renders and
 * byte-compares content tied to a specific content_pieces row. This bundle
 * is about content_deliverables directly (the portal-facing approval
 * system every deliverable goes through, whether or not it originated in
 * Content Studio). Nothing is re-rendered, hashed, or compared.
 *
 * "may_publish" is NOT computed from the deliverable row alone. It is
 * delegated to isVersionReleaseAuthorized (release-authorization.ts), the
 * canonical two-path bar: individual approval of the exact current version,
 * OR the firm's active standing publishing authorization when that version
 * is not flagged requires_individual_review. The second path is firm-level
 * state that lives nowhere on content_deliverables, which is why an earlier
 * version of this module -- which did compute may_publish from
 * status/approved_version_id/current_version_id alone -- reported every
 * standing-authorized piece as unpublishable.
 *
 * Every function here is read-only. Nothing in this module ever writes to
 * Supabase.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { shouldWithholdArtifactLinks } from "@/lib/artifact-links";
import { isVersionReleaseAuthorized } from "@/lib/release-authorization";
import { getStandingAuthorizationState } from "@/lib/standing-publishing-authorization";
import { loadUnresolvedClientChangeHoldVersionIds } from "@/lib/deliverable-client-change-holds";
import type {
  ContentDeliverable,
  DeliverableVersion,
  DeliverableComment,
  ApprovalRecord,
  PublicationArtifact,
  PublicationArtifactRoleAssignment,
  PublicationArtifactValidation,
} from "@/lib/types";

const ASSET_BUCKET = "firm-files";
const SIGNED_URL_TTL = 3600; // 1 hour, matching deliverables.ts's existing convention

export const CONTENT_EXPORT_SCHEMA_VERSION = "1.1";

export interface ContentExportVersionBody {
  id: string;
  version_number: number;
  body_html: string | null;
  /** Durable identity: the storage bucket this storage_path lives in, so the bundle is self-describing without the source constant. Null only when storage_path is null. */
  storage_bucket: string | null;
  storage_path: string | null;
  signed_url: string | null;
  /**
   * When signed_url expires (ISO 8601), null when signed_url is null. This
   * is a temporary access convenience, never durable evidence: storage_path
   * / asset_sha256 / asset_mime / asset_size_bytes are the canonical asset
   * identity and never expire. To get a fresh signed_url after expiry,
   * re-request this same endpoint; every GET re-signs from the current
   * storage_path with a new TTL, so there is nothing to "renew" separately.
   */
  signed_url_expires_at: string | null;
  asset_mime: string | null;
  asset_size_bytes: number | null;
  asset_name: string | null;
  asset_sha256: string | null;
  note: string | null;
  responds_to_approval_id: string | null;
  created_at: string;
}

export interface ContentExportArtifactValidation {
  validator: string;
  result: string;
  created_at: string;
}

export interface ContentExportArtifact {
  id: string;
  /**
   * The deliverable version this artifact was registered against. An artifact
   * is evidence for ONE version: a crop cut for v2 is not evidence for v5.
   * Consumers must compare this against the version they are publishing and
   * never present a non-matching artifact as current.
   */
  version_id: string;
  artifact_type: string;
  asset_role?: string | null;
  locale: string | null;
  destination: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  public_url: string | null;
  sha256: string | null;
  size_bytes: number | null;
  /** MIME type recorded on the artifact row, when known. */
  mime_type: string | null;
  /**
   * Temporary download URL for this artifact, signed at read time from
   * storage_path. Null when the artifact has no storage_path (e.g. a
   * webpage artifact recorded by URL only) or when signing failed.
   * Never durable evidence: storage_path / sha256 are the canonical
   * identity. Re-request this export to get a fresh URL.
   */
  signed_url: string | null;
  /** When signed_url expires (ISO 8601); null when signed_url is null. */
  signed_url_expires_at: string | null;
  /**
   * When this artifact row was created. A unique partial index enforces at
   * most one ACTIVE artifact per (deliverable, version, artifact_type,
   * locale, destination) slot -- replacing an artifact for the same slot
   * requires stamping superseded_at on the prior row first, not inserting a
   * second active row. created_at is the tie-break among rows sharing a
   * slot (active vs. superseded is the primary discriminator; see
   * superseded_at below and publish-kit-pure.ts's dedupeArtifacts).
   */
  created_at: string;
  /**
   * When this artifact was retracted, or null when it is active. A
   * superseded row is historical evidence only and is never publishable: a
   * publication receipt referencing a superseded artifact is rejected at the
   * database level.
   */
  superseded_at: string | null;
  /** True when this artifact's version_id equals the deliverable's current_version_id. */
  matches_current_version: boolean;
  /** Most recent reconciliation result recorded against this artifact, if any. */
  latest_validation: ContentExportArtifactValidation | null;
}

/**
 * Why a specific version was held back for individual sign-off, populated only
 * when the current version carries requires_individual_review = true.
 *
 * This is a DELIBERATE act by a named role, not a system state, and it is the
 * one thing that overrides an active standing publishing authorization
 * unconditionally (see release-authorization.ts). Exported so a consumer can
 * show the operator *why a colleague held this piece* rather than only the
 * mechanical fact that a flag is set -- without it the Publish Kit rendered a
 * version UUID and the word "flagged", which reads as a system fault rather
 * than as a decision someone made on purpose.
 */
export interface ContentExportIndividualReviewHold {
  reason: string | null;
  set_by_role: string | null;
  set_by_name: string | null;
  set_at: string | null;
}

export interface ContentExportChangeRequest {
  approval_record_id: string;
  requested_at: string;
  signer_name: string;
  note: string | null;
}

export interface ContentExportComment {
  id: string;
  author_role: string;
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface ContentExportDeliverable {
  id: string;
  title: string;
  /** Editorial format/category label, e.g. "Counsel Note", "Google Business Profile". */
  format: string | null;
  /** Publication channel, when recorded: article | social_post | gbp_post | lead_magnet_pdf | landing_page. */
  channel: string | null;
  locale: string | null;
  content_kind: string;
  status: string;
  publish_date: string | null;
  current_version_id: string | null;
  approved_version_id: string | null;
  is_current_version_approved: boolean;
  may_publish: boolean;
  /** Exact reason when may_publish is false; null when may_publish is true. */
  may_publish_reason: string | null;
  current_version: ContentExportVersionBody | null;
  /** Populated only when the approved version differs from the current version. */
  approved_version: ContentExportVersionBody | null;
  /** Non-null only when the CURRENT version is flagged requires_individual_review. */
  individual_review_hold: ContentExportIndividualReviewHold | null;
  publication_destination: string | null;
  publication_path: string | null;
  /**
   * For deliverable_role gbp_post and social_post ONLY: the on-site path this
   * post promotes. publication_path is null for those two roles, so this is
   * the only destination a hand-posted piece has. Null for every other role.
   * See types.ts ContentDeliverable.cta_target_path (DR-097).
   */
  cta_target_path: string | null;
  artifacts: ContentExportArtifact[];
  unresolved_change_request: ContentExportChangeRequest | null;
  unresolved_comments: ContentExportComment[];
  warnings: string[];
}

export interface ContentExportArchivedDeliverable {
  id: string;
  title: string;
  status: string;
}

export interface ContentExportBundle {
  schema_version: string;
  generated_at: string;
  firm: { id: string; name: string | null };
  period: {
    id: string;
    title: string | null;
    /** "Week 3" label; null when the period is not a numbered publishing week. */
    week_number: number | null;
    starts_on: string;
    ends_on: string;
  };
  active_deliverable_count: number;
  archived_deliverable_count: number;
  warnings: string[];
  generation_policy: {
    may_generate: false;
    may_rewrite: false;
    may_translate: false;
    use_portal_source_only: true;
  };
  deliverables: ContentExportDeliverable[];
  archived_deliverables: ContentExportArchivedDeliverable[];
}

const GENERATION_POLICY = {
  may_generate: false as const,
  may_rewrite: false as const,
  may_translate: false as const,
  use_portal_source_only: true as const,
};

/** Roles whose deliverable_role carries its OWN placement in publication_path (article's journal URL, a PDF's own file path, a landing page's own route). */
const ROLES_WITH_OWN_PLACEMENT = new Set(["article", "landing_page", "lead_magnet_pdf"]);

function evaluateMayPublish(
  deliverable: ContentDeliverable,
  currentVersionExists: boolean,
  approvedVersionExists: boolean,
  currentVersionRequiresIndividualReview: boolean,
  hasUnresolvedClientChangeHold: boolean,
  standingAuthorizationActive: boolean,
): { may_publish: boolean; reason: string | null } {
  // The pointer-integrity checks below are this module's own and stay here:
  // current_version_id / approved_version_id are pointers, and a pointer can
  // go stale (the row was deleted) or, if data integrity is ever compromised,
  // point at a version belonging to a DIFFERENT deliverable.
  // currentVersionExists / approvedVersionExists already encode "the row
  // exists AND its own deliverable_id matches this deliverable's id" (see
  // resolveOwnedVersion), so a corrupted or foreign pointer is never treated
  // as publishable, whichever authorization path is later consulted.
  if (!deliverable.current_version_id) {
    return { may_publish: false, reason: "No current version exists for this deliverable." };
  }
  if (!currentVersionExists) {
    return {
      may_publish: false,
      reason:
        "current_version_id does not resolve to an existing version row owned by this deliverable.",
    };
  }
  if (deliverable.approved_version_id && !approvedVersionExists) {
    return {
      may_publish: false,
      reason:
        "approved_version_id does not resolve to an existing version row owned by this deliverable.",
    };
  }

  // The AUTHORIZATION decision is not made here. isVersionReleaseAuthorized is
  // the canonical two-path bar -- a faithful read-only port of
  // claim_placement_for_publish(), the RPC that actually enforces this rule --
  // and its own doc requires every caller to use its result as-is rather than
  // reconstruct any part of it. This function used to reconstruct it, and
  // implemented only Path A (individual approval). That silently withheld
  // every piece cleared through Path B: a firm with standing publishing
  // authorization active whose version is not flagged
  // requires_individual_review. For a firm running on standing authorization
  // that is the NORMAL path, not an edge case, so the export locked the whole
  // week -- copy withheld, downloads locked -- for content the firm had in
  // fact authorized. The old comment here asserted that the deliverable's
  // status/approved_version_id pair was "the single source of truth ... there
  // is nothing else to infer from", which was simply untrue: standing
  // authorization is firm-level state that lives nowhere on the deliverable
  // row, which is exactly why reconstructing the decision from that row could
  // never have been right.
  const authorization = isVersionReleaseAuthorized({
    deliverableStatus: deliverable.status,
    approvedVersionId: deliverable.approved_version_id,
    targetVersionId: deliverable.current_version_id,
    versionRequiresIndividualReview: currentVersionRequiresIndividualReview,
    hasUnresolvedClientChangeHold,
    standingAuthorizationActive,
  });

  return {
    may_publish: authorization.authorized,
    // Carried through verbatim: the canonical bar already names the actual
    // path taken or the actual reason it was denied, and re-wording it here
    // would be a second description of a decision this module does not make.
    reason: authorization.authorized ? null : authorization.reason,
  };
}

/**
 * Resolves a version-id pointer to its row, but only if that row actually
 * exists AND its own deliverable_id matches the deliverable doing the
 * pointing. A version that exists but belongs to a different deliverable
 * is treated exactly like a missing version everywhere in this module
 * (never exported as this deliverable's content, never counted toward
 * may_publish): this is the defense-in-depth check against a corrupted or
 * cross-wired current_version_id / approved_version_id pointer.
 */
function resolveOwnedVersion(
  versionId: string | null,
  deliverableId: string,
  versionById: Map<string, DeliverableVersion>,
): { version: DeliverableVersion | null; foreign: boolean } {
  if (!versionId) return { version: null, foreign: false };
  const v = versionById.get(versionId) ?? null;
  if (!v) return { version: null, foreign: false };
  if (v.deliverable_id !== deliverableId) return { version: null, foreign: true };
  return { version: v, foreign: false };
}

function toVersionBody(v: DeliverableVersion, signedUrlExpiresAt: string | null): ContentExportVersionBody {
  return {
    id: v.id,
    version_number: v.version_number,
    body_html: v.body_html,
    storage_bucket: v.storage_path ? ASSET_BUCKET : null,
    storage_path: v.storage_path,
    signed_url: v.signed_url ?? null,
    signed_url_expires_at: v.signed_url ? signedUrlExpiresAt : null,
    asset_mime: v.asset_mime,
    asset_size_bytes: v.asset_size_bytes,
    asset_name: v.asset_name,
    asset_sha256: v.asset_sha256,
    note: v.note,
    responds_to_approval_id: v.responds_to_approval_id,
    created_at: v.created_at,
  };
}

function basenameOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Signs a version's storage object with a download filename, so the browser
 * receives Content-Disposition: attachment from Supabase itself. The HTML
 * `download` attribute on an anchor is ignored for cross-origin URLs (Supabase
 * storage is a different origin from the app), so without this the file opens
 * inline in the current tab instead of downloading. Prefers asset_name (the
 * operator-facing filename) over the storage path's basename.
 */
async function signVersionAsset(
  v: DeliverableVersion,
): Promise<{ version: DeliverableVersion; signingFailed: boolean }> {
  if (!v.storage_path) return { version: v, signingFailed: false };
  const filename = v.asset_name ?? basenameOf(v.storage_path);
  const { data, error } = await supabase.storage
    .from(ASSET_BUCKET)
    .createSignedUrl(v.storage_path, SIGNED_URL_TTL, { download: filename });
  return {
    version: { ...v, signed_url: data?.signedUrl ?? undefined },
    signingFailed: Boolean(error) || !data?.signedUrl,
  };
}

/**
 * Signs one publication artifact's storage object. Artifacts may legitimately
 * carry no storage_path (a webpage or external_post artifact is recorded by
 * URL), in which case there is nothing to sign and null is correct. Passes a
 * download filename for the same cross-origin reason as signVersionAsset.
 */
async function signArtifact(
  artifact: PublicationArtifact,
): Promise<{ signedUrl: string | null; signingFailed: boolean }> {
  if (!artifact.storage_path) return { signedUrl: null, signingFailed: false };
  const bucket = artifact.storage_bucket ?? ASSET_BUCKET;
  const filename = basenameOf(artifact.storage_path);
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(artifact.storage_path, SIGNED_URL_TTL, { download: filename });
  return { signedUrl: data?.signedUrl ?? null, signingFailed: Boolean(error) || !data?.signedUrl };
}

/**
 * Builds the publishing bundle for one content period. Read-only: issues
 * SELECT queries only, never an insert/update/delete. Returns { ok: false }
 * for a period that does not exist; every other partial-data situation
 * (missing metadata, missing artifacts, a deliverable with no current
 * version) resolves to a warning on that deliverable, never an error and
 * never an omission (rule: always export every active deliverable).
 */
export async function buildContentExportBundle(
  periodId: string,
): Promise<{ ok: true; bundle: ContentExportBundle } | { ok: false; error: string }> {
  const { data: period, error: periodErr } = await supabase
    .from("content_periods")
    .select("id, firm_id, starts_on, ends_on, week_number, theme")
    .eq("id", periodId)
    .maybeSingle();
  if (periodErr) return { ok: false, error: periodErr.message };
  if (!period) return { ok: false, error: "period not found" };

  // Shared across every asset signed in this one bundle build: all of them
  // are signed within the same request and share one TTL countdown, so one
  // expiry timestamp describes all of them rather than drifting per-call.
  const signedUrlExpiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString();

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("id, name")
    .eq("id", period.firm_id)
    .maybeSingle();

  // Firm-level, so it is read ONCE for the whole bundle rather than per
  // deliverable. This is the second half of the release-authorization bar
  // (see evaluateMayPublish): without it every piece cleared through standing
  // authorization rather than individual approval reads as unpublishable.
  const standingAuthorizationActive =
    (await getStandingAuthorizationState(period.firm_id))?.active ?? false;

  // Double-keyed by period_id AND firm_id (defense in depth, matching this
  // codebase's existing convention elsewhere): a deliverable only belongs
  // in this bundle when both match the period it claims to be scoped to.
  const { data: allDeliverables, error: delErr } = await supabase
    .from("content_deliverables")
    .select("*")
    .eq("period_id", periodId)
    .eq("firm_id", period.firm_id);
  if (delErr) return { ok: false, error: delErr.message };

  const rows = (allDeliverables ?? []) as ContentDeliverable[];
  const active = rows.filter((d) => d.status !== "archived");
  const archived = rows.filter((d) => d.status === "archived");

  const deliverableIds = active.map((d) => d.id);
  const heldVersionIds = await loadUnresolvedClientChangeHoldVersionIds(period.firm_id, deliverableIds);

  const [
    { data: versions },
    { data: comments },
    { data: approvals },
    { data: artifacts },
    { data: roleAssignments },
  ] = await Promise.all([
    deliverableIds.length
      ? supabase.from("deliverable_versions").select("*").in("deliverable_id", deliverableIds)
      : Promise.resolve({ data: [] as DeliverableVersion[] }),
    deliverableIds.length
      ? supabase.from("deliverable_comments").select("*").in("deliverable_id", deliverableIds).eq("resolved", false)
      : Promise.resolve({ data: [] as DeliverableComment[] }),
    deliverableIds.length
      ? supabase
          .from("approval_records")
          .select("*")
          .in("deliverable_id", deliverableIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as ApprovalRecord[] }),
    deliverableIds.length
      ? supabase.from("publication_artifacts").select("*").in("deliverable_id", deliverableIds)
      : Promise.resolve({ data: [] as PublicationArtifact[] }),
    deliverableIds.length
      ? supabase
          .from("publication_artifact_role_assignments")
          .select("*")
          .in("deliverable_id", deliverableIds)
          .is("superseded_at", null)
      : Promise.resolve({ data: [] as PublicationArtifactRoleAssignment[] }),
  ]);

  const allVersions = (versions ?? []) as DeliverableVersion[];
  const versionById = new Map(allVersions.map((v) => [v.id, v]));
  const versionsByDeliverable = new Map<string, DeliverableVersion[]>();
  for (const v of allVersions) {
    const list = versionsByDeliverable.get(v.deliverable_id) ?? [];
    list.push(v);
    versionsByDeliverable.set(v.deliverable_id, list);
  }

  const allComments = (comments ?? []) as DeliverableComment[];
  const commentsByDeliverable = new Map<string, DeliverableComment[]>();
  for (const c of allComments) {
    // Excludes change-request-thread replies (approval_record_id set),
    // matching the existing openCommentCount convention in
    // deliverables-pure.ts: those are threaded on the approval record, not
    // passage-anchored feedback on the deliverable itself.
    if (c.approval_record_id) continue;
    const list = commentsByDeliverable.get(c.deliverable_id) ?? [];
    list.push(c);
    commentsByDeliverable.set(c.deliverable_id, list);
  }

  const allApprovals = (approvals ?? []) as ApprovalRecord[];
  const latestApprovalByDeliverable = new Map<string, ApprovalRecord>();
  for (const a of allApprovals) {
    if (!latestApprovalByDeliverable.has(a.deliverable_id)) {
      latestApprovalByDeliverable.set(a.deliverable_id, a); // already ordered created_at desc
    }
  }

  const allArtifacts = (artifacts ?? []) as PublicationArtifact[];
  const activeRoleAssignmentByArtifact = new Map<string, PublicationArtifactRoleAssignment>();
  for (const assignment of (roleAssignments ?? []) as PublicationArtifactRoleAssignment[]) {
    activeRoleAssignmentByArtifact.set(assignment.artifact_id, assignment);
  }
  const artifactIds = allArtifacts.map((a) => a.id);
  const { data: validations } = artifactIds.length
    ? await supabase
        .from("publication_artifact_validations")
        .select("*")
        .in("artifact_id", artifactIds)
        .order("created_at", { ascending: false })
    : { data: [] as PublicationArtifactValidation[] };
  const latestValidationByArtifact = new Map<string, PublicationArtifactValidation>();
  for (const v of (validations ?? []) as PublicationArtifactValidation[]) {
    if (!latestValidationByArtifact.has(v.artifact_id)) latestValidationByArtifact.set(v.artifact_id, v);
  }
  const artifactsByDeliverable = new Map<string, PublicationArtifact[]>();
  for (const a of allArtifacts) {
    const list = artifactsByDeliverable.get(a.deliverable_id) ?? [];
    list.push(a);
    artifactsByDeliverable.set(a.deliverable_id, list);
  }

  const bundleWarnings: string[] = [];
  const exportDeliverables: ContentExportDeliverable[] = [];

  for (const d of active) {
    const warnings: string[] = [];

    if (!d.deliverable_role) warnings.push("No deliverable_role (channel) recorded.");
    if (!d.locale) warnings.push("No locale recorded.");
    if (!d.publication_destination) warnings.push("No publication_destination recorded.");
    if (
      d.deliverable_role &&
      ROLES_WITH_OWN_PLACEMENT.has(d.deliverable_role) &&
      !d.publication_path
    ) {
      warnings.push("No publication_path recorded for a role that has its own placement.");
    }

    const currentResolved = resolveOwnedVersion(d.current_version_id, d.id, versionById);
    if (!d.current_version_id) {
      warnings.push("No current version exists.");
    } else if (!currentResolved.version) {
      warnings.push(
        currentResolved.foreign
          ? "current_version_id resolves to a version belonging to a different deliverable; treated as missing."
          : "current_version_id does not resolve to any existing version row; treated as missing.",
      );
    }
    // Counted rather than pushed inline so a deliverable with several failed
    // signings gets one accurate warning per kind instead of the identical
    // sentence repeated once per failure -- and so "version asset failed" is
    // never described as "an artifact failed", which is what the old inline
    // pushes did regardless of which one actually failed.
    let versionSigningFailures = 0;
    let artifactSigningFailures = 0;

    let currentVersion: ContentExportVersionBody | null = null;
    if (currentResolved.version) {
      const { version: signedCurrent, signingFailed } = await signVersionAsset(currentResolved.version);
      currentVersion = toVersionBody(signedCurrent, signedUrlExpiresAt);
      if (signingFailed) versionSigningFailures += 1;
    }

    const approvedResolved = resolveOwnedVersion(d.approved_version_id, d.id, versionById);
    if (d.approved_version_id && !approvedResolved.version) {
      warnings.push(
        approvedResolved.foreign
          ? "approved_version_id resolves to a version belonging to a different deliverable; treated as missing."
          : "approved_version_id does not resolve to any existing version row; treated as missing.",
      );
    }
    let approvedVersion: ContentExportVersionBody | null = null;
    if (d.approved_version_id && d.approved_version_id !== d.current_version_id && approvedResolved.version) {
      const { version: signedApproved, signingFailed } = await signVersionAsset(approvedResolved.version);
      approvedVersion = toVersionBody(signedApproved, signedUrlExpiresAt);
      if (signingFailed) versionSigningFailures += 1;
    }

    const deliverableArtifacts = artifactsByDeliverable.get(d.id) ?? [];
    if (deliverableArtifacts.length === 0) {
      warnings.push("No publication_artifacts registered for this deliverable yet.");
    }
    const exportArtifacts: ContentExportArtifact[] = await Promise.all(
      deliverableArtifacts.map(async (a) => {
        const latest = latestValidationByArtifact.get(a.id) ?? null;
        const { signedUrl: signed, signingFailed } = await signArtifact(a);
        if (signingFailed) artifactSigningFailures += 1;
        return {
          id: a.id,
          version_id: a.version_id,
          artifact_type: a.artifact_type,
          // Legacy artifacts remain immutable. An explicit operator assignment
          // supplies the effective role only for this export/view.
          asset_role: a.asset_role ?? activeRoleAssignmentByArtifact.get(a.id)?.asset_role ?? null,
          locale: a.locale,
          destination: a.destination,
          storage_bucket: a.storage_bucket,
          storage_path: a.storage_path,
          public_url: a.public_url,
          sha256: a.sha256,
          size_bytes: a.size_bytes,
          mime_type: a.mime_type,
          signed_url: signed,
          signed_url_expires_at: signed ? signedUrlExpiresAt : null,
          created_at: a.created_at,
          superseded_at: a.superseded_at,
          // Derived from the RESOLVED current version (currentResolved.version),
          // not the raw current_version_id pointer: resolveOwnedVersion already
          // proved that row exists and belongs to this deliverable, so a
          // dangling or cross-wired pointer can never make an artifact
          // falsely "match" the current version here.
          matches_current_version:
            currentResolved.version !== null && a.version_id === currentResolved.version.id,
          latest_validation: latest
            ? { validator: latest.validator, result: latest.result, created_at: latest.created_at }
            : null,
        };
      }),
    );

    if (versionSigningFailures > 0) {
      warnings.push(
        "This deliverable's version asset has a stored file but its download link could not be generated. Refresh to retry.",
      );
    }
    if (artifactSigningFailures > 0) {
      warnings.push(
        `${artifactSigningFailures} artifact${artifactSigningFailures === 1 ? "" : "s"} ${
          artifactSigningFailures === 1 ? "has" : "have"
        } a stored file but ${artifactSigningFailures === 1 ? "its" : "their"} download link${
          artifactSigningFailures === 1 ? "" : "s"
        } could not be generated. Refresh to retry.`,
      );
    }

    // Unresolved change request: content_deliverables.status carries this
    // directly. Posting a new version always returns status to "in_review"
    // and clears approved_version_id (the deliverables.ts version-drift
    // guard), so status === "changes_requested" is, by construction, only
    // ever true while the most recent changes_requested decision has not
    // yet been answered by a new version. No content_pieces / deliverable_
    // suggestions dependency needed (that table does not exist on this
    // branch; see the module header).
    let unresolvedChangeRequest: ContentExportChangeRequest | null = null;
    if (d.status === "changes_requested") {
      const latestApproval = latestApprovalByDeliverable.get(d.id);
      if (latestApproval && latestApproval.decision === "changes_requested") {
        unresolvedChangeRequest = {
          approval_record_id: latestApproval.id,
          requested_at: latestApproval.created_at,
          signer_name: latestApproval.signer_name,
          note: latestApproval.note,
        };
      } else {
        warnings.push(
          "Deliverable status is changes_requested but no matching approval_records row was found.",
        );
      }
    }

    const unresolvedComments = (commentsByDeliverable.get(d.id) ?? []).map(
      (c): ContentExportComment => ({
        id: c.id,
        author_role: c.author_role,
        author_name: c.author_name,
        body: c.body,
        created_at: c.created_at,
      }),
    );

    const { may_publish, reason } = evaluateMayPublish(
      d,
      Boolean(currentResolved.version),
      Boolean(approvedResolved.version),
      // Read off the RESOLVED current version, not the raw pointer: a foreign
      // or dangling current_version_id resolves to null, and defaulting the
      // flag to true there keeps the standing-authorization path closed for a
      // version this deliverable does not actually own.
      currentResolved.version?.requires_individual_review ?? true,
      currentResolved.version ? heldVersionIds.has(currentResolved.version.id) : false,
      standingAuthorizationActive,
    );

    exportDeliverables.push({
      id: d.id,
      title: d.title,
      format: d.format,
      channel: d.deliverable_role,
      locale: d.locale,
      content_kind: d.content_kind,
      status: d.status,
      publish_date: d.publish_date,
      current_version_id: d.current_version_id,
      approved_version_id: d.approved_version_id,
      is_current_version_approved:
        currentResolved.version !== null && d.approved_version_id === d.current_version_id,
      may_publish,
      may_publish_reason: reason,
      current_version: currentVersion,
      approved_version: approvedVersion,
      // Read off the RESOLVED current version, the same row evaluateMayPublish
      // took the flag from, so the explanation can never describe a different
      // version than the decision did.
      individual_review_hold: currentResolved.version?.requires_individual_review
        ? {
            reason: currentResolved.version.requires_individual_review_reason,
            set_by_role: currentResolved.version.requires_individual_review_set_by_role,
            set_by_name: currentResolved.version.requires_individual_review_set_by_name,
            set_at: currentResolved.version.requires_individual_review_set_at,
          }
        : null,
      publication_destination: d.publication_destination,
      publication_path: d.publication_path,
      cta_target_path: d.cta_target_path,
      artifacts: exportArtifacts,
      unresolved_change_request: unresolvedChangeRequest,
      unresolved_comments: unresolvedComments,
      warnings,
    });
  }

  const missingMetadataCount = exportDeliverables.filter((d) => d.warnings.length > 0).length;
  if (missingMetadataCount > 0) {
    bundleWarnings.push(
      `${missingMetadataCount} of ${exportDeliverables.length} active deliverable${exportDeliverables.length === 1 ? "" : "s"} have at least one data-completeness warning (see each deliverable's own warnings list).`,
    );
  }
  const unpublishableCount = exportDeliverables.filter((d) => !d.may_publish).length;
  if (unpublishableCount > 0) {
    bundleWarnings.push(
      `${unpublishableCount} of ${exportDeliverables.length} active deliverable${exportDeliverables.length === 1 ? "" : "s"} may_publish=false.`,
    );
  }

  const bundle: ContentExportBundle = {
    schema_version: CONTENT_EXPORT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    firm: { id: period.firm_id, name: (firm?.name as string | undefined) ?? null },
    period: {
      id: period.id,
      title: period.theme,
      week_number: period.week_number ?? null,
      starts_on: period.starts_on,
      ends_on: period.ends_on,
    },
    active_deliverable_count: exportDeliverables.length,
    archived_deliverable_count: archived.length,
    warnings: bundleWarnings,
    generation_policy: GENERATION_POLICY,
    deliverables: exportDeliverables,
    archived_deliverables: archived.map((d) => ({ id: d.id, title: d.title, status: d.status })),
  };

  return { ok: true, bundle };
}

/**
 * Renders the same bundle object as Markdown. This is a pure formatting
 * pass over an already-built ContentExportBundle: it reads no database,
 * infers nothing, and adds no fields beyond what buildContentExportBundle
 * already computed. JSON and Markdown are two views of one source.
 */

/**
 * Composes the version-section withheld reason from whichever reasons
 * actually apply at THIS call site. The current-version call can only
 * withhold because the deliverable is not cleared to publish -- it is
 * trivially its own current version -- so a fixed disjunction mentioning
 * version-binding prints a false clause under a "Current version" heading.
 */
function versionWithholdReason(isCurrentVersion: boolean, deliverableMayPublish: boolean): string {
  const reasons: string[] = [];
  if (!isCurrentVersion) reasons.push("this is not the deliverable's current version");
  if (!deliverableMayPublish) reasons.push("the deliverable is not cleared to publish");
  return `Signed URL withheld: ${reasons.join(", and ")}.`;
}

function renderVersionSection(
  label: string,
  version: ContentExportVersionBody | null,
  withholdReason: string | null,
): string {
  if (!version) return `**${label}:** none on record.\n`;
  const lines: string[] = [];
  lines.push(`**${label}** (v${version.version_number}, id \`${version.id}\`, created ${version.created_at}):`);
  if (version.body_html) {
    lines.push("");
    lines.push("```html");
    lines.push(version.body_html);
    lines.push("```");
  }
  if (version.storage_path) {
    lines.push(`- Storage path: \`${version.storage_path}\``);
    if (version.signed_url && withholdReason) {
      lines.push(`- ${withholdReason}`);
    } else if (version.signed_url) {
      lines.push(
        `- Signed URL (temporary access only, not durable evidence): ${version.signed_url}`,
      );
      lines.push(
        `- Signed URL expires: ${version.signed_url_expires_at ?? "unknown"}. To refresh, re-request this export; storage_path/asset_sha256 below are the durable identity.`,
      );
    }
    if (version.asset_name) lines.push(`- Asset name: ${version.asset_name}`);
    if (version.asset_mime) lines.push(`- Asset MIME: ${version.asset_mime}`);
    if (version.asset_size_bytes !== null) lines.push(`- Asset size: ${version.asset_size_bytes} bytes`);
    if (version.asset_sha256) lines.push(`- Asset SHA-256: \`${version.asset_sha256}\``);
  }
  if (version.note) lines.push(`- Note: ${version.note}`);
  if (version.responds_to_approval_id) {
    lines.push(`- Responds to approval record: \`${version.responds_to_approval_id}\``);
  }
  return lines.join("\n") + "\n";
}

/**
 * Composes the withheld-reason sentence from whichever of the three
 * independent reasons actually apply, rather than a fixed pair -- so a
 * retracted artifact on an approved, current deliverable is never told
 * (falsely, on both counts) that it is "not bound to the current version, or
 * the deliverable is not cleared to publish".
 */
function artifactWithholdReason(a: ContentExportArtifact, deliverableMayPublish: boolean): string {
  const reasons: string[] = [];
  if (a.superseded_at) reasons.push("it has been retracted");
  if (!a.matches_current_version) reasons.push("it is not bound to the deliverable's current version");
  if (!deliverableMayPublish) reasons.push("the deliverable is not cleared to publish");
  return `Signed URL withheld: ${reasons.join(", or ")}.`;
}

function renderArtifact(a: ContentExportArtifact, deliverableMayPublish: boolean): string {
  const lines: string[] = [];
  const destinationSuffix = a.destination ? `, destination ${a.destination}` : "";
  const localeSuffix = a.locale ? ` (${a.locale})` : "";
  lines.push(`- **${a.artifact_type}**${localeSuffix}${destinationSuffix}`);
  lines.push(`  - Bound to version: \`${a.version_id}\``);
  if (a.storage_path) lines.push(`  - Storage: \`${a.storage_bucket ?? "unknown bucket"}/${a.storage_path}\``);
  if (a.mime_type) lines.push(`  - MIME: ${a.mime_type}`);
  if (a.superseded_at) lines.push(`  - Superseded: ${a.superseded_at} (retracted, not publishable)`);
  const withholdLinks = shouldWithholdArtifactLinks({
    matchesCurrentVersion: a.matches_current_version,
    deliverableMayPublish,
    supersededAt: a.superseded_at,
  });
  if (a.signed_url && withholdLinks) {
    lines.push(`  - ${artifactWithholdReason(a, deliverableMayPublish)}`);
  } else if (a.signed_url) {
    lines.push(
      `  - Signed URL (temporary access only, not durable evidence): ${a.signed_url}`,
    );
    lines.push(
      `  - Signed URL expires: ${a.signed_url_expires_at ?? "unknown"}. To refresh, re-request this export; storage_path/sha256 above are the durable identity.`,
    );
  }
  if (a.public_url && !withholdLinks) lines.push(`  - Public URL: ${a.public_url}`);
  if (a.sha256) lines.push(`  - SHA-256: \`${a.sha256}\``);
  if (a.size_bytes !== null) lines.push(`  - Size: ${a.size_bytes} bytes`);
  if (a.latest_validation) {
    lines.push(
      `  - Latest validation: ${a.latest_validation.validator} = ${a.latest_validation.result} (${a.latest_validation.created_at})`,
    );
  }
  return lines.join("\n");
}

function renderDeliverable(d: ContentExportDeliverable): string {
  const lines: string[] = [];
  lines.push(`## ${d.title}`);
  lines.push("");
  lines.push(`- ID: \`${d.id}\``);
  lines.push(`- Format: ${d.format ?? "not recorded"}`);
  lines.push(`- Channel: ${d.channel ?? "not recorded"}`);
  lines.push(`- Locale: ${d.locale ?? "not recorded"}`);
  lines.push(`- Content kind: ${d.content_kind}`);
  lines.push(`- Status: ${d.status}`);
  lines.push(`- Publish date: ${d.publish_date ?? "not set"}`);
  lines.push(`- Publication destination: ${d.publication_destination ?? "not recorded"}`);
  lines.push(`- Publication path: ${d.publication_path ?? "not recorded"}`);
  lines.push(`- CTA target path: ${d.cta_target_path ?? "not recorded"}`);
  lines.push(
    `- **May publish: ${d.may_publish ? "yes" : "no"}**${d.may_publish_reason ? `, reason: ${d.may_publish_reason}` : ""}`,
  );
  lines.push("");

  // The DECISION (withhold or not) is made by the same shared predicate
  // renderArtifact uses, so this section and the artifact section can never
  // drift apart the way they did before FU5-3 -- that is the entire reason
  // this function exists. The WORDING is composed separately by
  // versionWithholdReason, because the reasons a version can carry differ
  // from an artifact's: a version is never a publication_artifacts row, so
  // it can never be retracted.
  const currentVersionWithheld = shouldWithholdArtifactLinks({
    matchesCurrentVersion: true, // the current version is trivially itself
    deliverableMayPublish: d.may_publish,
    supersededAt: null, // versions are not publication_artifacts rows
  });
  lines.push(
    renderVersionSection(
      "Current version",
      d.current_version,
      currentVersionWithheld ? versionWithholdReason(true, d.may_publish) : null,
    ),
  );
  if (d.approved_version) {
    const approvedVersionWithheld = shouldWithholdArtifactLinks({
      matchesCurrentVersion: false, // by definition not the current version
      deliverableMayPublish: d.may_publish,
      supersededAt: null,
    });
    lines.push(
      renderVersionSection(
        "Approved version, differs from current",
        d.approved_version,
        approvedVersionWithheld ? versionWithholdReason(false, d.may_publish) : null,
      ),
    );
  }

  if (d.artifacts.length > 0) {
    lines.push("**Artifacts:**");
    lines.push(d.artifacts.map((a) => renderArtifact(a, d.may_publish)).join("\n"));
    lines.push("");
  } else {
    lines.push("**Artifacts:** none registered yet.");
    lines.push("");
  }

  if (d.unresolved_change_request) {
    const cr = d.unresolved_change_request;
    lines.push(
      `**Unresolved change request** (approval record \`${cr.approval_record_id}\`, requested ${cr.requested_at} by ${cr.signer_name}):`,
    );
    if (cr.note) lines.push(`> ${cr.note}`);
    lines.push("");
  }

  if (d.unresolved_comments.length > 0) {
    lines.push("**Unresolved comments:**");
    for (const c of d.unresolved_comments) {
      const author = c.author_name ? `${c.author_role} ${c.author_name}` : c.author_role;
      lines.push(`- [${author}, ${c.created_at}]: ${c.body}`);
    }
    lines.push("");
  }

  if (d.warnings.length > 0) {
    lines.push("**Warnings:**");
    for (const w of d.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  return lines.join("\n");
}

function withholdVersionLinks(
  version: ContentExportVersionBody | null,
  matchesCurrentVersion: boolean,
  deliverableMayPublish: boolean,
): ContentExportVersionBody | null {
  if (!version) return null;
  const withhold = shouldWithholdArtifactLinks({
    matchesCurrentVersion,
    deliverableMayPublish,
    supersededAt: null, // versions are not publication_artifacts rows
  });
  return withhold ? { ...version, signed_url: null, signed_url_expires_at: null } : version;
}

/**
 * Applies the export's withholding rules to the BUNDLE, so a consumer reading
 * the JSON gets the same answer as one reading the Markdown.
 *
 * Until this existed, withholding lived only inside
 * renderContentExportMarkdown -- that is, in the RENDERER -- while
 * buildContentExportBundle signed every asset unconditionally (signing runs
 * before may_publish is even computed). Since `format` defaults to json, the
 * DEFAULT response carried working signed URLs to exactly the retracted and
 * unapproved material the Markdown path refuses to print, and an agent
 * switching format -- the natural thing to do -- silently lost every gate.
 * Withholding belongs in the data, not the renderer: that is the same lesson
 * the Publish Kit learned when it moved stripAccess into publish-kit-pure.ts.
 *
 * The decision routes through the one shared predicate both Markdown sections
 * already use, so the three consumers cannot drift apart.
 *
 * Only ACCESS is removed. storage_path, storage_bucket, sha256, mime and size
 * all stay: they are the durable identity of the object and carry no
 * capability to fetch it -- an operator needs them to find the file by hand,
 * which is the whole point of withholding the URL rather than the record.
 * body_html stays too, and that is deliberate: a signed URL mints a
 * time-limited capability against storage, whereas a body is data already
 * inside a response this operator-only route is authorised to return. See the
 * route header for that rule stated as policy.
 *
 * NOTE: renderContentExportMarkdown must keep receiving the RAW bundle. Its
 * withheld-reason lines are gated on `signed_url` being present (see
 * renderArtifact / renderVersionSection), so handing it an already-withheld
 * bundle would silently delete the "Signed URL withheld: ..." explanations
 * rather than print them.
 */
export function withholdBundleLinks(bundle: ContentExportBundle): ContentExportBundle {
  return {
    ...bundle,
    deliverables: bundle.deliverables.map((d) => ({
      ...d,
      current_version: withholdVersionLinks(d.current_version, true, d.may_publish),
      // The approved version is by definition not the current one, so this is
      // always withheld -- same as the Markdown call site.
      approved_version: withholdVersionLinks(d.approved_version, false, d.may_publish),
      artifacts: d.artifacts.map((a) =>
        shouldWithholdArtifactLinks({
          matchesCurrentVersion: a.matches_current_version,
          deliverableMayPublish: d.may_publish,
          supersededAt: a.superseded_at,
        })
          ? { ...a, signed_url: null, signed_url_expires_at: null, public_url: null }
          : a,
      ),
    })),
  };
}

export function renderContentExportMarkdown(bundle: ContentExportBundle): string {
  const lines: string[] = [];
  lines.push("# Content Studio publishing bundle");
  lines.push("");
  lines.push(`- Schema version: ${bundle.schema_version}`);
  lines.push(`- Generated at: ${bundle.generated_at}`);
  lines.push(`- Firm: ${bundle.firm.name ?? "unnamed"} (\`${bundle.firm.id}\`)`);
  lines.push(
    `- Period: ${bundle.period.week_number != null ? `Week ${bundle.period.week_number} · ` : ""}${bundle.period.title ?? "untitled"} (\`${bundle.period.id}\`), ${bundle.period.starts_on} to ${bundle.period.ends_on}`,
  );
  lines.push(`- Active deliverables: ${bundle.active_deliverable_count}`);
  lines.push(`- Archived deliverables (reported separately, not counted active): ${bundle.archived_deliverable_count}`);
  lines.push("");
  lines.push(
    "**Generation policy:** may_generate false, may_rewrite false, may_translate false, use_portal_source_only true. A publishing agent reading this bundle must never author, rewrite, or translate a missing piece; a gap here stays a gap until it is authored in the portal.",
  );
  lines.push("");

  if (bundle.warnings.length > 0) {
    lines.push("## Bundle-level warnings");
    lines.push("");
    for (const w of bundle.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("# Deliverables");
  lines.push("");
  if (bundle.deliverables.length === 0) {
    lines.push("No active deliverables in this period.");
    lines.push("");
  } else {
    for (const d of bundle.deliverables) {
      lines.push(renderDeliverable(d));
      lines.push("---");
      lines.push("");
    }
  }

  if (bundle.archived_deliverables.length > 0) {
    lines.push("# Archived deliverables");
    lines.push("");
    lines.push("Reported separately. Not part of the active count above, not publishable.");
    lines.push("");
    for (const a of bundle.archived_deliverables) {
      lines.push(`- ${a.title} (\`${a.id}\`), status: ${a.status}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
