/**
 * The single decision about whether an artifact's links may be shown, and
 * what a disabled control should say instead.
 *
 * This module exists because two independent consumers make that decision --
 * the Publish Kit UI (via publish-kit-pure.ts) and the Markdown/JSON export
 * (content-period-export.ts) -- and in round 4 they drifted apart: the UI
 * withheld a signed URL that the export printed, and the export named an
 * artifact "retracted, not publishable" four lines above a working link to
 * it. publish-kit-pure.ts already imports types from content-period-export.ts,
 * so neither can import the other at runtime. Both import this instead.
 *
 * No I/O, no React, no Supabase. Unit-tested in
 * __tests__/artifact-links.test.ts.
 */

/**
 * The one decision the download control makes, named so the label and the
 * element are derived from a single source instead of re-checked branch by
 * branch in the component (see ArtifactBlock in PublishKit.tsx, which used
 * to make this decision inline with no test coverage at all -- the one part
 * of this feature that regressed silently between rounds 2 and 3).
 *
 * - no_file: no stored object exists for this artifact.
 * - other_version: bound to a version other than the one displayed.
 * - retracted: a unique partial index enforces at most one ACTIVE artifact
 *   per (deliverable, version, artifact_type, locale, destination) slot, and
 *   the database rejects a publication receipt that references a superseded
 *   one. This artifact can be shown as evidence but must never be
 *   downloadable, regardless of mayPublish -- ordered ahead of "unapproved"
 *   because retraction is the more specific and more final fact: approving
 *   the piece will never make a retracted artifact publishable.
 * - unapproved: this piece's real, current artifact, but no version is
 *   cleared to publish (see PublishKitPiece.boundArtifactsAreUnapproved).
 * - locked: exists and is bound to an approved/displayed version, but this
 *   piece may not publish for some other reason. Unreachable in production
 *   only because the two writers of approved_version_id (the approval RPC
 *   and deliverables.ts) never set it to anything other than
 *   current_version_id or null; if a future writer ever does, this is the
 *   correct fallback state rather than a crash or a mislabel.
 * - unsigned: exists and is permitted, but the URL failed to sign. Distinct
 *   from "locked" so a signing failure is never told to the operator as if
 *   it were a permission decision.
 * - download: cleared, signed, ready.
 */
export type ArtifactControlState =
  | "no_file"
  | "other_version"
  | "retracted"
  | "unapproved"
  | "locked"
  | "unsigned"
  | "download";

export function artifactControlState(input: {
  storagePath: string | null;
  locked: boolean;
  supersededAt: string | null;
  unapproved: boolean;
  mayPublish: boolean;
  signedUrl: string | null;
}): ArtifactControlState {
  if (!input.storagePath) return "no_file";
  if (input.locked) return "other_version";
  if (input.supersededAt) return "retracted";
  if (input.unapproved) return "unapproved";
  if (!input.mayPublish) return "locked";
  if (!input.signedUrl) return "unsigned";
  return "download";
}

/**
 * Whether a temporary signed URL (and the public path beside it) must be
 * withheld from an export consumer. Three independent reasons, any of which
 * is sufficient: the object is not bound to the deliverable's current
 * version; the deliverable is not cleared to publish; or the artifact has
 * been retracted.
 *
 * This function owns the DECISION. The wording of the withheld line is
 * composed separately at each call site (artifactWithholdReason,
 * versionWithholdReason, both in content-period-export.ts) because the
 * reasons that can apply differ by section -- a version is never a
 * publication_artifacts row, so it can never be retracted. Both
 * link-emitting sections of the Markdown export route their decision
 * through here, so one gate cannot be updated while a sibling is missed:
 * that is the failure that once let renderVersionSection publish an
 * unapproved lead-magnet PDF while renderArtifact correctly withheld the
 * crop beside it.
 */
export function shouldWithholdArtifactLinks(input: {
  matchesCurrentVersion: boolean;
  deliverableMayPublish: boolean;
  supersededAt: string | null;
}): boolean {
  return !input.matchesCurrentVersion || !input.deliverableMayPublish || Boolean(input.supersededAt);
}
