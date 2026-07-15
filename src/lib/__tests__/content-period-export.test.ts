/**
 * buildContentExportBundle / renderContentExportMarkdown: the Content
 * Studio publishing export. A minimal in-memory Postgrest-style query mock
 * (same pattern as list-deliverables-open-comments.test.ts) applies the
 * same .select/.eq/.in/.order/.maybeSingle filters the real Supabase chain
 * would, so these tests exercise the actual query and assembly logic in
 * content-period-export.ts, not just recorded calls.
 *
 * This is a separate feature from Publication Readiness; nothing here
 * touches publication-readiness.ts, publication-manifest.ts, or
 * publication-readiness-loader.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM_ID = "f1111111-1111-1111-1111-111111111111";
const OTHER_FIRM_ID = "f9999999-9999-9999-9999-999999999999";
const PERIOD_ID = "p1111111-1111-1111-1111-111111111111";

type Row = Record<string, unknown>;

const state: {
  periods: Row[];
  firms: Row[];
  deliverables: Row[];
  versions: Row[];
  comments: Row[];
  approvals: Row[];
  artifacts: Row[];
  validations: Row[];
  writeAttempted: boolean;
  signedUrlCalls: { bucket: string; path: string }[];
} = {
  periods: [],
  firms: [],
  deliverables: [],
  versions: [],
  comments: [],
  approvals: [],
  artifacts: [],
  validations: [],
  writeAttempted: false,
  signedUrlCalls: [],
};

function sortRows(rows: Row[], col: string, ascending: boolean): Row[] {
  return [...rows].sort((a, b) => {
    const av = String(a[col] ?? "");
    const bv = String(b[col] ?? "");
    if (av < bv) return ascending ? -1 : 1;
    if (av > bv) return ascending ? 1 : -1;
    return 0;
  });
}

function chainable(rows: Row[]) {
  let current = rows;
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      current = current.filter((r) => r[col] === val);
      return builder;
    },
    in: (col: string, vals: unknown[]) => {
      current = current.filter((r) => vals.includes(r[col]));
      return builder;
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      current = sortRows(current, col, opts?.ascending !== false);
      return builder;
    },
    maybeSingle: () => Promise.resolve({ data: current[0] ?? null, error: null }),
    insert: () => {
      state.writeAttempted = true;
      throw new Error("insert should never be called by a read-only export");
    },
    update: () => {
      state.writeAttempted = true;
      throw new Error("update should never be called by a read-only export");
    },
    upsert: () => {
      state.writeAttempted = true;
      throw new Error("upsert should never be called by a read-only export");
    },
    delete: () => {
      state.writeAttempted = true;
      throw new Error("delete should never be called by a read-only export");
    },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: current, error: null }),
  };
  return builder;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "content_periods") return chainable(state.periods);
      if (table === "intake_firms") return chainable(state.firms);
      if (table === "content_deliverables") return chainable(state.deliverables);
      if (table === "deliverable_versions") return chainable(state.versions);
      if (table === "deliverable_comments") return chainable(state.comments);
      if (table === "approval_records") return chainable(state.approvals);
      if (table === "publication_artifacts") return chainable(state.artifacts);
      if (table === "publication_artifact_validations") return chainable(state.validations);
      throw new Error(`unexpected table in mock: ${table}`);
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (path: string) => {
          state.signedUrlCalls.push({ bucket, path });
          return Promise.resolve({ data: { signedUrl: `https://signed.example/${path}` }, error: null });
        },
      }),
    },
  },
}));

import { buildContentExportBundle, renderContentExportMarkdown } from "@/lib/content-period-export";

function makeDeliverable(overrides: Row = {}): Row {
  return {
    id: "d-default",
    firm_id: FIRM_ID,
    period_id: PERIOD_ID,
    title: "Untitled deliverable",
    description: null,
    content_kind: "text",
    status: "approved",
    current_version_id: "v-default",
    approved_version_id: "v-default",
    approved_at: "2026-07-01T00:00:00Z",
    created_by_role: "operator",
    created_by_id: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    excerpt: null,
    topic: null,
    byline: null,
    publish_date: "2026-07-14",
    read_time: null,
    hero_image_url: null,
    kicker: null,
    format: "Counsel Note",
    locale: "en-CA",
    deliverable_role: "social_post",
    publication_destination: "linkedin",
    publication_path: null,
    requires_legal_approval: null,
    requires_image: null,
    requires_file: null,
    requires_localized_route: null,
    ...overrides,
  };
}

function makeVersion(overrides: Row = {}): Row {
  return {
    id: "v-default",
    deliverable_id: "d-default",
    firm_id: FIRM_ID,
    version_number: 1,
    body_html: "<p>Default body</p>",
    storage_path: null,
    asset_mime: null,
    asset_size_bytes: null,
    asset_name: null,
    note: null,
    responds_to_approval_id: null,
    asset_sha256: null,
    asset_validation: null,
    created_by_role: "operator",
    created_by_id: null,
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  state.periods = [
    { id: PERIOD_ID, firm_id: FIRM_ID, starts_on: "2026-07-14", ends_on: "2026-07-20", theme: "Test period" },
  ];
  state.firms = [{ id: FIRM_ID, name: "Test Firm" }];
  state.deliverables = [];
  state.versions = [];
  state.comments = [];
  state.approvals = [];
  state.artifacts = [];
  state.validations = [];
  state.writeAttempted = false;
  state.signedUrlCalls = [];
});

describe("buildContentExportBundle: completeness", () => {
  it("returns every active deliverable, including one with no current version, none omitted", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1", status: "approved" }),
      makeDeliverable({ id: "d2", current_version_id: null, approved_version_id: null, status: "draft" }),
      makeDeliverable({ id: "d3", current_version_id: "v3", approved_version_id: null, status: "in_review" }),
    ];
    state.versions = [
      makeVersion({ id: "v1", deliverable_id: "d1" }),
      makeVersion({ id: "v3", deliverable_id: "d3" }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.active_deliverable_count).toBe(3);
    expect(result.bundle.deliverables.map((d) => d.id).sort()).toEqual(["d1", "d2", "d3"]);
    const d2 = result.bundle.deliverables.find((d) => d.id === "d2");
    expect(d2?.current_version).toBeNull();
    expect(d2?.warnings).toContain("No current version exists.");
  });
});

describe("buildContentExportBundle: may_publish", () => {
  it("a pending piece (in_review, no approval) has may_publish false with an exact reason", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", status: "in_review", current_version_id: "v1", approved_version_id: null }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables[0];
    expect(d1.may_publish).toBe(false);
    expect(d1.may_publish_reason).toBe('Deliverable status is "in_review", not "approved".');
  });

  it("an approved deliverable whose current version is the approved version has may_publish true", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", status: "approved", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables[0];
    expect(d1.may_publish).toBe(true);
    expect(d1.may_publish_reason).toBeNull();
  });

  it("a stale approval bound to an older version does not authorize the current version", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", status: "approved", current_version_id: "v2", approved_version_id: "v1" }),
    ];
    state.versions = [
      makeVersion({ id: "v1", deliverable_id: "d1", version_number: 1, body_html: "<p>Old approved body</p>" }),
      makeVersion({ id: "v2", deliverable_id: "d1", version_number: 2, body_html: "<p>New unapproved body</p>" }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables[0];
    expect(d1.may_publish).toBe(false);
    expect(d1.may_publish_reason).toMatch(/not the current version/);
    expect(d1.is_current_version_approved).toBe(false);
    // The stale approved version is still reported, distinct from current, never substituted for it.
    expect(d1.current_version?.id).toBe("v2");
    expect(d1.approved_version?.id).toBe("v1");
  });
});

describe("buildContentExportBundle: missing metadata never removes a deliverable", () => {
  it("missing deliverable_role, locale, and publication_destination produce warnings, not omission", async () => {
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        deliverable_role: null,
        locale: null,
        publication_destination: null,
        current_version_id: "v1",
        approved_version_id: "v1",
      }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables).toHaveLength(1);
    const d1 = result.bundle.deliverables[0];
    expect(d1.warnings).toEqual(
      expect.arrayContaining([
        "No deliverable_role (channel) recorded.",
        "No locale recorded.",
        "No publication_destination recorded.",
      ]),
    );
  });

  it("missing publication_artifacts produces a warning, never a thrown error or generation attempt", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [];
    const result = await buildContentExportBundle(PERIOD_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d1 = result.bundle.deliverables[0];
    expect(d1.artifacts).toEqual([]);
    expect(d1.warnings).toContain("No publication_artifacts registered for this deliverable yet.");
  });
});

describe("buildContentExportBundle: archived deliverables", () => {
  it("archived deliverables are reported separately and excluded from the active count", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", status: "approved", current_version_id: "v1", approved_version_id: "v1" }),
      makeDeliverable({ id: "d2", status: "archived", current_version_id: "v2", approved_version_id: "v2" }),
    ];
    state.versions = [
      makeVersion({ id: "v1", deliverable_id: "d1" }),
      makeVersion({ id: "v2", deliverable_id: "d2" }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.active_deliverable_count).toBe(1);
    expect(result.bundle.archived_deliverable_count).toBe(1);
    expect(result.bundle.deliverables.map((d) => d.id)).toEqual(["d1"]);
    expect(result.bundle.archived_deliverables).toEqual([{ id: "d2", title: "Untitled deliverable", status: "archived" }]);
  });
});

describe("buildContentExportBundle: firm-scoped double key", () => {
  it("a deliverable row belonging to a different firm than the period is excluded even if the period_id matches", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", firm_id: FIRM_ID, current_version_id: "v1", approved_version_id: "v1" }),
      makeDeliverable({ id: "d-cross", firm_id: OTHER_FIRM_ID, current_version_id: "v2", approved_version_id: "v2" }),
    ];
    state.versions = [
      makeVersion({ id: "v1", deliverable_id: "d1", firm_id: FIRM_ID }),
      makeVersion({ id: "v2", deliverable_id: "d-cross", firm_id: OTHER_FIRM_ID }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables.map((d) => d.id)).toEqual(["d1"]);
    expect(result.bundle.archived_deliverables.map((d) => d.id)).not.toContain("d-cross");
    expect(result.bundle.active_deliverable_count).toBe(1);
  });
});

describe("buildContentExportBundle: content and identity fidelity", () => {
  it("preserves the current version's body_html exactly, byte for byte", async () => {
    const exactBody = "<p>Quotes \"like this\", an apostrophe's mark, and\na line break.</p>";
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1", body_html: exactBody })];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].current_version?.body_html).toBe(exactBody);
  });

  it("preserves existing asset hashes and version bindings exactly", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [
      makeVersion({
        id: "v1",
        deliverable_id: "d1",
        version_number: 4,
        storage_path: "deliverables/f1/d1/v4.pdf",
        asset_sha256: "9f2c1b6e4a7d3f0812345abcdef67890fedcba9876543210fedcba987654321",
        asset_name: "lease-checklist.pdf",
        asset_mime: "application/pdf",
        asset_size_bytes: 204800,
      }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const cv = result.bundle.deliverables[0].current_version;
    expect(cv?.id).toBe("v1");
    expect(cv?.version_number).toBe(4);
    expect(cv?.storage_path).toBe("deliverables/f1/d1/v4.pdf");
    expect(cv?.asset_sha256).toBe("9f2c1b6e4a7d3f0812345abcdef67890fedcba9876543210fedcba987654321");
    expect(cv?.asset_name).toBe("lease-checklist.pdf");
  });
});

describe("buildContentExportBundle: no writes", () => {
  it("never attempts an insert, update, upsert, or delete while assembling a bundle", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", status: "approved", current_version_id: "v1", approved_version_id: "v1" }),
      makeDeliverable({ id: "d2", status: "changes_requested", current_version_id: "v2", approved_version_id: null }),
    ];
    state.versions = [
      makeVersion({ id: "v1", deliverable_id: "d1" }),
      makeVersion({ id: "v2", deliverable_id: "d2" }),
    ];
    state.comments = [
      { id: "c1", deliverable_id: "d2", firm_id: FIRM_ID, author_role: "lawyer", author_name: "Test Lawyer", body: "Please fix the heading.", resolved: false, approval_record_id: null, created_at: "2026-07-02T00:00:00Z" },
    ];
    state.approvals = [
      { id: "ap1", deliverable_id: "d2", version_id: "v2", firm_id: FIRM_ID, decision: "changes_requested", signer_role: "lawyer", signer_name: "Test Lawyer", note: "Not quite there.", created_at: "2026-07-02T00:00:00Z" },
    ];
    state.artifacts = [
      { id: "a1", firm_id: FIRM_ID, deliverable_id: "d1", version_id: "v1", artifact_type: "webpage", locale: "en-CA", destination: "firm_website", storage_bucket: "firm-files", storage_path: "exports/d1.html", public_url: null, sha256: "abc123", size_bytes: 1024, created_at: "2026-07-03T00:00:00Z" },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    expect(result.ok).toBe(true);
    expect(state.writeAttempted).toBe(false);
  });
});

describe("renderContentExportMarkdown: renders the same bundle, not a separate assembly", () => {
  it("Markdown output reflects exactly the titles, statuses, and may_publish reasons already computed in the JSON bundle", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", title: "Five clauses before you sign", status: "approved", current_version_id: "v1", approved_version_id: "v1" }),
      makeDeliverable({ id: "d2", title: "LinkedIn companion post", status: "in_review", current_version_id: "v2", approved_version_id: null }),
    ];
    state.versions = [
      makeVersion({ id: "v1", deliverable_id: "d1" }),
      makeVersion({ id: "v2", deliverable_id: "d2" }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const md = renderContentExportMarkdown(result.bundle);

    for (const d of result.bundle.deliverables) {
      expect(md).toContain(d.title);
      expect(md).toContain(`May publish: ${d.may_publish ? "yes" : "no"}`);
      if (d.may_publish_reason) expect(md).toContain(d.may_publish_reason);
    }
    expect(md).toContain(`Active deliverables: ${result.bundle.active_deliverable_count}`);
  });
});
