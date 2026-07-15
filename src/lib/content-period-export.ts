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
 * Content Studio), and "may_publish" here is computed directly from
 * content_deliverables.status/approved_version_id/current_version_id --
 * nothing is re-rendered, hashed, or compared.
 *
 * Every function here is read-only. Nothing in this module ever writes to
 * Supabase.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type {
  ContentDeliverable,
  DeliverableVersion,
  DeliverableComment,
  ApprovalRecord,
  PublicationArtifact,
  PublicationArtifactValidation,
} from "@/lib/types";

const ASSET_BUCKET = "firm-files";
const SIGNED_URL_TTL = 3600; // 1 hour, matching deliverables.ts's existing convention

export const CONTENT_EXPORT_SCHEMA_VERSION = "1.0";

export interface ContentExportVersionBody {
  id: string;
  version_number: number;
  body_html: string | null;
  storage_path: string | null;
  signed_url: string | null;
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
  artifact_type: string;
  locale: string | null;
  destination: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  public_url: string | null;
  sha256: string | null;
  size_bytes: number | null;
  /** Most recent reconciliation result recorded against this artifact, if any. */
  latest_validation: ContentExportArtifactValidation | null;
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
  publication_destination: string | null;
  publication_path: string | null;
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
  period: { id: string; title: string | null; starts_on: string; ends_on: string };
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
): { may_publish: boolean; reason: string | null } {
  // Rule: may_publish is true only when the current version IS the
  // formally approved version, that version actually exists as a row
  // owned by this deliverable, and no unresolved change-request state
  // invalidates that approval. Never inferred from status alone, and
  // never from an approval bound to an older version: both the status
  // AND the exact version-id match are required, and the deliverable's
  // own status/approved_version_id pair is the single source of truth
  // (content_deliverables never carries a display-only status separate
  // from this pair -- there is nothing else to infer from). ID equality
  // on the deliverable row alone is not sufficient: current_version_id /
  // approved_version_id are pointers, and a pointer can go stale (the
  // row was deleted) or, if data integrity is ever compromised, point at
  // a version that belongs to a DIFFERENT deliverable. currentVersionExists
  // / approvedVersionExists already encode "the row exists AND its own
  // deliverable_id matches this deliverable's id" (see resolveOwnedVersion),
  // so a corrupted or foreign pointer is never treated as publishable.
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
  if (deliverable.status !== "approved") {
    return {
      may_publish: false,
      reason: `Deliverable status is "${deliverable.status}", not "approved".`,
    };
  }
  if (!deliverable.approved_version_id) {
    return { may_publish: false, reason: "No approved_version_id is recorded on this deliverable." };
  }
  if (!approvedVersionExists) {
    return {
      may_publish: false,
      reason:
        "approved_version_id does not resolve to an existing version row owned by this deliverable.",
    };
  }
  if (deliverable.approved_version_id !== deliverable.current_version_id) {
    return {
      may_publish: false,
      reason:
        "The approved version is not the current version (a newer version was posted after approval and has not been re-approved).",
    };
  }
  return { may_publish: true, reason: null };
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

function toVersionBody(v: DeliverableVersion): ContentExportVersionBody {
  return {
    id: v.id,
    version_number: v.version_number,
    body_html: v.body_html,
    storage_path: v.storage_path,
    signed_url: v.signed_url ?? null,
    asset_mime: v.asset_mime,
    asset_size_bytes: v.asset_size_bytes,
    asset_name: v.asset_name,
    asset_sha256: v.asset_sha256,
    note: v.note,
    responds_to_approval_id: v.responds_to_approval_id,
    created_at: v.created_at,
  };
}

async function signVersionAsset(v: DeliverableVersion): Promise<DeliverableVersion> {
  if (!v.storage_path) return v;
  const { data } = await supabase.storage.from(ASSET_BUCKET).createSignedUrl(v.storage_path, SIGNED_URL_TTL);
  return { ...v, signed_url: data?.signedUrl ?? undefined };
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
    .select("id, firm_id, starts_on, ends_on, theme")
    .eq("id", periodId)
    .maybeSingle();
  if (periodErr) return { ok: false, error: periodErr.message };
  if (!period) return { ok: false, error: "period not found" };

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("id, name")
    .eq("id", period.firm_id)
    .maybeSingle();

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

  const [{ data: versions }, { data: comments }, { data: approvals }, { data: artifacts }] = await Promise.all([
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
    const currentVersionSigned = currentResolved.version ? await signVersionAsset(currentResolved.version) : null;
    const currentVersion = currentVersionSigned ? toVersionBody(currentVersionSigned) : null;

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
      const signedApproved = await signVersionAsset(approvedResolved.version);
      approvedVersion = toVersionBody(signedApproved);
    }

    const deliverableArtifacts = artifactsByDeliverable.get(d.id) ?? [];
    if (deliverableArtifacts.length === 0) {
      warnings.push("No publication_artifacts registered for this deliverable yet.");
    }
    const exportArtifacts: ContentExportArtifact[] = deliverableArtifacts.map((a) => {
      const latest = latestValidationByArtifact.get(a.id) ?? null;
      return {
        id: a.id,
        artifact_type: a.artifact_type,
        locale: a.locale,
        destination: a.destination,
        storage_bucket: a.storage_bucket,
        storage_path: a.storage_path,
        public_url: a.public_url,
        sha256: a.sha256,
        size_bytes: a.size_bytes,
        latest_validation: latest
          ? { validator: latest.validator, result: latest.result, created_at: latest.created_at }
          : null,
      };
    });

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
      publication_destination: d.publication_destination,
      publication_path: d.publication_path,
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
    period: { id: period.id, title: period.theme, starts_on: period.starts_on, ends_on: period.ends_on },
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

function renderVersionSection(label: string, version: ContentExportVersionBody | null): string {
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
    if (version.signed_url) lines.push(`- Signed URL, 1 hour from export time: ${version.signed_url}`);
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

function renderArtifact(a: ContentExportArtifact): string {
  const lines: string[] = [];
  const destinationSuffix = a.destination ? `, destination ${a.destination}` : "";
  const localeSuffix = a.locale ? ` (${a.locale})` : "";
  lines.push(`- **${a.artifact_type}**${localeSuffix}${destinationSuffix}`);
  if (a.storage_path) lines.push(`  - Storage: \`${a.storage_bucket ?? "unknown bucket"}/${a.storage_path}\``);
  if (a.public_url) lines.push(`  - Public URL: ${a.public_url}`);
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
  lines.push(
    `- **May publish: ${d.may_publish ? "yes" : "no"}**${d.may_publish_reason ? `, reason: ${d.may_publish_reason}` : ""}`,
  );
  lines.push("");

  lines.push(renderVersionSection("Current version", d.current_version));
  if (d.approved_version) {
    lines.push(renderVersionSection("Approved version, differs from current", d.approved_version));
  }

  if (d.artifacts.length > 0) {
    lines.push("**Artifacts:**");
    lines.push(d.artifacts.map(renderArtifact).join("\n"));
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

export function renderContentExportMarkdown(bundle: ContentExportBundle): string {
  const lines: string[] = [];
  lines.push("# Content Studio publishing bundle");
  lines.push("");
  lines.push(`- Schema version: ${bundle.schema_version}`);
  lines.push(`- Generated at: ${bundle.generated_at}`);
  lines.push(`- Firm: ${bundle.firm.name ?? "unnamed"} (\`${bundle.firm.id}\`)`);
  lines.push(
    `- Period: ${bundle.period.title ?? "untitled"} (\`${bundle.period.id}\`), ${bundle.period.starts_on} to ${bundle.period.ends_on}`,
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
