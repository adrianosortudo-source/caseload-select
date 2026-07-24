/**
 * The one integration-shaped test this environment genuinely supports:
 * the full PURE chain, end to end, from raw manifest JSON through to
 * persisted check rows -- no database anywhere in this file. Labelled
 * explicitly as pure-chain, not a DB integration test: every DB round-trip
 * in this build remains untested until a real Postgres exists (see
 * docs/publishing/weekly-package-control-room.md's Known limits).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => {
      throw new Error("this pure chain must never touch the DB");
    },
  },
}));

import {
  validatePackageManifest,
  checkCandidateAgainstRequirement,
  type AssetGuardCandidate,
  type AssetGuardRequirement,
} from "../publishing-package-control-room-manifest";
import { baseManifestJson } from "../__fixtures__/publishing-package-drg-renewal-week";
import { assembleOverviewViewModel } from "../publishing-package-control-room-overview";
import { assembleReleaseGates, type PublicationInputs } from "../publishing-package-control-room-release";
import { buildPreflightCheckRows } from "../publishing-package-control-room-mutations";

const NO_AUTH_INPUTS: PublicationInputs = {
  standingAuthorizationActive: false,
  individuallyApproved: false,
  destinationIdentityConfirmed: false,
  channelAuthenticated: false,
  publicationReceiptRecorded: false,
};

// 4 editorial + 5 asset + 4 experience + 6 publication checks per piece.
const CHECKS_PER_PIECE = 4 + 5 + 4 + 6;
const PIECE_COUNT = 16;

describe("full pure chain: raw manifest -> validation -> gates -> persisted check rows", () => {
  it("produces exactly 16 pieces x 19 checks = 304 rows, including at least one critical failure", () => {
    const validated = validatePackageManifest(baseManifestJson());
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const overview = assembleOverviewViewModel(validated.manifest, "assembling", []);
    const pieces = assembleReleaseGates(overview, validated.manifest, NO_AUTH_INPUTS);
    expect(pieces).toHaveLength(PIECE_COUNT);

    const rows = buildPreflightCheckRows("pkg-e2e", pieces);
    expect(rows).toHaveLength(PIECE_COUNT * CHECKS_PER_PIECE);

    // The blocked PT landing-page slot (no selected asset registered in the
    // fixture) must surface as a critical failure on its Asset gate.
    const blockedLandingRow = rows.find(
      (r) => r.content_slot_id === "lead-magnet-landing-pt" && r.check_key === "asset_required_present",
    );
    expect(blockedLandingRow).toBeDefined();
    expect(blockedLandingRow!.status).toBe("fail");
    expect(blockedLandingRow!.severity).toBe("critical");
  });
});

describe("full pure chain: candidate guard suite agrees with the manifest on what a valid asset is", () => {
  it("a clean candidate passes every guard; mutating only its locale fails exactly the locale guard", () => {
    const validated = validatePackageManifest(baseManifestJson());
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const piece = validated.manifest.pieces.find((p) => p.contentSlotId === "counsel-note-en")!;
    const requirement = piece.requiredAssets.find((r) => r.assetRole === "website_article_hero")!;

    const guardRequirement: AssetGuardRequirement = {
      assetRole: requirement.assetRole,
      locale: requirement.locale,
      destination: requirement.destination,
      requiredWidth: requirement.requiredWidth,
      requiredHeight: requirement.requiredHeight,
      overlayLanguage: requirement.overlayLanguage,
    };

    const cleanCandidate: AssetGuardCandidate = {
      id: "candidate-1",
      role: requirement.assetRole,
      locale: requirement.locale,
      destination: requirement.destination,
      overlayLanguage: requirement.overlayLanguage,
      width: requirement.requiredWidth,
      height: requirement.requiredHeight,
      sha256: "a".repeat(64),
      status: "candidate",
      isSelected: false,
    };

    const cleanFailures = checkCandidateAgainstRequirement(cleanCandidate, guardRequirement);
    expect(cleanFailures).toHaveLength(0);

    const wrongLocaleCandidate: AssetGuardCandidate = { ...cleanCandidate, locale: "pt-BR" };
    const localeFailures = checkCandidateAgainstRequirement(wrongLocaleCandidate, guardRequirement);
    expect(localeFailures).toHaveLength(1);
    expect(localeFailures[0].reason).toContain("locale");
  });
});
