/**
 * Pure coverage for buildPreflightCheckRows -- the row-builder
 * runPackagePreflight persists to publishing_package_checks. Proves the
 * dedupe key (package_id, content_slot_id, asset_scope, check_key) is
 * genuinely unique per check within one run, which is the property that
 * makes the upsert idempotent across repeated preflight runs instead of
 * accumulating duplicates (the bug this fix closes -- see the migration's
 * asset_scope comment).
 */
import { describe, it, expect, vi } from "vitest";

// buildPreflightCheckRows is pure, but it lives in
// publishing-package-control-room-mutations.ts, which carries a
// module-level `import "server-only"` guard AND a module-level import of
// supabaseAdmin (which itself throws at import time without real Supabase
// env vars -- the same root cause behind this build's live-500 finding).
// Importing anything from that file in a plain test environment needs
// both mocks, same as every other test of that module.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => {
      throw new Error("buildPreflightCheckRows is pure and must never touch the DB");
    },
  },
}));

import { validatePackageManifest } from "../publishing-package-control-room-manifest";
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

function buildPieces() {
  const result = validatePackageManifest(baseManifestJson());
  if (!result.ok) throw new Error(`fixture manifest unexpectedly invalid: ${JSON.stringify(result.errors)}`);
  const overview = assembleOverviewViewModel(result.manifest, "assembling", []);
  return assembleReleaseGates(overview, result.manifest, NO_AUTH_INPUTS);
}

describe("buildPreflightCheckRows", () => {
  it("every row uses asset_scope 'piece' and asset_id null", () => {
    const rows = buildPreflightCheckRows("pkg-1", buildPieces());
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.asset_scope).toBe("piece");
      expect(row.asset_id).toBeNull();
    }
  });

  it("no two rows share the same (content_slot_id, asset_scope, check_key) -- the actual dedup key", () => {
    const rows = buildPreflightCheckRows("pkg-1", buildPieces());
    const keys = rows.map((r) => `${r.content_slot_id}::${r.asset_scope}::${r.check_key}`);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it("severity: failing asset/publication checks are critical, failing editorial/experience are high, passes are informational", () => {
    const rows = buildPreflightCheckRows("pkg-1", buildPieces());
    const assetOrPublicationFailure = rows.find(
      (r) => r.status === "fail" && (String(r.check_key).startsWith("asset_") || String(r.check_key).startsWith("publication_")),
    );
    const editorialOrExperienceFailure = rows.find(
      (r) => r.status === "fail" && (String(r.check_key).startsWith("editorial_") || String(r.check_key).startsWith("experience_")),
    );
    const pass = rows.find((r) => r.status === "pass");

    expect(assetOrPublicationFailure).toBeDefined();
    expect(assetOrPublicationFailure!.severity).toBe("critical");
    expect(editorialOrExperienceFailure).toBeDefined();
    expect(editorialOrExperienceFailure!.severity).toBe("high");
    expect(pass).toBeDefined();
    expect(pass!.severity).toBe("informational");
  });

  it("evidence carries reason_code and piece_title", () => {
    const rows = buildPreflightCheckRows("pkg-1", buildPieces());
    const failingRow = rows.find((r) => r.status === "fail")!;
    const evidence = failingRow.evidence as { reason_code: string | null; piece_title: string };
    expect(evidence.reason_code).toBeTruthy();
    expect(evidence.piece_title).toBeTruthy();

    const passingRow = rows.find((r) => r.status === "pass")!;
    const passEvidence = passingRow.evidence as { reason_code: string | null; piece_title: string };
    expect(passEvidence.reason_code).toBeNull();
    expect(passEvidence.piece_title).toBeTruthy();
  });

  it("does not set checked_at -- the column defaults to now() in Postgres", () => {
    const rows = buildPreflightCheckRows("pkg-1", buildPieces());
    for (const row of rows) {
      expect("checked_at" in row).toBe(false);
    }
  });
});
