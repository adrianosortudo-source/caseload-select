/**
 * CR-17: Asset detail drawer (Section 12). Renders the 8 required sections
 * in this exact order. Sections 6 (Binding) and 7 (Rendered verification)
 * have no real data source in this build -- no migration is applied
 * anywhere, and no rendered-verification evidence pipeline exists yet --
 * so they render an explicit "not yet available" state rather than fake
 * data. Everything else is derived from the manifest + registered
 * candidates, exactly like the rest of this build.
 */
import type { AssetCard, AssetRoleGroup } from "@/lib/publishing-package-control-room-assets";
import type { AssetRole } from "@/lib/publishing-package-control-room-manifest";

interface AssetDetailViewProps {
  piece: { pieceTitle: string; sourceVersionId: string | null; approvalStatus: string };
  /** The card the drawer was opened from -- drives section 1 (Requirement). */
  focusedCard: AssetCard;
  /** Every card (candidates + any gap) sharing this exact piece+role+destination, in registration order -- section 3. */
  candidates: AssetCard[];
  /** Every required-asset role group for this piece -- used to find the canonical master (section 4) and to enumerate destination renditions (section 5). */
  pieceRoleGroups: AssetRoleGroup[];
}

const CANDIDATE_LABELS = ["A", "B", "C", "D", "E", "F"];

/** Section 5's literal 6-role list, in the spec's own order. */
const DESTINATION_RENDITION_ROLES: { role: AssetRole; label: string }[] = [
  { role: "website_article_hero", label: "Website hero" },
  { role: "native_linkedin_article_cover", label: "Native LinkedIn Article cover" },
  { role: "linkedin_post_card", label: "LinkedIn post card" },
  { role: "gbp_card", label: "GBP card" },
  { role: "lead_magnet_document_hero", label: "Lead Magnet Document hero" },
  { role: "lead_magnet_landing_page_hero", label: "Landing Page hero" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-black/8 pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-navy/70 mb-2">{title}</h3>
      {children}
    </section>
  );
}

function eligibilityFor(card: AssetCard): string {
  if (card.kind === "requirement_gap") return "candidate-only (no candidate registered)";
  if (card.status === "release_ready" || card.status === "rendered_verified" || card.status === "bound") return "release-eligible";
  if (card.isSelected) return "selected, not yet release-eligible";
  return "candidate-only";
}

export default function AssetDetailView({ piece, focusedCard, candidates, pieceRoleGroups }: AssetDetailViewProps) {
  const canonicalGroup = pieceRoleGroups.find((r) => r.assetRole === "canonical_textless_master");
  const canonicalCandidate = canonicalGroup?.cards.find((c) => c.kind === "candidate");

  const selected = candidates.find((c) => c.isSelected);

  return (
    <div className="space-y-4 text-sm">
      <Section title="1. Requirement">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-black/40">Content piece</dt><dd className="text-black/80">{piece.pieceTitle}</dd>
          <dt className="text-black/40">Source deliverable/version</dt><dd className="text-black/80">{piece.sourceVersionId ? piece.sourceVersionId.slice(0, 8) : "not resolved"}</dd>
          <dt className="text-black/40">Locale</dt><dd className="text-black/80">{focusedCard.locale}</dd>
          <dt className="text-black/40">Destination</dt><dd className="text-black/80">{focusedCard.destination}</dd>
          <dt className="text-black/40">Role</dt><dd className="text-black/80">{focusedCard.assetRole}</dd>
          <dt className="text-black/40">Dimensions</dt><dd className="text-black/80">{focusedCard.requiredWidth}×{focusedCard.requiredHeight}</dd>
          <dt className="text-black/40">Safe area</dt><dd className="text-black/80">{focusedCard.safeArea}</dd>
          <dt className="text-black/40">Text policy</dt><dd className="text-black/80">{focusedCard.textPolicy}</dd>
          <dt className="text-black/40">Required copy</dt><dd className="text-black/80">{focusedCard.requiredCopy ?? "none"}</dd>
          <dt className="text-black/40">Alt text</dt><dd className="text-black/80">{focusedCard.altText ?? "required, not yet provided"}</dd>
        </dl>
      </Section>

      <Section title="2. Source diagnosis">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-black/40">Resolved source</dt><dd className="text-black/80">{piece.sourceVersionId ? `version ${piece.sourceVersionId.slice(0, 8)}` : "unresolved"}</dd>
          <dt className="text-black/40">Source approval state</dt><dd className="text-black/80">{piece.approvalStatus}</dd>
          <dt className="text-black/40">Source/current-version relationship</dt><dd className="text-black/80">current</dd>
          <dt className="text-black/40">Source mismatch</dt><dd className="text-black/80">{piece.sourceVersionId ? "none" : "no source version resolved for this piece"}</dd>
          <dt className="text-black/40">Eligibility</dt><dd className="text-black/80">{eligibilityFor(focusedCard)}</dd>
        </dl>
      </Section>

      <Section title="3. Candidate comparison">
        <p className="text-[11px] text-black/50 mb-2">
          Visual selection does not approve the content, authorize publication, or confirm release readiness.
        </p>
        {candidates.filter((c) => c.kind === "candidate").length === 0 ? (
          <p className="text-xs text-black/40">No candidates registered yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {candidates
              .filter((c) => c.kind === "candidate")
              .map((c, i) => (
                <div key={c.assetId} className={`border p-2.5 text-xs ${c.isSelected ? "border-navy" : "border-black/10"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-navy">{CANDIDATE_LABELS[i] ?? i + 1}</span>
                    <span className="text-[10px] uppercase text-black/40">{c.status}</span>
                  </div>
                  <div className="truncate text-black/70">{c.filename}</div>
                  {c.isSelected && <div className="text-navy font-medium mt-1">Selected</div>}
                </div>
              ))}
          </div>
        )}
        {selected && <p className="text-[11px] text-black/50 mt-2">Selection reason: not recorded (requires a live operator action; not available in this build).</p>}
      </Section>

      <Section title="4. Canonical master">
        {canonicalCandidate ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-black/40">Dimensions</dt><dd className="text-black/80">{canonicalCandidate.width}×{canonicalCandidate.height}</dd>
            <dt className="text-black/40">Hash</dt><dd className="text-black/80 font-mono break-all">{canonicalCandidate.sha256}</dd>
            <dt className="text-black/40">Locale</dt><dd className="text-black/80">{canonicalCandidate.locale}</dd>
            <dt className="text-black/40">Text policy</dt><dd className="text-black/80">{canonicalCandidate.textPolicy}</dd>
          </dl>
        ) : (
          <p className="text-xs text-black/40">No canonical textless master registered for this piece yet.</p>
        )}
      </Section>

      <Section title="5. Destination renditions">
        <ul className="text-xs space-y-1">
          {DESTINATION_RENDITION_ROLES.map(({ role, label }) => {
            const group = pieceRoleGroups.find((r) => r.assetRole === role);
            return (
              <li key={role} className="flex items-center justify-between border-b border-black/5 py-1">
                <span className="text-black/70">{label}</span>
                <span className={group ? "text-navy" : "text-black/30 italic"}>
                  {group ? (group.cards.some((c) => c.kind === "candidate") ? "candidate registered" : "missing") : "Not planned this week"}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="6. Binding">
        <p className="text-xs text-black/40">
          Not yet available -- binding is recorded through the Publishing Package Gateway, which requires a live
          database. No migration is applied in this environment.
        </p>
      </Section>

      <Section title="7. Rendered verification">
        <p className="text-xs text-black/40">
          Not yet available -- rendered verification evidence (desktop/mobile screenshots, language/crop/clipping/
          overflow checks) has no data source in this build.
        </p>
      </Section>

      <Section title="8. Status and next step">
        <p className="text-xs text-black/80 font-medium">
          {focusedCard.kind === "requirement_gap"
            ? "Next step: register a candidate for this requirement."
            : focusedCard.status === "release_ready"
              ? "Next step: none -- this asset is release-ready."
              : `Next step: advance this candidate past "${focusedCard.status}".`}
        </p>
      </Section>
    </div>
  );
}
