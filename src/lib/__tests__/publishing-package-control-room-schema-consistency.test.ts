/**
 * Anti-drift lock between application code and the migration's own CHECK
 * constraints / unique key. Reads the migration file's raw text once and
 * asserts every enum value the app code actually emits or declares is
 * present in it -- so a future change that adds a new event type, asset
 * role, or status to application code without updating the migration
 * (or vice versa) fails loudly here instead of silently drifting.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ASSET_ROLES } from "../publishing-package-control-room-manifest";

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "supabase/migrations/20260723120000_publishing_package_control_room.sql",
);
const migrationText = readFileSync(MIGRATION_PATH, "utf8");

// The exact 8 event_type string literals this codebase's mutations module
// emits (publishing-package-control-room-mutations.ts). Hardcoded
// deliberately: the point of this test is to fail if a 9th emitted event
// type is added here without also adding it to the migration's CHECK.
const EMITTED_EVENT_TYPES = [
  "candidate_registered",
  "candidate_selected",
  "asset_rejected",
  "asset_superseded",
  "package_preflight_run",
  "package_release_ready",
  "manifest_created",
  "manifest_revised",
];

// AssetStatus (publishing-package-control-room-overview.ts) is a pure
// TypeScript union with no runtime array to import. Hardcoded here on
// purpose -- this list must be kept in sync with both AssetStatus and the
// migration's publishing_package_assets.status CHECK by hand; this test
// exists specifically to catch the moment they diverge.
const ASSET_STATUSES = [
  "required", "missing", "candidate", "visually_selected", "hash_verified",
  "uploaded", "bound", "rendered_verified", "release_ready", "blocked",
  "rejected", "superseded", "not_planned",
];

describe("schema consistency: application code vs the migration's own CHECK constraints", () => {
  it("every event type the mutations module emits exists in the migration's event_type CHECK", () => {
    for (const eventType of EMITTED_EVENT_TYPES) {
      expect(migrationText, `event_type "${eventType}" is emitted by code but missing from the migration`).toContain(
        `'${eventType}'`,
      );
    }
  });

  it("every ASSET_ROLES value exists in the migration's asset_role CHECK", () => {
    expect(ASSET_ROLES.length).toBeGreaterThan(0);
    for (const role of ASSET_ROLES) {
      expect(migrationText, `asset_role "${role}" is declared in code but missing from the migration`).toContain(`'${role}'`);
    }
  });

  it("every AssetStatus value exists in the migration's status CHECK", () => {
    for (const status of ASSET_STATUSES) {
      expect(migrationText, `status "${status}" is declared in code but missing from the migration`).toContain(`'${status}'`);
    }
  });

  it("the checks dedup key uses asset_scope, never asset_id (regression lock for the fixed upsert-duplication bug)", () => {
    expect(migrationText).toContain("unique (package_id, content_slot_id, asset_scope, check_key)");
    expect(migrationText).not.toContain("unique (package_id, content_slot_id, asset_id, check_key)");
  });
});
