/**
 * Pure resolution logic for whether a website article's two placement roles
 * (website_article_hero_baked, website_homepage_cta_baked) are actually
 * filled -- i.e. whether the operator's Publish Kit placement cards would
 * render an image or "No image registered for this placement."
 *
 * Mirrors content-period-export.ts's own resolution expression exactly:
 *   a.asset_role ?? activeRoleAssignmentByArtifact.get(a.id)?.asset_role ?? null
 * (see FOLLOWUPS 2026-08-07, "W32 placement -- THE ROOT CAUSE of images never
 * show in the Publish Kit"). A role-less artifact row is NOT evidence of a
 * filled placement; only a resolved role is.
 *
 * No I/O, no Supabase. The caller (prove.ts) fetches the rows; this file only
 * decides. Exercised directly by
 * scripts/weekly-publish/lib/__tests__/placement-resolution.check.ts (a
 * plain, tsx-executable assertion script, NOT a vitest file -- this repo's
 * vitest.config.ts only collects src/**\/__tests__/**\/*.test.ts, so a test
 * placed under scripts/ would never run under `npm test` and would be a
 * dead, false-confidence file. See that script's own header.
 */

export interface ArtifactRow {
  id: string;
  versionId: string;
  artifactType: string;
  assetRole: string | null;
  supersededAt: string | null;
}

export interface RoleAssignmentRow {
  artifactId: string;
  assetRole: string;
  supersededAt: string | null;
}

/** The two roles a website article deliverable must have filled. */
export const REQUIRED_ARTICLE_PLACEMENT_ROLES = [
  "website_article_hero_baked",
  "website_homepage_cta_baked",
] as const;
export type ArticlePlacementRole = (typeof REQUIRED_ARTICLE_PLACEMENT_ROLES)[number];

const LEGACY_ROLE_ALIASES: Record<string, ArticlePlacementRole> = {
  website_article_hero_overlay: "website_article_hero_baked",
  website_homepage_cta_textless: "website_homepage_cta_baked",
};

function normalizeRole(role: string): string {
  return LEGACY_ROLE_ALIASES[role] ?? role;
}

/**
 * The effective role for one artifact: its own asset_role column when set,
 * otherwise the asset_role of its active (non-superseded) role assignment,
 * otherwise null. An artifact can have at most one active assignment (unique
 * partial index publication_artifact_role_assignments_active_artifact_uidx);
 * if more than one somehow exists in the input, the first found is used and
 * this is NOT treated as an error here -- prove.ts's live query already
 * filters to superseded_at is null, so the DB's own constraint is the real
 * guarantee.
 */
export function resolveEffectiveRole(
  artifact: Pick<ArtifactRow, "id" | "assetRole">,
  assignments: RoleAssignmentRow[],
): string | null {
  if (artifact.assetRole) return normalizeRole(artifact.assetRole);
  const active = assignments.find((a) => a.artifactId === artifact.id && !a.supersededAt);
  return active ? normalizeRole(active.assetRole) : null;
}

export interface MissingPlacementResult {
  deliverableId: string;
  missingRoles: ArticlePlacementRole[];
}

/**
 * Which of the two required roles are NOT resolved for this deliverable's
 * current version. `artifacts` should already be scoped to this one
 * deliverable (any version); this function does the current-version and
 * superseded filtering itself so a caller cannot forget either check.
 */
export function missingPlacementRoles(
  deliverableId: string,
  currentVersionId: string,
  artifacts: ArtifactRow[],
  assignments: RoleAssignmentRow[],
): MissingPlacementResult {
  const onCurrent = artifacts.filter((a) => a.versionId === currentVersionId && !a.supersededAt);
  const resolved = new Set(
    onCurrent
      .map((a) => resolveEffectiveRole(a, assignments))
      .filter((r): r is string => r !== null),
  );
  const missingRoles = REQUIRED_ARTICLE_PLACEMENT_ROLES.filter((r) => !resolved.has(r));
  return { deliverableId, missingRoles };
}
