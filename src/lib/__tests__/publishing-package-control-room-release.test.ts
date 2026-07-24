import { describe, it, expect } from "vitest";
import { validatePackageManifest } from "../publishing-package-control-room-manifest";
import { baseManifestJson } from "../__fixtures__/publishing-package-drg-renewal-week";
import { assembleOverviewViewModel, type OverviewAssetRef } from "../publishing-package-control-room-overview";
import { assembleReleaseGates, type PublicationInputs } from "../publishing-package-control-room-release";

function validManifest(raw: Record<string, unknown> = baseManifestJson()) {
  const result = validatePackageManifest(raw);
  if (!result.ok) throw new Error(`fixture manifest unexpectedly invalid: ${JSON.stringify(result.errors)}`);
  return result.manifest;
}

const NO_AUTH_INPUTS: PublicationInputs = {
  standingAuthorizationActive: false,
  individuallyApproved: false,
  destinationIdentityConfirmed: false,
  channelAuthenticated: false,
  publicationReceiptRecorded: false,
};

const FULL_AUTH_INPUTS: PublicationInputs = {
  standingAuthorizationActive: true,
  individuallyApproved: false,
  destinationIdentityConfirmed: true,
  channelAuthenticated: true,
  publicationReceiptRecorded: true,
};

describe("assembleReleaseGates", () => {
  it("computes 4 gates for all 16 pieces", () => {
    const manifest = validManifest();
    const overview = assembleOverviewViewModel(manifest, "assembling", []);
    const gates = assembleReleaseGates(overview, manifest, NO_AUTH_INPUTS);
    expect(gates).toHaveLength(16);
    for (const piece of gates) expect(piece.gates.map((g) => g.gate)).toEqual(["editorial", "asset", "experience", "publication"]);
  });

  it("a Files-hub CTA fails experience_no_files_hub with reasonCode files_hub_cta, under the Experience gate", () => {
    // withFilesHubCta produces a manifest that validatePackageManifest itself
    // rejects (by design -- the manifest validator already hard-blocks this),
    // so it can never reach assembleReleaseGates through the real load path.
    // This test instead mutates an already-VALIDATED manifest object
    // directly, proving the release gate's own Files-hub check is
    // independent defense-in-depth, not merely trusting upstream validation.
    const manifest = validManifest();
    const piece = manifest.pieces.find((p) => p.contentSlotId === "lead-magnet-document-en")!;
    piece.cta.target = "/files/renewal-clause-checklist-en.pdf";
    const overview = assembleOverviewViewModel(manifest, "assembling", []);
    const gates = assembleReleaseGates(overview, manifest, NO_AUTH_INPUTS);
    const gatedPiece = gates.find((p) => p.contentSlotId === "lead-magnet-document-en")!;
    const experience = gatedPiece.gates.find((g) => g.gate === "experience")!;
    const failedCheck = experience.checks.find((c) => c.checkKey === "experience_no_files_hub")!;
    expect(failedCheck.status).toBe("fail");
    expect(failedCheck.reasonCode).toBe("files_hub_cta");
    expect(experience.allPass).toBe(false);
  });

  it("the blocked PT landing-page slot fails the Asset gate", () => {
    const manifest = validManifest();
    const overview = assembleOverviewViewModel(manifest, "assembling", []);
    const gates = assembleReleaseGates(overview, manifest, NO_AUTH_INPUTS);
    const piece = gates.find((p) => p.contentSlotId === "lead-magnet-landing-pt")!;
    const asset = piece.gates.find((g) => g.gate === "asset")!;
    expect(asset.allPass).toBe(false);
    expect(asset.checks.find((c) => c.checkKey === "asset_required_present")!.status).toBe("fail");
  });

  it("gbp-post-en with a complete synthetic asset set passes all four gates", () => {
    const manifest = validManifest();
    const gbpPiece = manifest.pieces.find((p) => p.contentSlotId === "gbp-post-en")!;
    const selectedAssetId = gbpPiece.requiredAssets[0].selectedAssetId!;
    expect(selectedAssetId).toBeTruthy();

    const assets: OverviewAssetRef[] = [{ id: selectedAssetId, status: "release_ready", filename: "gbp-hero.jpg" }];
    const overview = assembleOverviewViewModel(manifest, "release_ready", assets);
    const gates = assembleReleaseGates(overview, manifest, FULL_AUTH_INPUTS);
    const piece = gates.find((p) => p.contentSlotId === "gbp-post-en")!;

    if (!piece.allPass) {
      const failures = piece.gates.flatMap((g) => g.checks.filter((c) => c.status === "fail"));
      throw new Error(`expected all gates to pass, got failures: ${JSON.stringify(failures, null, 2)}`);
    }
    expect(piece.allPass).toBe(true);
  });

  it("publication_authorization fails without standing or individual authorization", () => {
    const manifest = validManifest();
    const overview = assembleOverviewViewModel(manifest, "assembling", []);
    const gates = assembleReleaseGates(overview, manifest, NO_AUTH_INPUTS);
    const piece = gates.find((p) => p.contentSlotId === "gbp-post-en")!; // approved content
    const publication = piece.gates.find((g) => g.gate === "publication")!;
    const authCheck = publication.checks.find((c) => c.checkKey === "publication_authorization")!;
    expect(authCheck.status).toBe("fail");
    expect(authCheck.reasonCode).toBe("no_publication_authorization");
  });

  it("a per-piece approvedByDeliverableId override passes publication_content_approval even under NO_AUTH_INPUTS-style content status", () => {
    const manifest = validManifest();
    // decision-tool-en's approval_status is "draft" in the fixture -- would
    // fail publication_content_approval on the package-level fallback.
    const piece = manifest.pieces.find((p) => p.contentSlotId === "decision-tool-en")!;
    expect(piece.approvalStatus).toBe("draft");
    piece.deliverableId = "d0d0d0d0-0000-4000-8000-000000000d99";

    const overview = assembleOverviewViewModel(manifest, "assembling", []);
    const gates = assembleReleaseGates(overview, manifest, {
      ...NO_AUTH_INPUTS,
      approvedByDeliverableId: { [piece.deliverableId]: true },
    });
    const gatedPiece = gates.find((p) => p.contentSlotId === "decision-tool-en")!;
    const publication = gatedPiece.gates.find((g) => g.gate === "publication")!;
    const approvalCheck = publication.checks.find((c) => c.checkKey === "publication_content_approval")!;
    expect(approvalCheck.status).toBe("pass");
  });

  it("an absent per-piece override map falls back to the package-level/manifest behavior unchanged", () => {
    // Same assertion as "publication_authorization fails without standing or
    // individual authorization" above, but explicitly re-run with the maps
    // present-but-empty to prove an empty override doesn't accidentally flip
    // anything -- if this breaks, the override logic itself is wrong.
    const manifest = validManifest();
    const overview = assembleOverviewViewModel(manifest, "assembling", []);
    const gates = assembleReleaseGates(overview, manifest, {
      ...NO_AUTH_INPUTS,
      approvedByDeliverableId: {},
      receiptsByDeliverableId: {},
    });
    const piece = gates.find((p) => p.contentSlotId === "gbp-post-en")!;
    const publication = piece.gates.find((g) => g.gate === "publication")!;
    expect(publication.checks.find((c) => c.checkKey === "publication_content_approval")!.status).toBe("pass"); // gbp-post-en is approved in the fixture
    expect(publication.checks.find((c) => c.checkKey === "publication_authorization")!.status).toBe("fail");
  });
});
