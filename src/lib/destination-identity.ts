/**
 * The exact-destination-identity gate: before any part of this codebase may
 * verify a publication as live, publish to an external platform, or declare
 * content absent from one, it must first resolve the EXACT intended
 * destination on that platform -- never a substitute, a public-only
 * observation, or a same-firm-but-different-account guess.
 *
 * For every external placement (a destination this codebase does not itself
 * own or host -- today: LinkedIn and Google Business Profile), six things
 * must be resolved before any verification/publish/absence conclusion is
 * trustworthy:
 *   1. the exact firm this identity is configured for (never a record
 *      belonging to a different firm, even if it is otherwise valid);
 *   2. destination platform (e.g. "linkedin"; never a record configured
 *      for a different platform);
 *   3. the exact intended account/page/location identity on that platform
 *      (e.g. the DRG Law Company Page, never a lawyer's personal profile);
 *   4. the exact intended surface within that account (e.g. "native
 *      article" vs. "feed post" vs. the page's own profile surface);
 *   5. the version/source content being represented;
 *   6. the evidence source used for verification (an authorized
 *      manager-level or API history surface -- never a public page view,
 *      which cannot prove a negative and can be spoofed or simply wrong).
 * resolveDestinationIdentity() checks (1) and (2) as explicit equality
 * predicates against the caller-supplied `firmId`/`platform` parameters,
 * not merely as context carried through into evidence text -- a
 * configuredIdentity record supplied for the wrong firm or the wrong
 * platform resolves `destination_identity_unresolved`, exactly as if no
 * record had been supplied at all.
 *
 * No durable configuration model for (1)-(4) exists in this codebase today.
 * `publication_destination_configs` -- firm_id + platform +
 * account_or_location_id + destination_surface + status + controlled
 * credential/integration reference -- is the correct future home for it
 * (see docs/publication-operator/publication-resolution-preflight-design-2026-07-19.md
 * §1 Tier 3), but it exists only as a drafted, unapplied migration on a
 * different, unmerged branch and is blocked by the migration-lineage freeze
 * in effect since 2026-07-18
 * (docs/audits/MIGRATION_LINEAGE_INCIDENT_2026-07-18.md). This module does
 * NOT create that table, a new migration, or any hand-authored per-firm
 * identity map as a substitute source of truth -- every real caller in this
 * codebase supplies `configuredIdentity: null` today, and this module
 * resolves that to `destination_identity_unresolved` every time, which is
 * the correct, fail-closed answer until that durable model exists and is
 * populated.
 *
 * This module never queries an external platform itself and never invents,
 * derives, or guesses an identity from a firm's name, website domain, or
 * any other proxy. It only compares whatever identity a caller supplies
 * against whatever identity, if any, an external query actually returned,
 * and reports one of four outcomes. No I/O. No Supabase. No network call.
 */

export type ExternalVerifiablePlatform = "linkedin" | "google_business_profile";

/** A durable per-firm destination identity's lifecycle status, once a real configuration record exists (see this module's header comment). */
export type DestinationIdentityStatus = "active" | "inactive" | "revoked";

/**
 * The shape a real, durable destination-identity configuration record would
 * have -- see this module's header comment on `publication_destination_configs`.
 * Not a database row today; every real caller in this codebase constructs
 * this only in a test, or supplies `null` in production (no config source
 * exists yet).
 */
export interface ConfiguredDestinationIdentity {
  firmId: string;
  platform: ExternalVerifiablePlatform;
  /** The exact account/page/location id on the external platform -- e.g. a LinkedIn Company Page URN, or a Google Business Profile location id. Never a personal-profile id, never derived from the firm's name or domain. */
  accountOrLocationId: string;
  /** A short, stable label for the exact surface within that account this placement targets -- e.g. "linkedin_native_article", "linkedin_company_page_profile", "google_business_profile_location". Compared with strict equality; there is no partial or fuzzy match. */
  destinationSurface: string;
  status: DestinationIdentityStatus;
  /**
   * True only when an authorized manager-level or API history surface
   * exists for THIS EXACT identity -- e.g. a LinkedIn Company Page admin
   * API token, or a Google Business Profile manager account with API
   * access to that exact location's post history. Never true merely
   * because posting/publishing credentials exist, and never true merely
   * because the identity itself is known: a public Google Maps listing or
   * a public LinkedIn page view is NOT an authorized history surface, even
   * though both are technically "reachable."
   */
  hasAuthorizedHistoryAccess: boolean;
}

/**
 * The identity an actual query against an evidence source returned (or that
 * a submitted receipt claims), to be checked against the configured,
 * intended identity before its result is trusted. Distinguishing an
 * authoritative source from a public one (e.g. an authenticated GBP
 * manager API vs. a public Google Maps listing) is the CALLER's
 * responsibility before this identity is even constructed -- this module
 * only compares identities, it does not itself grade the source's
 * authority.
 */
export interface ObservedExternalIdentity {
  platform: ExternalVerifiablePlatform;
  accountOrLocationId: string;
  surface: string;
}

export type DestinationIdentityResolutionKind =
  | "destination_identity_unresolved"
  | "external_history_unavailable"
  | "external_verification_target_mismatch"
  | "destination_identity_confirmed";

export interface ResolveDestinationIdentityInput {
  firmId: string;
  platform: ExternalVerifiablePlatform;
  /** The version/source content being represented at this destination -- carried through as evidence only; this module never verifies release-authorization itself (see release-authorization.ts for that separate, canonical bar). */
  versionId: string | null;
  /** This firm's durably configured identity for this exact platform+surface, or null when none is recorded -- which is EVERY firm today; see this module's header comment. */
  configuredIdentity: ConfiguredDestinationIdentity | null;
  /** The identity an evidence-source query actually returned, or null when no query has been attempted (the normal state before any external verification is even possible). */
  observedIdentity: ObservedExternalIdentity | null;
}

export interface DestinationIdentityResolution {
  kind: DestinationIdentityResolutionKind;
  /** True only for kind === "destination_identity_confirmed" -- the ONLY state in which a caller may treat a positive external check as proof of publication. */
  canVerifyPublished: boolean;
  /** True only for kind === "destination_identity_confirmed" -- the ONLY state in which a caller may declare content absent from this destination. Every other state means "unverified," never "absent." */
  canDeclareAbsent: boolean;
  reason: string;
  /** The evidence source this resolution actually consulted, or null when none was consulted (unresolved identity, or history access unavailable -- both stop before any evidence source is reached). */
  evidenceSourceConsulted: string | null;
}

/**
 * Resolves whether an external placement's destination identity is exact,
 * confirmed, and backed by authoritative history access -- the single
 * precondition every external verify/publish/absence decision in this
 * codebase must pass through. Fails closed on every branch: there is no
 * default-confirmed path, and no branch below ever queries, guesses, or
 * substitutes an identity the caller did not explicitly supply.
 */
export function resolveDestinationIdentity(input: ResolveDestinationIdentityInput): DestinationIdentityResolution {
  const { firmId, platform, configuredIdentity, observedIdentity } = input;

  // No configured identity at all, or one that exists but is not active
  // (never configured, disabled, or revoked) -- never query a substitute
  // account or public page in its place. This is the state every real
  // caller in this codebase is in today, for every firm, on every external
  // platform: no durable destination-identity configuration model exists
  // yet (see this module's header comment), so this branch is currently
  // the ONLY reachable outcome through the live release-graph audit.
  if (!configuredIdentity) {
    return {
      kind: "destination_identity_unresolved",
      canVerifyPublished: false,
      canDeclareAbsent: false,
      reason: `No destination identity is configured for firm ${firmId} on platform "${platform}". The exact intended account/page/location and surface are not recorded anywhere this system can read. Never substitute a different account, a public page, or a guess derived from the firm's name or domain -- this is a fail-closed stop, not an invitation to look elsewhere.`,
      evidenceSourceConsulted: null,
    };
  }
  // A configuredIdentity record was supplied, but it belongs to a
  // different firm or a different platform than the one actually being
  // evaluated -- a caller-side mismatch (a stale or wrong record reused
  // across firms/platforms) that must never be treated as "configured for
  // this firm/platform" merely because SOME record happened to be passed
  // in. Checked before status/history so a wrong-firm or wrong-platform
  // record never gets far enough to be judged "active" or "history-capable"
  // for a firm/platform it was never actually configured for.
  if (configuredIdentity.firmId !== firmId) {
    return {
      kind: "destination_identity_unresolved",
      canVerifyPublished: false,
      canDeclareAbsent: false,
      reason: `A destination identity record was supplied, but it belongs to firm ${configuredIdentity.firmId}, not the firm actually being evaluated (${firmId}). A record configured for a different firm is never treated as configured for this one -- this is a fail-closed stop, not an invitation to reuse a nearby record.`,
      evidenceSourceConsulted: null,
    };
  }
  if (configuredIdentity.platform !== platform) {
    return {
      kind: "destination_identity_unresolved",
      canVerifyPublished: false,
      canDeclareAbsent: false,
      reason: `A destination identity record was supplied for firm ${firmId}, but it is configured for platform "${configuredIdentity.platform}", not the platform actually being evaluated ("${platform}"). A record configured for a different platform is never treated as configured for this one.`,
      evidenceSourceConsulted: null,
    };
  }
  if (configuredIdentity.status !== "active") {
    return {
      kind: "destination_identity_unresolved",
      canVerifyPublished: false,
      canDeclareAbsent: false,
      reason: `A destination identity IS recorded for firm ${firmId} on platform "${platform}" (${configuredIdentity.accountOrLocationId} / ${configuredIdentity.destinationSurface}), but its status is "${configuredIdentity.status}", not "active" -- an inactive or revoked identity is never treated as a usable target.`,
      evidenceSourceConsulted: null,
    };
  }

  // The identity is known and active, but no authorized manager-level or
  // API history surface exists for it -- a public listing or page view is
  // NOT authoritative history and must never substitute for one. This is
  // checked before any observed identity is consulted: without authorized
  // history access, whatever "observation" a caller might have is not
  // evidence from an authoritative surface in the first place.
  if (!configuredIdentity.hasAuthorizedHistoryAccess) {
    return {
      kind: "external_history_unavailable",
      canVerifyPublished: false,
      canDeclareAbsent: false,
      reason: `The exact destination identity for firm ${firmId} on platform "${platform}" (${configuredIdentity.accountOrLocationId} / ${configuredIdentity.destinationSurface}) is known, but no authorized manager-level or API history surface exists for it. A public listing or page view cannot prove a negative and is never accepted as a substitute for authorized history access.`,
      evidenceSourceConsulted: null,
    };
  }

  const evidenceSource = `${platform} authorized manager/API history surface for ${configuredIdentity.accountOrLocationId} (${configuredIdentity.destinationSurface})`;

  // An identity WAS actually observed (a query ran, or a receipt/attestation
  // named a specific account) -- it must match the configured, intended
  // identity exactly on every field. A same-platform-different-account
  // observation (e.g. a lawyer's personal LinkedIn profile queried where
  // the firm's Company Page was intended) is never close enough.
  if (observedIdentity) {
    const matches =
      observedIdentity.platform === configuredIdentity.platform &&
      observedIdentity.accountOrLocationId === configuredIdentity.accountOrLocationId &&
      observedIdentity.surface === configuredIdentity.destinationSurface;
    if (!matches) {
      return {
        kind: "external_verification_target_mismatch",
        canVerifyPublished: false,
        canDeclareAbsent: false,
        reason: `The queried account/location/surface (${observedIdentity.accountOrLocationId} / ${observedIdentity.surface} on ${observedIdentity.platform}) does not exactly match the configured destination identity for firm ${firmId} (${configuredIdentity.accountOrLocationId} / ${configuredIdentity.destinationSurface} on ${configuredIdentity.platform}). A mismatched identity is never accepted as evidence of publication or absence, regardless of how similar it looks (e.g. a personal profile queried where a Company Page was intended, or a different firm's location).`,
        evidenceSourceConsulted: evidenceSource,
      };
    }
  }

  // Exact match (or no observation attempted yet -- the caller is only
  // asking "may I proceed to query," not reporting a result) plus
  // authorized history access: this is the ONLY state in which a positive
  // "externally verified published" or a genuine "absent" conclusion may
  // ever be produced, and only once the actual query/history check itself
  // has run and returned a real answer -- this function does not run that
  // check; it only clears the caller to do so.
  return {
    kind: "destination_identity_confirmed",
    canVerifyPublished: true,
    canDeclareAbsent: true,
    reason: `Destination identity resolved and confirmed for firm ${firmId} on platform "${platform}": ${configuredIdentity.accountOrLocationId} / ${configuredIdentity.destinationSurface}, with authorized history access. A caller may proceed to query this exact identity's authoritative history; the query's own result (found / not found) is still required before declaring published or absent -- this confirmation is a precondition, not the check itself.`,
    evidenceSourceConsulted: evidenceSource,
  };
}
