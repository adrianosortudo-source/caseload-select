/**
 * Pure view model for the Publish Kit.
 *
 * Maps a ContentExportBundle (src/lib/content-period-export.ts) into the
 * shape the Publish Kit UI renders, plus the agent-facing record format a
 * publishing agent consumes. No I/O, no Supabase, no React. Everything here
 * is a pure function over already-fetched data; the I/O boundary is
 * content-period-export.ts, not this file.
 *
 * Unit-tested in __tests__/publish-kit-pure.test.ts.
 */

import type {
  ContentExportBundle,
  ContentExportDeliverable,
  ContentExportVersionBody,
  ContentExportArtifact,
} from "@/lib/content-period-export";
import type { DeliverableRole } from "@/lib/types";

// ─── Copy constraints ────────────────────────────────────────────────────────

/**
 * Per-role copy constraints, taken from the client's Content Strategy Book.
 * A role absent from this map has no numeric constraint. These are display
 * and warning aids for the operator: they never block a copy or download,
 * and they never override may_publish.
 */
export interface CopyConstraint {
  maxWords?: number;
  minWords?: number;
  maxChars?: number;
}

export const ROLE_COPY_CONSTRAINTS: Partial<Record<DeliverableRole, CopyConstraint>> = {
  gbp_post: { maxWords: 50, maxChars: 300 },
  social_post: { minWords: 40, maxWords: 80 },
};

// Record<DeliverableRole, true>, not a plain array: adding a member to the
// DeliverableRole union now fails the build until it is listed here too.
// A plain array would silently accept a subset of the union with no error.
const ROLE_PRESENCE: Record<DeliverableRole, true> = {
  article: true,
  social_post: true,
  gbp_post: true,
  lead_magnet_pdf: true,
  landing_page: true,
};
const KNOWN_DELIVERABLE_ROLES = Object.keys(ROLE_PRESENCE) as DeliverableRole[];

/**
 * Narrows a plain string (as stored on ContentExportDeliverable.channel) to
 * a known DeliverableRole, or null when the value is missing or not one of
 * the known roles. Never throws on an unexpected string.
 */
function asDeliverableRole(value: string | null): DeliverableRole | null {
  if (value !== null && (KNOWN_DELIVERABLE_ROLES as string[]).includes(value)) {
    return value as DeliverableRole;
  }
  return null;
}

// ─── HTML to plain text ──────────────────────────────────────────────────────

const BR_TAG = /<br\s*\/?>/gi;
const BLOCK_CLOSE_DOUBLE = /<\/(p|div|h[1-6]|blockquote|section|article)\s*>/gi;
const BLOCK_CLOSE_SINGLE = /<\/(li|tr)\s*>/gi;
const ANY_TAG = /<[^>]+>/g;

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&lt;": "<",
  "&gt;": ">",
};

function decodeEntities(text: string): string {
  return text.replace(/&(amp|quot|#39|apos|nbsp|lt|gt);/g, (match) => ENTITY_MAP[match] ?? match);
}

/**
 * Strips HTML tags and decodes the handful of entities body_html carries,
 * returning plain text suitable for pasting into LinkedIn or Google
 * Business. Block-level closing tags become newlines so paragraphs and list
 * items survive as separate lines; a stripped inline tag never merges the
 * words on either side of it because the surrounding whitespace in the
 * source markup is preserved untouched.
 */
export function htmlToPlainText(html: string | null): string {
  if (!html) return "";

  let text = html;
  text = text.replace(BR_TAG, "\n");
  text = text.replace(BLOCK_CLOSE_DOUBLE, "\n\n");
  text = text.replace(BLOCK_CLOSE_SINGLE, "\n");
  text = text.replace(ANY_TAG, "");
  text = decodeEntities(text);

  // Collapse three or more consecutive newlines (from adjacent block tags)
  // down to a single paragraph break.
  text = text.replace(/\n{3,}/g, "\n\n");
  // Drop trailing spaces/tabs on each line left over from the source markup.
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");

  return text.trim();
}

/** Word count on plain text. Whitespace-delimited; never counts an empty token. */
export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

// ─── Copy constraint readings ────────────────────────────────────────────────

export interface ConstraintReading {
  label: string; // e.g. "words", "characters"
  value: number;
  limitText: string; // e.g. "40-80 allowed", "300 max"
  state: "ok" | "under" | "over";
  pct: number; // 0-100, clamped, for a meter width
}

function clampPct(value: number, base: number): number {
  if (base <= 0) return 0;
  return Math.min(100, Math.round((value / base) * 100));
}

/**
 * Evaluates plain text against a role's copy constraint. Returns one
 * reading per applicable limit (words, characters) so the UI can show a
 * meter per limit. A role with no constraint yields an empty array. This
 * never blocks anything; it is a warning aid only.
 */
export function readConstraints(
  text: string,
  constraint: CopyConstraint | undefined,
): ConstraintReading[] {
  if (!constraint) return [];

  const readings: ConstraintReading[] = [];
  const words = countWords(text);
  const chars = text.length;

  const { minWords, maxWords } = constraint;
  if (minWords !== undefined || maxWords !== undefined) {
    let state: ConstraintReading["state"] = "ok";
    if (maxWords !== undefined && words > maxWords) state = "over";
    else if (minWords !== undefined && words < minWords) state = "under";

    const limitText =
      minWords !== undefined && maxWords !== undefined
        ? `${minWords}-${maxWords} allowed`
        : maxWords !== undefined
          ? `${maxWords} max`
          : `${minWords} min`;

    readings.push({
      label: "words",
      value: words,
      limitText,
      state,
      pct: clampPct(words, maxWords ?? minWords ?? 1),
    });
  }

  if (constraint.maxChars !== undefined) {
    readings.push({
      label: "characters",
      value: chars,
      limitText: `${constraint.maxChars} max`,
      state: chars > constraint.maxChars ? "over" : "ok",
      pct: clampPct(chars, constraint.maxChars),
    });
  }

  return readings;
}

// ─── Publisher lane ──────────────────────────────────────────────────────────

/**
 * Which surface publishes this deliverable, for the publisher filter.
 * "pipeline" -> firm_website destinations (articles, landing pages, PDFs),
 * deployed by the existing publishing pipeline.
 * "manual"   -> linkedin and google_business_profile, posted by hand today.
 * "unknown"  -> destination not recorded.
 */
export type PublisherLane = "pipeline" | "manual" | "unknown";

export function publisherLane(destination: string | null): PublisherLane {
  if (destination === "firm_website") return "pipeline";
  if (destination === "linkedin" || destination === "google_business_profile") return "manual";
  return "unknown";
}

/**
 * The single destination link a piece publishes to, resolved per role:
 * cta_target_path for gbp_post and social_post (publication_path is always
 * null for those two roles by design), publication_path for every other
 * role. Null when neither is recorded. See ContentDeliverable.cta_target_path
 * (DR-097) for why the two columns split this way.
 */
export function resolveDestinationPath(
  role: DeliverableRole | null,
  publicationPath: string | null,
  ctaTargetPath: string | null,
): string | null {
  if (role === "gbp_post" || role === "social_post") return ctaTargetPath;
  return publicationPath;
}

// ─── View model types ────────────────────────────────────────────────────────

export interface PublishKitArtifact {
  id: string;
  /**
   * The deliverable version this artifact was registered against. Compare
   * against `PublishKitPiece.displayedVersionId ?? currentVersionId` before
   * ever treating this as evidence for the piece currently on screen --
   * NOT against displayedVersionId alone. A blocked piece's own bound
   * artifacts have versionId equal to currentVersionId while
   * displayedVersionId is null (see boundArtifactsAreUnapproved); comparing
   * only against displayedVersionId would wrongly conclude they are not
   * evidence for this piece.
   */
  versionId: string;
  artifactType: string;
  locale: string | null;
  destination: string | null;
  filename: string | null; // basename of storagePath, or null
  storagePath: string | null;
  publicUrl: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  mime: string | null;
  signedUrl: string | null;
  signedUrlExpiresAt: string | null;
  /** When this artifact row was created. See dedupeArtifacts. */
  createdAt: string;
  /**
   * When this artifact was retracted, or null when it is active. An active
   * artifact always wins dedupeArtifacts over a superseded one, regardless of
   * createdAt. See dedupeArtifacts.
   */
  supersededAt: string | null;
  validation: { validator: string; result: string; created_at: string } | null;
}

export interface PublishKitPiece {
  id: string;
  title: string;
  format: string | null;
  role: DeliverableRole | null; // from bundle.channel
  locale: string | null;
  contentKind: string;
  status: string;
  publishDate: string | null;
  destination: string | null;
  publicationPath: string | null;
  /** Raw cta_target_path column. Null except for gbp_post and social_post. */
  ctaTargetPath: string | null;
  /** The resolved link this piece publishes to. See resolveDestinationPath. */
  destinationPath: string | null;
  lane: PublisherLane;
  mayPublish: boolean;
  mayPublishReason: string | null;
  bodyHtml: string | null; // approved/current version body
  plainText: string; // htmlToPlainText(bodyHtml)
  constraints: ConstraintReading[];
  versionNumber: number | null;
  versionAsset: {
    name: string | null;
    mime: string | null;
    sizeBytes: number | null;
    sha256: string | null;
    /** Canonical, non-expiring identity of this asset. Never expires, unlike signedUrl. */
    storagePath: string | null;
    signedUrl: string | null;
    signedUrlExpiresAt: string | null;
  } | null;
  /** The version whose body and assets this card is showing. */
  displayedVersionId: string | null;
  /**
   * The deliverable's current version, whether or not it is approved. Distinct
   * from displayedVersionId, which is null when nothing is cleared to show.
   * An artifact bound to this id belongs to THIS piece as it stands now -- it
   * is simply not approved -- and must never be described as another
   * version's.
   */
  currentVersionId: string | null;
  /**
   * displayedVersionId ?? currentVersionId -- the version bound artifacts are
   * evidence for, which is what a "Bound to version" provenance display
   * should show. Exists so the component reads this precomputed value
   * instead of re-deriving the same expression itself, which would be a
   * second, independent copy of a decision the pure layer already made.
   */
  anchorVersionId: string | null;
  /**
   * True when the bound artifacts belong to the current version but no version
   * is cleared to publish. They are this piece's real, current artifacts --
   * download-locked, but NOT another version's.
   */
  boundArtifactsAreUnapproved: boolean;
  /** Artifacts bound to displayedVersionId (or currentVersionId, when nothing is displayed) only. */
  artifacts: PublishKitArtifact[];
  /**
   * Artifacts registered against a DIFFERENT version than the one displayed.
   * Never downloadable, never in the agent record: a crop cut for another
   * version is not evidence for this one.
   */
  otherVersionArtifacts: PublishKitArtifact[];
  /**
   * Whether the artifacts panel will render anything at all, INCLUDING the
   * "Artifacts from other versions" disclosure. Gates the panel's own
   * empty-state message ("No artifacts registered for this piece yet.").
   * Deliberately broader than hasCurrentArtifactToShow: an other-version
   * artifact means the panel is not empty, but it is explicitly not evidence
   * for this piece, so this flag must never be used to justify a claim
   * about what THIS piece delivers -- see hasCurrentArtifactToShow for that.
   */
  hasAnyArtifactToShow: boolean;
  /**
   * Whether THIS piece's own current-version content -- its version asset or
   * an artifact bound to it -- is present. Deliberately excludes
   * otherVersionArtifacts. The copy column's file-delivery message
   * ("This piece is delivered as a file...") is only true when this is true;
   * hasAnyArtifactToShow is not sufficient, because it can be true solely
   * from other-version artifacts that are not this piece's content.
   */
  hasCurrentArtifactToShow: boolean;
  /**
   * Whether this piece's CURRENT version has copy that renders to any text,
   * independent of approval status. Answers "does a draft exist to send the
   * operator to read", not "is a version cleared to publish" -- distinct
   * from plainText being non-empty, which additionally requires mayPublish.
   * Deliberately checked via htmlToPlainText, not Boolean(body_html): an
   * empty paragraph ("<p></p>", "<p><br></p>", "<p>&nbsp;</p>") is a
   * non-empty STRING that the version-post route accepts (it only rejects
   * when the sanitizer returns truly empty), so Boolean(body_html) alone
   * would still be true with nothing to read. Used to stop the copy column
   * claiming a blocked piece "has copy" when its current version has none.
   */
  currentVersionHasBody: boolean;
  unresolvedCommentCount: number;
  changeRequestedAt: string | null;
  warnings: string[];
}

export interface PublishKitDateGroup {
  date: string; // "" for the undated group
  pieces: PublishKitPiece[];
}

export interface PublishKitView {
  periodId: string;
  periodTitle: string | null;
  startsOn: string;
  endsOn: string;
  firmId: string;
  firmName: string | null;
  generatedAt: string;
  totals: {
    total: number;
    publishable: number;
    blocked: number;
    manual: number;
    pipeline: number;
  };
  groups: PublishKitDateGroup[];
  bundleWarnings: string[];
}

// ─── Ordering and grouping ───────────────────────────────────────────────────

/**
 * Sort key for display order: by publishDate ascending (nulls last), then
 * by title, then by id. The id tiebreak matters: two pieces can genuinely
 * share both a publishDate and a title (e.g. the same Counsel Note copy
 * posted to two locales), and without a final total-order key their
 * relative order would depend on input order, which is not guaranteed
 * stable across queries. Deterministic: never depends on the current
 * date/time.
 */
export function comparePieces(a: PublishKitPiece, b: PublishKitPiece): number {
  const aDate = a.publishDate;
  const bDate = b.publishDate;
  if (aDate === null && bDate === null) return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  if (aDate === null) return 1;
  if (bDate === null) return -1;
  if (aDate < bDate) return -1;
  if (aDate > bDate) return 1;
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

/**
 * Groups pieces under their publishDate. Pieces with a null publishDate
 * land in a single trailing group keyed "" (rendered "No publication date
 * recorded" by the UI). Dated groups are returned in ascending date order;
 * the undated group, when present, always comes last.
 */
export function groupByPublishDate(pieces: PublishKitPiece[]): PublishKitDateGroup[] {
  const sorted = [...pieces].sort(comparePieces);

  const byDate = new Map<string, PublishKitPiece[]>();
  for (const piece of sorted) {
    const key = piece.publishDate ?? "";
    const list = byDate.get(key) ?? [];
    list.push(piece);
    byDate.set(key, list);
  }

  const datedKeys = [...byDate.keys()].filter((key) => key !== "").sort();
  const groups: PublishKitDateGroup[] = datedKeys.map((date) => ({
    date,
    pieces: byDate.get(date) as PublishKitPiece[],
  }));

  const undated = byDate.get("");
  if (undated) groups.push({ date: "", pieces: undated });

  return groups;
}

// ─── Copy column presentation ────────────────────────────────────────────────

/**
 * Which sentence the copy column shows when a piece has no displayable copy.
 * Lives here, not in PublishKit.tsx, because it is a claim about the piece --
 * and every claim this feature makes is decided and tested in the pure
 * layer, per the module header. The component selects presentation; it does
 * not decide truth. Before this function existed, the identical ternary sat
 * inline in PublishKit.tsx, a "use client" component vitest never collects,
 * so round 6's change to it was verified only by re-reading the file: no
 * test failed when the decision was reverted to the round-5 version.
 *
 * - file_delivery: this piece's own current-version content (its version
 *   asset or a bound artifact) is present, for an image/pdf role.
 * - has_unapproved_copy: no version is cleared to publish, but the current
 *   version has copy that renders to actual text.
 * - no_copy: neither of the above -- there is genuinely nothing to show.
 */
export type CopyColumnMessage = "file_delivery" | "has_unapproved_copy" | "no_copy";

export function copyColumnMessage(piece: PublishKitPiece): CopyColumnMessage {
  if ((piece.contentKind === "image" || piece.contentKind === "pdf") && piece.hasCurrentArtifactToShow) {
    return "file_delivery";
  }
  if (!piece.mayPublish && piece.currentVersionHasBody) return "has_unapproved_copy";
  return "no_copy";
}

// ─── Filtering and filtered totals ───────────────────────────────────────────

/** null in either field means "no filter on that dimension". */
export interface PublishKitFilter {
  channel: string | null;
  lane: PublisherLane | null;
}

export function pieceMatchesFilter(piece: PublishKitPiece, filter: PublishKitFilter): boolean {
  const channelOk = filter.channel === null || piece.destination === filter.channel;
  const laneOk = filter.lane === null || piece.lane === filter.lane;
  return channelOk && laneOk;
}

/**
 * Totals over the pieces a filter actually shows, not the whole period.
 * Presenting period totals above a filtered list would claim the operator is
 * seeing counts they are not: with a filter active, the header could read
 * "14 total / 2 blocked" while the list below shows 3 pieces and neither
 * blocked one. isFiltered lets the caller mark the numbers as filtered
 * rather than mistaking them for the period's real totals.
 */
export function filteredTotals(
  view: PublishKitView,
  filter: PublishKitFilter,
): { total: number; publishable: number; blocked: number; isFiltered: boolean } {
  const isFiltered = filter.channel !== null || filter.lane !== null;
  if (!isFiltered) {
    return { ...view.totals, isFiltered: false };
  }
  const visible = view.groups.flatMap((g) => g.pieces).filter((p) => pieceMatchesFilter(p, filter));
  return {
    total: visible.length,
    publishable: visible.filter((p) => p.mayPublish).length,
    blocked: visible.filter((p) => !p.mayPublish).length,
    isFiltered: true,
  };
}

/**
 * True when every blocked piece in the view genuinely has both its links
 * stripped and no publishable copy -- the two claims the blocked banner
 * makes ("downloads are withheld and copy controls are locked"). Rendering
 * that sentence when this is false would tell the operator something untrue
 * about material they can see. In practice this is always true -- toPiece's
 * strip already guarantees it -- but the point is that the sentence is now
 * pinned to the fact rather than asserted unconditionally: if a future
 * change ever leaks a link into a blocked piece, the banner stops making
 * the claim instead of lying.
 */
export function blockedPiecesAreFullyWithheld(view: PublishKitView): boolean {
  return view.groups
    .flatMap((g) => g.pieces)
    .filter((p) => !p.mayPublish)
    .every(
      (p) =>
        p.artifacts.every((a) => a.signedUrl === null) &&
        (p.versionAsset === null || p.versionAsset.signedUrl === null),
    );
}

// ─── Agent-facing records ────────────────────────────────────────────────────

interface AgentRecordBase {
  deliverable_id: string;
  title: string;
  role: DeliverableRole | null;
  channel: string | null; // publication_destination: firm_website | linkedin | google_business_profile
  locale: string | null;
  version_number: number | null;
  publisher_lane: PublisherLane;
  scheduled_day: string | null;
  publishable: boolean;
}

export interface AgentRecordWithheld extends AgentRecordBase {
  withheld: true;
  blocked_reason: string | null;
  note: string;
}

export interface AgentRecordPublishable extends AgentRecordBase {
  withheld: false;
  body: string;
  plain_text: string;
  /** The resolved link this piece publishes to. See resolveDestinationPath. */
  destination: string | null;
  /** Raw publication_path column, for a consumer that wants it unresolved. */
  publication_path: string | null;
  /** Raw cta_target_path column, for a consumer that wants it unresolved. */
  cta_target_path: string | null;
  /**
   * Artifacts bound to the version being published. An entry whose
   * `supersededAt` is non-null has been retracted: it carries no `signedUrl`
   * (see stripAccess in toPiece) and must never be published. The database
   * rejects a publication receipt that references a superseded artifact.
   */
  artifacts: PublishKitArtifact[];
  /**
   * For an image or pdf deliverable the version asset IS the deliverable's
   * content, so this is what an agent publishes when there is no separate
   * artifact. Null when the version carries no asset.
   */
  version_asset: {
    name: string | null;
    mime: string | null;
    size_bytes: number | null;
    sha256: string | null;
    storage_path: string | null;
    signed_url: string | null;
  } | null;
}

export type AgentRecord = AgentRecordWithheld | AgentRecordPublishable;

/**
 * The agent-facing record for ONE piece. When the piece is not publishable,
 * `body`, `plain_text`, `destination`, and `artifacts` are OMITTED (never
 * present as keys, not merely set to null/undefined) and `withheld: true` is
 * set together with the exact blocking reason. This is a deliberate safety
 * property: a caller -- human or agent -- is never handed material it is
 * not cleared to publish. See publish-kit-pure.test.ts for the assertion
 * that proves the keys are genuinely absent.
 */
export function toAgentRecord(piece: PublishKitPiece): AgentRecord {
  const base: AgentRecordBase = {
    deliverable_id: piece.id,
    title: piece.title,
    role: piece.role,
    channel: piece.destination,
    locale: piece.locale,
    version_number: piece.versionNumber,
    publisher_lane: piece.lane,
    scheduled_day: piece.publishDate,
    publishable: piece.mayPublish,
  };

  if (!piece.mayPublish) {
    return {
      ...base,
      // Nulled, not passed through: piece.versionNumber can be the current
      // (unapproved) version's number since FU5-4 made it findable for
      // blocked file deliverables. The withheld record's own contract is
      // that a blocked caller receives nothing about the blocked content
      // beyond the reason -- a version number is not content, but it is
      // still information about a version nothing has approved, and this
      // record predates FU5-4 always emitting null here.
      version_number: null,
      withheld: true,
      blocked_reason: piece.mayPublishReason,
      note: "Copy, asset, and destination are withheld until this clears.",
    };
  }

  return {
    ...base,
    withheld: false,
    body: piece.bodyHtml ?? "",
    plain_text: piece.plainText,
    destination: piece.destinationPath,
    publication_path: piece.publicationPath,
    cta_target_path: piece.ctaTargetPath,
    artifacts: piece.artifacts,
    version_asset: piece.versionAsset
      ? {
          name: piece.versionAsset.name,
          mime: piece.versionAsset.mime,
          size_bytes: piece.versionAsset.sizeBytes,
          sha256: piece.versionAsset.sha256,
          storage_path: piece.versionAsset.storagePath,
          signed_url: piece.versionAsset.signedUrl,
        }
      : null,
  };
}

export interface AgentManifest {
  period_id: string;
  period_title: string | null;
  starts_on: string;
  ends_on: string;
  firm_id: string;
  firm_name: string | null;
  generated_at: string;
  totals: PublishKitView["totals"];
  deliverables: AgentRecord[];
}

/**
 * The whole period as agent records, plus period metadata. Every piece is
 * included, publishable or not, so a caller can report what is blocked and
 * why rather than silently reporting a shorter week.
 */
export function toAgentManifest(view: PublishKitView): AgentManifest {
  const allPieces = view.groups.flatMap((group) => group.pieces);
  return {
    period_id: view.periodId,
    period_title: view.periodTitle,
    starts_on: view.startsOn,
    ends_on: view.endsOn,
    firm_id: view.firmId,
    firm_name: view.firmName,
    generated_at: view.generatedAt,
    totals: view.totals,
    deliverables: allPieces.map(toAgentRecord),
  };
}

// ─── Bundle -> view model ────────────────────────────────────────────────────

function toVersionAsset(version: ContentExportVersionBody | null): PublishKitPiece["versionAsset"] {
  if (!version || !version.storage_path) return null;
  return {
    name: version.asset_name,
    mime: version.asset_mime,
    sizeBytes: version.asset_size_bytes,
    sha256: version.asset_sha256,
    storagePath: version.storage_path,
    signedUrl: version.signed_url,
    signedUrlExpiresAt: version.signed_url_expires_at,
  };
}

/**
 * Selects which version's body this piece renders, per the source-integrity
 * rule the whole feature rests on: current_version is only ever rendered
 * when it IS the approved version (may_publish true). When may_publish is
 * false, the approved_version is rendered instead (with a warning), never
 * the newer, unapproved current_version. When neither exists, the body is
 * null rather than falling back to unapproved content.
 */
function selectVersion(deliverable: ContentExportDeliverable): {
  bodyHtml: string | null;
  versionNumber: number | null;
  versionId: string | null;
  versionAsset: PublishKitPiece["versionAsset"];
  warnings: string[];
} {
  if (deliverable.may_publish) {
    return {
      bodyHtml: deliverable.current_version?.body_html ?? null,
      versionNumber: deliverable.current_version?.version_number ?? null,
      versionId: deliverable.current_version?.id ?? null,
      versionAsset: toVersionAsset(deliverable.current_version),
      warnings: [],
    };
  }

  if (deliverable.approved_version) {
    return {
      bodyHtml: deliverable.approved_version.body_html,
      versionNumber: deliverable.approved_version.version_number,
      versionId: deliverable.approved_version.id,
      versionAsset: toVersionAsset(deliverable.approved_version),
      warnings: ["Showing the approved version. A newer unapproved version exists."],
    };
  }

  // No version is cleared to display. The body stays hidden -- unapproved
  // copy is never rendered here -- but the current version's ASSET is still
  // this piece's real content for an image or pdf deliverable (the version
  // asset IS the deliverable for those roles), so it is surfaced rather than
  // silently omitted. It renders download-locked and labelled "Not approved"
  // by artifactControlState, via PublishKitPiece.boundArtifactsAreUnapproved.
  // versionId stays null: nothing is cleared to show, which is exactly what
  // displayedVersionId means.
  return {
    bodyHtml: null,
    versionNumber: deliverable.current_version?.version_number ?? null,
    versionId: null,
    versionAsset: toVersionAsset(deliverable.current_version),
    warnings: [],
  };
}

function basename(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split("/");
  return parts[parts.length - 1] || null;
}

function toArtifact(artifact: ContentExportArtifact): PublishKitArtifact {
  return {
    id: artifact.id,
    versionId: artifact.version_id,
    artifactType: artifact.artifact_type,
    locale: artifact.locale,
    destination: artifact.destination,
    filename: basename(artifact.storage_path),
    storagePath: artifact.storage_path,
    publicUrl: artifact.public_url,
    sha256: artifact.sha256,
    sizeBytes: artifact.size_bytes,
    mime: artifact.mime_type,
    signedUrl: artifact.signed_url,
    signedUrlExpiresAt: artifact.signed_url_expires_at,
    createdAt: artifact.created_at,
    supersededAt: artifact.superseded_at,
    validation: artifact.latest_validation
      ? {
          validator: artifact.latest_validation.validator,
          result: artifact.latest_validation.result,
          created_at: artifact.latest_validation.created_at,
        }
      : null,
  };
}

/**
 * Removes every working link (the signed download URL and its expiry, and
 * the public URL) from an artifact, keeping its durable identity
 * (storagePath, sha256, filename). Applied to every artifact whose access
 * must be withheld -- a genuinely other-version artifact, or this piece's
 * own artifact when the piece is not cleared to publish -- so the guarantee
 * is structural, not merely a UI choice: PublishKit is a "use client"
 * component, so every field on the view model is serialised into the page's
 * RSC payload regardless of what JSX conditionally renders.
 *
 * publicUrl is withheld here too, not just signedUrl. An earlier round kept
 * publicUrl on this piece's own bound artifacts when blocked, reasoned as
 * "that content is approved and its public URL is public" -- but that
 * artifact is the CURRENT, unapproved artifact (see
 * PublishKitPiece.boundArtifactsAreUnapproved), not an approved one, so the
 * reasoning did not hold: withholding it grants no confidentiality against
 * genuinely public content, but keeping it exposes a live link to material
 * that was just rejected or is still awaiting review, sitting in the RSC
 * payload right beside a "Not approved" label.
 */
function stripAccess(artifact: PublishKitArtifact): PublishKitArtifact {
  return { ...artifact, signedUrl: null, signedUrlExpiresAt: null, publicUrl: null };
}

// ─── Artifact control state ──────────────────────────────────────────────────

export { artifactControlState, type ArtifactControlState } from "@/lib/artifact-links";

/**
 * Splits this deliverable's artifacts into those bound to the anchor version
 * and those bound to any other version. The anchor is the displayed version
 * when one is cleared to show, or -- when nothing is displayed -- the
 * deliverable's current version, because an artifact bound to the current
 * version belongs to THIS piece as it stands now, not to "another version".
 * Only when there is no current version at all (anchorVersionId null) does
 * every artifact fall to "other", since there is then no version on screen
 * for anything to be evidence for. Every "other" artifact has its signed URL
 * stripped (see stripAccess); only the bound list ever carries a working
 * download link, and the caller strips the bound list too whenever the
 * piece itself may not publish (see toPiece).
 */
function partitionArtifacts(
  artifacts: PublishKitArtifact[],
  anchorVersionId: string | null,
): { bound: PublishKitArtifact[]; other: PublishKitArtifact[] } {
  if (!anchorVersionId) return { bound: [], other: artifacts.map(stripAccess) };
  return {
    bound: artifacts.filter((a) => a.versionId === anchorVersionId),
    other: artifacts.filter((a) => a.versionId !== anchorVersionId).map(stripAccess),
  };
}

/**
 * The full slot identity of an artifact WITHIN one version: type, locale, and
 * destination together. Two artifacts can legitimately share type and locale
 * while targeting different surfaces -- a LinkedIn feed scrim and a Google
 * Business photo-scrim are both plausibly social_image/en-CA -- so
 * destination must be part of the key or one of them is silently discarded
 * as a false "duplicate".
 */
function slotKey(a: PublishKitArtifact): string {
  return `${a.artifactType}::${a.locale ?? ""}::${a.destination ?? ""}`;
}

/**
 * A unique partial index enforces at most one ACTIVE publication_artifacts
 * row per (deliverable, version, artifact_type, locale, destination) slot;
 * replacing an artifact for the same slot stamps supersededAt on the prior
 * row first rather than mutating or deleting it. Without deduping, an active
 * row and its superseded predecessor(s) would both render as if they were
 * current. Keeps one artifact per key produced by keyOf: an ACTIVE artifact
 * always wins over a superseded one regardless of createdAt (a superseded row
 * is historical evidence only and a publication receipt referencing it is
 * rejected at the database level); among two artifacts of the same active/
 * superseded status, the more recently created one wins, and ties on
 * identical createdAt (two rows inserted in the same transaction, so
 * ordering from the database is not guaranteed) break on the higher id, so
 * the result is stable across page loads rather than depending on arbitrary
 * row order. Returns the discarded count so the caller can surface it as a
 * warning rather than silently dropping data.
 */
function dedupeArtifacts(
  artifacts: PublishKitArtifact[],
  keyOf: (a: PublishKitArtifact) => string,
): { kept: PublishKitArtifact[]; discardedCount: number } {
  const winnerByKey = new Map<string, PublishKitArtifact>();
  for (const a of artifacts) {
    const key = keyOf(a);
    const existing = winnerByKey.get(key);
    if (!existing) {
      winnerByKey.set(key, a);
      continue;
    }
    const aActive = !a.supersededAt;
    const existingActive = !existing.supersededAt;
    const aWins =
      aActive !== existingActive
        ? aActive
        : a.createdAt > existing.createdAt ||
          (a.createdAt === existing.createdAt && a.id > existing.id);
    if (aWins) winnerByKey.set(key, a);
  }
  // Map iteration order is first-insertion order, which follows the input
  // array -- and the query that produces that array carries no ORDER BY, so
  // without an explicit sort here the returned order (and therefore which
  // artifact block reads as "the second image") can silently reshuffle
  // between page loads with no data change at all. Every sort key is a
  // plain string present on every artifact, so this is total and stable.
  const kept = [...winnerByKey.values()].sort((a, b) => {
    if (a.artifactType !== b.artifactType) return a.artifactType.localeCompare(b.artifactType);
    const aLocale = a.locale ?? "";
    const bLocale = b.locale ?? "";
    if (aLocale !== bLocale) return aLocale.localeCompare(bLocale);
    const aDestination = a.destination ?? "";
    const bDestination = b.destination ?? "";
    if (aDestination !== bDestination) return aDestination.localeCompare(bDestination);
    return a.id.localeCompare(b.id);
  });
  return { kept, discardedCount: artifacts.length - kept.length };
}

function toPiece(deliverable: ContentExportDeliverable): PublishKitPiece {
  const role = asDeliverableRole(deliverable.channel);
  const {
    bodyHtml,
    versionNumber,
    versionId,
    versionAsset,
    warnings: versionWarnings,
  } = selectVersion(deliverable);
  const plainText = htmlToPlainText(bodyHtml);
  const constraints = readConstraints(plainText, role ? ROLE_COPY_CONSTRAINTS[role] : undefined);

  const allArtifacts = deliverable.artifacts.map(toArtifact);
  // deliverable.current_version is non-null only when content-period-export's
  // resolveOwnedVersion proved the row exists AND belongs to this
  // deliverable. Anchoring on the raw current_version_id pointer instead
  // would let a dangling or cross-wired pointer promote another
  // deliverable's artifacts into this piece's main panel as its own.
  const ownedCurrentVersionId = deliverable.current_version?.id ?? null;
  const anchorVersionId = versionId ?? ownedCurrentVersionId;
  const { bound: rawBoundArtifacts, other: rawOtherArtifacts } = partitionArtifacts(
    allArtifacts,
    anchorVersionId,
  );
  const boundArtifactsAreUnapproved = versionId === null && ownedCurrentVersionId !== null;
  const { kept: dedupedBoundArtifacts, discardedCount } = dedupeArtifacts(rawBoundArtifacts, slotKey);
  const dedupeWarnings =
    discardedCount > 0
      ? [
          `${discardedCount} duplicate artifact${discardedCount === 1 ? "" : "s"} for this version ${
            discardedCount === 1 ? "was" : "were"
          } filtered; one artifact is shown per slot, preferring an active row over a retracted one and, among equals, the most recently created.`,
        ]
      : [];
  // Two independent reasons to withhold a working link from a bound artifact,
  // applied together: the piece is not cleared to publish, OR this specific
  // artifact has been retracted (a superseded row is historical evidence; a
  // publication receipt referencing it is rejected at the database level).
  // The strip is structural rather than a UI choice: PublishKit is a
  // "use client" component, so every field on the view model is serialised
  // into the page regardless of what JSX renders. A retracted artifact is
  // withheld even on an otherwise publishable piece -- retraction is not
  // "unapproved", it does not go away on approval.
  const boundArtifacts = dedupedBoundArtifacts.map((a) =>
    !deliverable.may_publish || a.supersededAt ? stripAccess(a) : a,
  );
  const retractedCount = boundArtifacts.filter((a) => a.supersededAt).length;
  const retractedSlotWarnings =
    retractedCount > 0
      ? [
          `${retractedCount} artifact slot${retractedCount === 1 ? " has" : "s have"} been retracted with no active replacement. ${
            retractedCount === 1 ? "It is" : "They are"
          } shown for reference and cannot be published.`,
        ]
      : [];

  // The "other versions" panel spans multiple versions, so its dedupe key
  // must include versionId: a slot key alone would collapse legitimate
  // artifacts from two DIFFERENT other versions into one. No warning is
  // emitted here -- this is historical context, not publishable inventory.
  const { kept: otherVersionArtifacts } = dedupeArtifacts(
    rawOtherArtifacts,
    (a) => `${a.versionId}::${slotKey(a)}`,
  );

  const strippedVersionAsset =
    !deliverable.may_publish && versionAsset
      ? { ...versionAsset, signedUrl: null, signedUrlExpiresAt: null }
      : versionAsset;
  const hasAnyArtifactToShow =
    Boolean(strippedVersionAsset) || boundArtifacts.length > 0 || otherVersionArtifacts.length > 0;
  const hasCurrentArtifactToShow = Boolean(strippedVersionAsset) || boundArtifacts.length > 0;
  const currentVersionHasBody =
    htmlToPlainText(deliverable.current_version?.body_html ?? null).length > 0;

  return {
    id: deliverable.id,
    title: deliverable.title,
    format: deliverable.format,
    role,
    locale: deliverable.locale,
    contentKind: deliverable.content_kind,
    status: deliverable.status,
    publishDate: deliverable.publish_date,
    destination: deliverable.publication_destination,
    publicationPath: deliverable.publication_path,
    ctaTargetPath: deliverable.cta_target_path,
    destinationPath: resolveDestinationPath(role, deliverable.publication_path, deliverable.cta_target_path),
    lane: publisherLane(deliverable.publication_destination),
    mayPublish: deliverable.may_publish,
    mayPublishReason: deliverable.may_publish_reason,
    bodyHtml,
    plainText,
    constraints,
    versionNumber,
    versionAsset: strippedVersionAsset,
    displayedVersionId: versionId,
    currentVersionId: ownedCurrentVersionId,
    anchorVersionId,
    boundArtifactsAreUnapproved,
    artifacts: boundArtifacts,
    otherVersionArtifacts,
    hasAnyArtifactToShow,
    hasCurrentArtifactToShow,
    currentVersionHasBody,
    unresolvedCommentCount: deliverable.unresolved_comments.length,
    changeRequestedAt: deliverable.unresolved_change_request?.requested_at ?? null,
    warnings: [...deliverable.warnings, ...versionWarnings, ...dedupeWarnings, ...retractedSlotWarnings],
  };
}

/** Maps a raw bundle into the view model the Publish Kit UI renders. */
export function toPublishKitView(bundle: ContentExportBundle): PublishKitView {
  const pieces = bundle.deliverables.map(toPiece);
  const groups = groupByPublishDate(pieces);

  const publishableCount = pieces.filter((p) => p.mayPublish).length;
  const manualCount = pieces.filter((p) => p.lane === "manual").length;
  const pipelineCount = pieces.filter((p) => p.lane === "pipeline").length;

  return {
    periodId: bundle.period.id,
    periodTitle: bundle.period.title,
    startsOn: bundle.period.starts_on,
    endsOn: bundle.period.ends_on,
    firmId: bundle.firm.id,
    firmName: bundle.firm.name,
    generatedAt: bundle.generated_at,
    totals: {
      total: pieces.length,
      publishable: publishableCount,
      blocked: pieces.length - publishableCount,
      manual: manualCount,
      pipeline: pipelineCount,
    },
    groups,
    bundleWarnings: bundle.warnings,
  };
}
