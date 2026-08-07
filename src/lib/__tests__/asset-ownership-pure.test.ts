import { describe, it, expect } from "vitest";
import {
  needsAction,
  buildTransferList,
  seedRowsForFirm,
  groupRowsByCategory,
  type AssetOwnershipRow,
} from "../asset-ownership-pure";
import { ASSET_OWNERSHIP_CATALOGUE, ASSET_CATEGORIES } from "../asset-ownership-catalogue";

function makeRow(overrides: Partial<AssetOwnershipRow> = {}): AssetOwnershipRow {
  return {
    id: "row-1",
    firm_id: "firm-1",
    review_phase: "onboarding",
    asset_key: "domain_registrar",
    category: "domain_website",
    status: "unknown",
    account_holder: null,
    account_email: null,
    billing_owner: null,
    firm_has_admin: null,
    evidence_url: null,
    evidence_note: null,
    action: null,
    action_done: false,
    notes: null,
    last_reviewed_at: null,
    created_at: "2026-08-06T00:00:00.000Z",
    updated_at: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("ASSET_OWNERSHIP_CATALOGUE", () => {
  it("every entry's category exists in ASSET_CATEGORIES", () => {
    const categoryKeys = new Set(ASSET_CATEGORIES.map((c) => c.key));
    for (const entry of ASSET_OWNERSHIP_CATALOGUE) {
      expect(categoryKeys.has(entry.category)).toBe(true);
    }
  });

  it("has no duplicate asset keys", () => {
    const keys = ASSET_OWNERSHIP_CATALOGUE.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers all six categories with at least one asset", () => {
    const covered = new Set(ASSET_OWNERSHIP_CATALOGUE.map((e) => e.category));
    for (const category of ASSET_CATEGORIES) {
      expect(covered.has(category.key)).toBe(true);
    }
  });
});

describe("needsAction", () => {
  it("is false for firm_controlled", () => {
    expect(needsAction(makeRow({ status: "firm_controlled" }))).toBe(false);
  });

  it("is true for provider_controlled, unknown, and shared_access when not done", () => {
    expect(needsAction(makeRow({ status: "provider_controlled" }))).toBe(true);
    expect(needsAction(makeRow({ status: "unknown" }))).toBe(true);
    expect(needsAction(makeRow({ status: "shared_access" }))).toBe(true);
  });

  it("is false once action_done is true, regardless of status", () => {
    expect(needsAction(makeRow({ status: "provider_controlled", action_done: true }))).toBe(false);
  });
});

describe("buildTransferList", () => {
  it("excludes firm_controlled and already-done rows", () => {
    const rows = [
      makeRow({ id: "a", status: "firm_controlled" }),
      makeRow({ id: "b", status: "provider_controlled", action_done: true }),
      makeRow({ id: "c", status: "unknown" }),
    ];
    const result = buildTransferList(rows);
    expect(result.map((r) => r.id)).toEqual(["c"]);
  });

  it("orders provider_controlled before unknown before shared_access", () => {
    const rows = [
      makeRow({ id: "shared", status: "shared_access" }),
      makeRow({ id: "provider", status: "provider_controlled" }),
      makeRow({ id: "unknown", status: "unknown" }),
    ];
    const result = buildTransferList(rows);
    expect(result.map((r) => r.id)).toEqual(["provider", "unknown", "shared"]);
  });

  it("does not mutate the input array", () => {
    const rows = [makeRow({ id: "a", status: "unknown" }), makeRow({ id: "b", status: "provider_controlled" })];
    const original = [...rows];
    buildTransferList(rows);
    expect(rows).toEqual(original);
  });
});

describe("seedRowsForFirm", () => {
  it("returns every catalogue entry when none exist yet", () => {
    const rows = seedRowsForFirm("firm-1", "onboarding", new Set());
    expect(rows).toHaveLength(ASSET_OWNERSHIP_CATALOGUE.length);
    expect(rows.every((r) => r.firm_id === "firm-1" && r.review_phase === "onboarding" && r.status === "unknown")).toBe(true);
  });

  it("skips asset keys that already exist for this firm and phase", () => {
    const existing = new Set([ASSET_OWNERSHIP_CATALOGUE[0].key, ASSET_OWNERSHIP_CATALOGUE[1].key]);
    const rows = seedRowsForFirm("firm-1", "onboarding", existing);
    expect(rows).toHaveLength(ASSET_OWNERSHIP_CATALOGUE.length - 2);
    expect(rows.some((r) => r.asset_key === ASSET_OWNERSHIP_CATALOGUE[0].key)).toBe(false);
  });

  it("returns an empty array once every asset exists", () => {
    const existing = new Set(ASSET_OWNERSHIP_CATALOGUE.map((e) => e.key));
    const rows = seedRowsForFirm("firm-1", "onboarding", existing);
    expect(rows).toEqual([]);
  });

  it("carries the correct category onto each seeded row", () => {
    const target = ASSET_OWNERSHIP_CATALOGUE.find((e) => e.key === "google_business_profile")!;
    const rows = seedRowsForFirm("firm-1", "onboarding", new Set());
    const seeded = rows.find((r) => r.asset_key === "google_business_profile");
    expect(seeded?.category).toBe(target.category);
  });
});

describe("groupRowsByCategory", () => {
  it("groups rows under their category in the given order", () => {
    const rows = [
      makeRow({ id: "a", category: "social_comms" }),
      makeRow({ id: "b", category: "domain_website" }),
      makeRow({ id: "c", category: "domain_website" }),
    ];
    const grouped = groupRowsByCategory(rows, ["domain_website", "social_comms"]);
    expect(grouped.map((g) => g.category)).toEqual(["domain_website", "social_comms"]);
    expect(grouped[0].rows.map((r) => r.id)).toEqual(["b", "c"]);
    expect(grouped[1].rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("omits categories with no rows", () => {
    const rows = [makeRow({ id: "a", category: "domain_website" })];
    const grouped = groupRowsByCategory(rows, ["brand_content", "domain_website", "social_comms"]);
    expect(grouped.map((g) => g.category)).toEqual(["domain_website"]);
  });

  it("puts a category not in the known order last, not dropped", () => {
    const rows = [
      makeRow({ id: "a", category: "domain_website" }),
      makeRow({ id: "b", category: "retired_category" }),
    ];
    const grouped = groupRowsByCategory(rows, ["domain_website"]);
    expect(grouped.map((g) => g.category)).toEqual(["domain_website", "retired_category"]);
  });
});
