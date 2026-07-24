/**
 * Local, fixture-only preview of the Weekly Package Control Room, all 5
 * tabs (Section 23: "expose the Control Room through a local fixture-only
 * route or fixture loader ... do not require a production-authenticated
 * session ... do not use production data").
 *
 * Deliberately outside /portal/[firmId]/* -- that tree's layout imports
 * supabaseAdmin at module load and throws without real Supabase env vars,
 * which this dev environment does not have. This route has zero database
 * or session dependency: it renders the DRG fixture straight through the
 * same assemble-and-filter functions the real routes use, so it can be
 * visually verified with nothing but `npm run dev`.
 *
 * ?tab=overview|content|assets|review|release (default overview)
 * ?role=operator|lawyer (default operator) -- only affects assets/review
 *
 * Not linked from any real navigation. Not a substitute for the real
 * server-rendered routes under src/app/portal/[firmId]/deliverables/
 * periods/[periodId]/*, which query real data and could not be booted in
 * this environment to verify directly.
 *
 * The Assets tab's operator action buttons call the real API routes
 * (package-assets, package-export, package-dry-run) against this fixture's
 * firm/period ids. Every one of those calls gets a 401 here -- there is no
 * portal session cookie in this dev-only route -- and the inline error
 * banner rendering that 401 IS the correct, expected behavior to verify:
 * it proves the wiring reaches a real endpoint and that endpoint's auth
 * gate holds, not that the mutation itself succeeds (nothing here has a
 * database to write to).
 */
import { notFound } from "next/navigation";
import { validatePackageManifest } from "@/lib/publishing-package-control-room-manifest";
import { assembleOverviewViewModel, type OverviewAssetRef } from "@/lib/publishing-package-control-room-overview";
import { assembleAssetsViewModel, type ControlRoomAssetDetail } from "@/lib/publishing-package-control-room-assets";
import { filterPackageForViewer } from "@/lib/publishing-package-control-room-review";
import { assembleReleaseGates, type PublicationInputs } from "@/lib/publishing-package-control-room-release";
import {
  baseManifestJson,
  DRG_CANDIDATE_ASSETS,
  DRG_FIRM_ID,
  DRG_RENEWAL_PERIOD_ID,
} from "@/lib/__fixtures__/publishing-package-drg-renewal-week";
import OverviewTabView from "@/components/portal/control-room/OverviewTabView";
import ContentTabView from "@/components/portal/control-room/ContentTabView";
import AssetsTabView from "@/components/portal/control-room/AssetsTabView";
import ReviewTabView from "@/components/portal/control-room/ReviewTabView";
import ReleaseTabView from "@/components/portal/control-room/ReleaseTabView";

const NO_AUTH_INPUTS: PublicationInputs = {
  standingAuthorizationActive: false,
  individuallyApproved: false,
  destinationIdentityConfirmed: false,
  channelAuthenticated: false,
  publicationReceiptRecorded: false,
};

function buildPreviewAssets(): ControlRoomAssetDetail[] {
  const heroCandidates: ControlRoomAssetDetail[] = DRG_CANDIDATE_ASSETS.map((c) => ({
    id: c.id,
    content_slot_id: c.role === "lead_magnet_landing_page_hero" ? "lead-magnet-landing-pt" : "counsel-note-en",
    asset_role: c.role,
    locale: c.locale,
    destination: c.destination,
    filename: `${c.id.slice(0, 8)}.jpg`,
    mime_type: "image/jpeg",
    byte_size: 240_000,
    width: c.width,
    height: c.height,
    sha256: c.sha256,
    alt_text: "Fixture alt text",
    text_policy: "textless",
    overlay_language: null,
    status: c.status,
    is_selected: c.isSelected,
  }));

  const gbpEnCandidate: ControlRoomAssetDetail = {
    id: "gbp-en-preview-candidate",
    content_slot_id: "gbp-post-en",
    asset_role: "gbp_card",
    locale: "en-CA",
    destination: "google_business_profile",
    filename: "gbp-en-card.jpg",
    mime_type: "image/jpeg",
    byte_size: 180_000,
    width: 1200,
    height: 900,
    sha256: "f".repeat(64),
    alt_text: "Renewal season is here",
    text_policy: "text_bearing",
    overlay_language: "en",
    status: "release_ready",
    is_selected: true,
  };

  return [...heroCandidates, gbpEnCandidate];
}

export default async function ControlRoomFixturePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; role?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { tab: rawTab, role: rawRole } = await searchParams;
  const tab = (["overview", "content", "assets", "review", "release"].includes(rawTab ?? "") ? rawTab : "overview") as
    | "overview" | "content" | "assets" | "review" | "release";
  const viewerRole: "operator" | "lawyer" = rawRole === "lawyer" ? "lawyer" : "operator";

  const result = validatePackageManifest(baseManifestJson());
  if (!result.ok) {
    return (
      <pre className="p-6 text-xs text-red-800 whitespace-pre-wrap">
        Fixture manifest failed validation: {JSON.stringify(result.errors, null, 2)}
      </pre>
    );
  }
  const manifest = result.manifest;
  const assets = buildPreviewAssets();
  const assetRefs: OverviewAssetRef[] = assets.map((a) => ({ id: a.id, status: a.status, filename: a.filename }));
  const overview = assembleOverviewViewModel(manifest, "assembling", assetRefs);

  let body: React.ReactNode;
  if (tab === "overview") {
    body = (
      <OverviewTabView
        firmId={DRG_FIRM_ID}
        periodId={DRG_RENEWAL_PERIOD_ID}
        periodTitle="Renewal Clause week"
        periodDates="Jul 21 – Jul 27, 2026"
        viewModel={overview}
      />
    );
  } else if (tab === "content") {
    body = <ContentTabView firmId={DRG_FIRM_ID} rows={overview.rows} />;
  } else if (tab === "assets") {
    const assetsViewModel = assembleAssetsViewModel(manifest, assets);
    body = (
      <AssetsTabView
        firmId={DRG_FIRM_ID}
        periodId={DRG_RENEWAL_PERIOD_ID}
        manifest={manifest}
        groups={assetsViewModel.groups}
        allCards={assetsViewModel.allCards}
        viewerRole={viewerRole}
      />
    );
  } else if (tab === "review") {
    const view = filterPackageForViewer(overview, assets, viewerRole);
    body = <ReviewTabView view={view} />;
  } else {
    const pieces = assembleReleaseGates(overview, manifest, NO_AUTH_INPUTS);
    body = <ReleaseTabView pieces={pieces} />;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-4 text-xs uppercase tracking-wider text-black/40 border border-black/10 bg-parchment-2 px-3 py-2">
        Local fixture preview -- DRG Law, {DRG_FIRM_ID.slice(0, 8)}, period {DRG_RENEWAL_PERIOD_ID.slice(0, 8)}. Tab: {tab}. Role: {viewerRole}. Not connected to any database.
      </div>
      {body}
    </div>
  );
}
