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
  packages: Row[];
  packageAssets: Row[];
  validations: Row[];
  roleAssignments: Row[];
  standingAuth: Row[];
  writeAttempted: boolean;
  signedUrlCalls: { bucket: string; path: string; download?: string | boolean }[];
  signedUrlFailFor: Set<string>;
} = {
  periods: [],
  firms: [],
  deliverables: [],
  versions: [],
  comments: [],
  approvals: [],
  artifacts: [],
  packages: [],
  packageAssets: [],
  validations: [],
  roleAssignments: [],
  standingAuth: [],
  signedUrlFailFor: new Set(),
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
    // PostgREST `.is(col, null)`, used by the role-assignment read to take only
    // live rows (superseded_at IS NULL). Treats an absent key as null, since
    // fixture rows omit columns they do not exercise.
    is: (col: string, val: unknown) => {
      current = current.filter((r) => (r[col] ?? null) === val);
      return builder;
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      current = sortRows(current, col, opts?.ascending !== false);
      return builder;
    },
    limit: (n: number) => {
      current = current.slice(0, n);
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
      if (table === "publishing_packages") return chainable(state.packages);
      if (table === "publishing_package_assets") return chainable(state.packageAssets);
      if (table === "publication_artifact_validations") return chainable(state.validations);
      // Empty by default: the bundle asks for role assignments alongside
      // artifacts, and every test written before explicit asset-role slots
      // therefore keeps asserting exactly what it did. Tests that care about
      // role assignment populate this explicitly.
      if (table === "publication_artifact_role_assignments") return chainable(state.roleAssignments);
      // Empty by default, so getStandingAuthorizationState returns null and
      // standingAuthorizationActive is false. Every test written before the
      // two-path release-authorization bar therefore keeps asserting the
      // individual-approval path exactly as it did; the standing-authorization
      // tests populate this explicitly.
      if (table === "standing_publishing_authorizations") return chainable(state.standingAuth);
      throw new Error(`unexpected table in mock: ${table}`);
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (path: string, _expiresIn: number, options?: { download?: string | boolean }) => {
          state.signedUrlCalls.push({ bucket, path, download: options?.download });
          if (state.signedUrlFailFor.has(path)) {
            return Promise.resolve({ data: null, error: new Error("signing failed") });
          }
          return Promise.resolve({ data: { signedUrl: `https://signed.example/${path}` }, error: null });
        },
      }),
    },
  },
}));

vi.mock("@/lib/deliverable-client-change-holds", () => ({
  loadUnresolvedClientChangeHoldDeliverableIds: () => Promise.resolve(new Set<string>()),
}));

import {
  buildContentExportBundle,
  renderContentExportMarkdown,
  withholdBundleLinks,
} from "@/lib/content-period-export";

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
    cta_target_path: null,
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
    // Mirrors the column default: a version is eligible for the standing-
    // authorization path unless an operator explicitly flags it.
    requires_individual_review: false,
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
  state.packages = [];
  state.packageAssets = [];
  state.validations = [];
  state.roleAssignments = [];
  state.standingAuth = [];
  state.writeAttempted = false;
  state.signedUrlCalls = [];
  state.signedUrlFailFor = new Set();
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
    // The reason now comes verbatim from isVersionReleaseAuthorized, the
    // canonical two-path bar, rather than being re-worded here. With no
    // standing authorization on record this is the standing_authorization_inactive
    // outcome, and it names BOTH closed paths -- which the old local wording
    // ("status is in_review, not approved") did not, because it did not know
    // the second path existed.
    expect(d1.may_publish_reason).toContain("has never been individually approved");
    expect(d1.may_publish_reason).toContain(
      "standing publishing authorization is not currently active",
    );
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
    // Canonical wording for approved_version_mismatch: it names the stale
    // approval by id rather than saying "not the current version", which is
    // strictly more evidence for the same fact.
    expect(d1.may_publish_reason).toMatch(/does not match the evaluated version/);
    expect(d1.is_current_version_approved).toBe(false);
    // The stale approved version is still reported, distinct from current, never substituted for it.
    expect(d1.current_version?.id).toBe("v2");
    expect(d1.approved_version?.id).toBe("v1");
  });

  it("an approved pointer to a version row that does not exist never authorizes publish (dangling pointer)", async () => {
    state.deliverables = [
      // Both current_version_id and approved_version_id point at "v-ghost",
      // which is never inserted into state.versions -- a deleted or
      // never-created row, ID-equal but nonexistent.
      makeDeliverable({ id: "d1", status: "approved", current_version_id: "v-ghost", approved_version_id: "v-ghost" }),
    ];
    state.versions = [];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables[0];
    expect(d1.may_publish).toBe(false);
    expect(d1.may_publish_reason).toMatch(/does not resolve to an existing version row/);
    expect(d1.is_current_version_approved).toBe(false);
    expect(d1.current_version).toBeNull();
    expect(d1.warnings).toContain(
      "current_version_id does not resolve to any existing version row; treated as missing.",
    );
  });

  it("a version row that exists but belongs to a different deliverable never authorizes publish and its content is never leaked", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", status: "approved", current_version_id: "v-foreign", approved_version_id: "v-foreign" }),
      // d2 is a second REAL active deliverable in this same bundle and is
      // the legitimate owner of v-foreign. This is what makes the scenario
      // a genuine cross-deliverable mix-up rather than a simple dangling
      // pointer: v-foreign is correctly fetched into this bundle's version
      // set (it belongs to an active deliverable in scope), d1 just points
      // at it by mistake.
      makeDeliverable({ id: "d2", status: "draft", current_version_id: "v-foreign", approved_version_id: null }),
    ];
    state.versions = [
      makeVersion({ id: "v-foreign", deliverable_id: "d2", body_html: "<p>Belongs to d2, not d1</p>" }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables.find((d) => d.id === "d1");
    if (!d1) throw new Error("expected d1");
    expect(d1.may_publish).toBe(false);
    expect(d1.may_publish_reason).toMatch(/does not resolve to an existing version row/);
    expect(d1.is_current_version_approved).toBe(false);
    // The critical assertion: d2's content is never exported under d1's
    // entry, even though the row was fetched into this bundle's version set.
    expect(d1.current_version).toBeNull();
    expect(d1.warnings).toContain(
      "current_version_id resolves to a version belonging to a different deliverable; treated as missing.",
    );
    // d2 itself correctly owns and exports the same version.
    const d2 = result.bundle.deliverables.find((d) => d.id === "d2");
    expect(d2?.current_version?.id).toBe("v-foreign");
    expect(d2?.current_version?.body_html).toBe("<p>Belongs to d2, not d1</p>");
  });

  it("an approved_version_id that is itself a foreign or missing pointer never authorizes publish, even with a valid current version", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", status: "approved", current_version_id: "v1", approved_version_id: "v-foreign" }),
    ];
    state.versions = [
      makeVersion({ id: "v1", deliverable_id: "d1" }),
      makeVersion({ id: "v-foreign", deliverable_id: "d-other" }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables[0];
    expect(d1.may_publish).toBe(false);
    expect(d1.may_publish_reason).toMatch(/approved_version_id does not resolve to an existing version row/);
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

  it("missing publication and selected package artifacts produces a warning, never a thrown error or generation attempt", async () => {
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
    expect(d1.warnings).toContain(
      "No publication or selected package artifacts are registered for this deliverable yet.",
    );
  });
});

describe("buildContentExportBundle: manifest package asset projection", () => {
  it("surfaces selected assets from the latest package with their exact role, version, hash, and signed bytes", async () => {
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        current_version_id: "v1",
        approved_version_id: "v1",
        deliverable_role: "article",
        publication_destination: "linkedin_article",
      }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.packages = [
      { id: "pkg-old", firm_id: FIRM_ID, period_id: PERIOD_ID, manifest_revision: 1 },
      { id: "pkg-current", firm_id: FIRM_ID, period_id: PERIOD_ID, manifest_revision: 2 },
    ];
    state.packageAssets = [
      {
        id: "pa-current",
        package_id: "pkg-current",
        deliverable_id: "d1",
        source_version_id: "v1",
        locale: "en-CA",
        destination: "linkedin",
        asset_role: "native_linkedin_article_cover",
        filename: "linkedin-cover.png",
        mime_type: "image/png",
        byte_size: 2048,
        sha256: "a".repeat(64),
        storage_key: "deliverables/firm/week/linkedin-cover.png",
        status: "hash_verified",
        is_selected: true,
        created_at: "2026-08-12T00:00:00Z",
      },
      {
        id: "pa-old",
        package_id: "pkg-old",
        deliverable_id: "d1",
        source_version_id: "v1",
        locale: "en-CA",
        destination: "linkedin",
        asset_role: "native_linkedin_article_cover",
        filename: "old-cover.png",
        mime_type: "image/png",
        byte_size: 1024,
        sha256: "b".repeat(64),
        storage_key: "deliverables/firm/week/old-cover.png",
        status: "hash_verified",
        is_selected: true,
        created_at: "2026-08-11T00:00:00Z",
      },
    ];

    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].artifacts).toEqual([
      expect.objectContaining({
        id: "pa-current",
        version_id: "v1",
        artifact_type: "social_image",
        asset_role: "native_linkedin_article_cover",
        sha256: "a".repeat(64),
        storage_path: "deliverables/firm/week/linkedin-cover.png",
        signed_url: "https://signed.example/deliverables/firm/week/linkedin-cover.png",
        matches_current_version: true,
      }),
    ]);
    expect(result.bundle.deliverables[0].warnings).not.toContain(
      "No publication or selected package artifacts are registered for this deliverable yet.",
    );
  });

  it("does not surface unselected, unbound, or internal QA package rows", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.packages = [{ id: "pkg-current", firm_id: FIRM_ID, period_id: PERIOD_ID, manifest_revision: 1 }];
    const base = {
      package_id: "pkg-current",
      deliverable_id: "d1",
      source_version_id: "v1",
      locale: "en-CA",
      destination: "linkedin",
      filename: "asset.png",
      mime_type: "image/png",
      byte_size: 2048,
      sha256: "c".repeat(64),
      storage_key: "deliverables/firm/week/asset.png",
      status: "hash_verified",
      created_at: "2026-08-12T00:00:00Z",
    };
    state.packageAssets = [
      { ...base, id: "not-selected", asset_role: "linkedin_post_card", is_selected: false },
      { ...base, id: "not-bound", asset_role: "linkedin_post_card", is_selected: true, source_version_id: null },
      { ...base, id: "qa-only", asset_role: "rendered_qa_evidence", is_selected: true },
    ];

    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].artifacts).toEqual([]);
  });
});

describe("buildContentExportBundle: artifact signed URLs", () => {
  it("an artifact with a storage_path gets a non-null signed_url and signed_url_expires_at", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a1",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a1.jpg",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const artifact = result.bundle.deliverables[0].artifacts[0];
    expect(artifact.signed_url).toBe("https://signed.example/publication-artifacts/d1/a1.jpg");
    expect(artifact.signed_url_expires_at).not.toBeNull();
  });

  it("signs an artifact with a download filename so the browser downloads it instead of navigating away", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a1",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "hero_image",
        locale: "en-CA",
        destination: "firm_website",
        storage_bucket: "firm-files",
        storage_path: "hero/d1.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
      },
    ];
    await buildContentExportBundle(PERIOD_ID);
    const call = state.signedUrlCalls.find((c) => c.path === "hero/d1.png");
    expect(call?.download).toBe("d1.png");
  });

  it("signs a version's asset with its asset_name as the download filename, not the storage path's basename", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [
      makeVersion({
        id: "v1",
        deliverable_id: "d1",
        storage_path: "deliverables/f1/d1/v1-internal-name.pdf",
        asset_name: "lease-checklist.pdf",
      }),
    ];
    await buildContentExportBundle(PERIOD_ID);
    const call = state.signedUrlCalls.find((c) => c.path === "deliverables/f1/d1/v1-internal-name.pdf");
    expect(call?.download).toBe("lease-checklist.pdf");
  });

  it("an artifact exports its version_id and mime_type exactly as stored", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a1",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a1.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        mime_type: "image/png",
        created_at: "2026-07-03T00:00:00Z",
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const artifact = result.bundle.deliverables[0].artifacts[0];
    expect(artifact.version_id).toBe("v1");
    expect(artifact.mime_type).toBe("image/png");
  });

  it("an artifact with no storage_path gets signed_url: null and signed_url_expires_at: null", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a1",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "webpage",
        locale: "en-CA",
        destination: "firm_website",
        storage_bucket: null,
        storage_path: null,
        public_url: "https://drglaw.ca/journal/example",
        sha256: null,
        size_bytes: null,
        created_at: "2026-07-03T00:00:00Z",
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const artifact = result.bundle.deliverables[0].artifacts[0];
    expect(artifact.signed_url).toBeNull();
    expect(artifact.signed_url_expires_at).toBeNull();
  });

  it("an artifact whose storage_bucket is set is signed from that bucket, not the default", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a1",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "hero_image",
        locale: "en-CA",
        destination: "firm_website",
        storage_bucket: "custom-artifacts-bucket",
        storage_path: "hero/d1.png",
        public_url: null,
        sha256: "def456",
        size_bytes: 2048,
        created_at: "2026-07-03T00:00:00Z",
      },
    ];
    await buildContentExportBundle(PERIOD_ID);
    const artifactSignCall = state.signedUrlCalls.find((c) => c.path === "hero/d1.png");
    expect(artifactSignCall?.bucket).toBe("custom-artifacts-bucket");
  });

  it("a signing failure on an artifact surfaces as a deliverable warning instead of being swallowed, and does not fail the bundle", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a1",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a1.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
      },
    ];
    state.signedUrlFailFor.add("publication-artifacts/d1/a1.png");
    const result = await buildContentExportBundle(PERIOD_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d1 = result.bundle.deliverables[0];
    expect(d1.artifacts[0].signed_url).toBeNull();
    expect(d1.warnings).toContain(
      "1 artifact has a stored file but its download link could not be generated. Refresh to retry.",
    );
  });

  it("a signing failure on a version's own asset surfaces as a deliverable warning instead of being swallowed", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [
      makeVersion({ id: "v1", deliverable_id: "d1", storage_path: "deliverables/f1/d1/v1.pdf" }),
    ];
    state.signedUrlFailFor.add("deliverables/f1/d1/v1.pdf");
    const result = await buildContentExportBundle(PERIOD_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d1 = result.bundle.deliverables[0];
    expect(d1.current_version?.signed_url).toBeNull();
    expect(d1.warnings).toContain(
      "This deliverable's version asset has a stored file but its download link could not be generated. Refresh to retry.",
    );
  });

  it("two artifacts failing to sign produce exactly one warning, naming the count", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a1",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a1.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
      },
      {
        id: "a2",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "hero_image",
        locale: "en-CA",
        destination: "firm_website",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a2.png",
        public_url: null,
        sha256: "def456",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
      },
    ];
    state.signedUrlFailFor.add("publication-artifacts/d1/a1.png");
    state.signedUrlFailFor.add("publication-artifacts/d1/a2.png");
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables[0];
    const failureWarnings = d1.warnings.filter((w) => w.includes("could not be generated"));
    expect(failureWarnings).toEqual([
      "2 artifacts have a stored file but their download links could not be generated. Refresh to retry.",
    ]);
  });

  it("a version-asset failure and an artifact failure together produce exactly two warnings", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [
      makeVersion({ id: "v1", deliverable_id: "d1", storage_path: "deliverables/f1/d1/v1.pdf" }),
    ];
    state.artifacts = [
      {
        id: "a1",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a1.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
      },
    ];
    state.signedUrlFailFor.add("deliverables/f1/d1/v1.pdf");
    state.signedUrlFailFor.add("publication-artifacts/d1/a1.png");
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables[0];
    const failureWarnings = d1.warnings.filter((w) => w.includes("could not be generated"));
    expect(failureWarnings).toHaveLength(2);
    expect(failureWarnings).toContain(
      "This deliverable's version asset has a stored file but its download link could not be generated. Refresh to retry.",
    );
    expect(failureWarnings).toContain(
      "1 artifact has a stored file but its download link could not be generated. Refresh to retry.",
    );
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

  it("exports cta_target_path verbatim for a gbp_post whose publication_path is null", async () => {
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        current_version_id: "v1",
        approved_version_id: "v1",
        deliverable_role: "gbp_post",
        publication_path: null,
        cta_target_path: "/resources/renewal-clause-checklist",
      }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables[0];
    expect(d1.publication_path).toBeNull();
    expect(d1.cta_target_path).toBe("/resources/renewal-clause-checklist");
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

describe("buildContentExportBundle: matches_current_version and superseded_at", () => {
  it("an artifact bound to the current version has matches_current_version true; one bound to a different version has it false", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v2", approved_version_id: "v2" }),
    ];
    state.versions = [makeVersion({ id: "v2", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a-current",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v2",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a-current.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
        superseded_at: null,
      },
      {
        id: "a-stale",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "hero_image",
        locale: "en-CA",
        destination: "firm_website",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a-stale.png",
        public_url: null,
        sha256: "def456",
        size_bytes: 1024,
        created_at: "2026-07-02T00:00:00Z",
        superseded_at: null,
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const artifacts = result.bundle.deliverables[0].artifacts;
    expect(artifacts.find((a) => a.id === "a-current")?.matches_current_version).toBe(true);
    expect(artifacts.find((a) => a.id === "a-stale")?.matches_current_version).toBe(false);
  });

  it("matches_current_version is false when current_version_id is a foreign/dangling pointer, even for an artifact that shares that raw id", async () => {
    state.deliverables = [
      // current_version_id points at v-foreign, which resolveOwnedVersion
      // treats as missing (it belongs to d2, not d1) -- so current_version
      // is null even though the raw pointer is "v-foreign".
      makeDeliverable({ id: "d1", status: "approved", current_version_id: "v-foreign", approved_version_id: "v-foreign" }),
      makeDeliverable({ id: "d2", status: "draft", current_version_id: "v-foreign", approved_version_id: null }),
    ];
    state.versions = [makeVersion({ id: "v-foreign", deliverable_id: "d2" })];
    state.artifacts = [
      {
        id: "a-foreign",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v-foreign",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a-foreign.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
        superseded_at: null,
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables.find((d) => d.id === "d1");
    expect(d1?.current_version).toBeNull();
    expect(d1?.artifacts[0].matches_current_version).toBe(false);
  });

  it("superseded_at is exported verbatim from the row", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a1",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a1.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
        superseded_at: "2026-07-04T00:00:00Z",
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].artifacts[0].superseded_at).toBe("2026-07-04T00:00:00Z");
  });
});

describe("renderContentExportMarkdown: withholds the signed URL for non-current or non-publishable artifacts", () => {
  it("withholds the signed URL line for an artifact bound to a version other than current_version_id", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v2", approved_version_id: "v2" }),
    ];
    state.versions = [makeVersion({ id: "v2", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a-stale",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "hero_image",
        locale: "en-CA",
        destination: "firm_website",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a-stale.png",
        public_url: null,
        sha256: "def456",
        size_bytes: 1024,
        created_at: "2026-07-02T00:00:00Z",
        superseded_at: null,
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const md = renderContentExportMarkdown(result.bundle);
    expect(md).toContain("Signed URL withheld");
    expect(md).not.toContain("https://signed.example/publication-artifacts/d1/a-stale.png");
  });

  it("withholds the signed URL line for an artifact bound to current_version_id when the deliverable may not publish", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", status: "in_review", current_version_id: "v1", approved_version_id: null }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a1",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a1.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
        superseded_at: null,
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].may_publish).toBe(false);
    const md = renderContentExportMarkdown(result.bundle);
    expect(md).toContain("Signed URL withheld");
    expect(md).not.toContain("https://signed.example/publication-artifacts/d1/a1.png");
  });

  it("prints the working signed URL when the artifact matches current_version_id and the deliverable may publish", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a1",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a1.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
        superseded_at: null,
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].may_publish).toBe(true);
    const md = renderContentExportMarkdown(result.bundle);
    expect(md).toContain("https://signed.example/publication-artifacts/d1/a1.png");
    expect(md).not.toContain("Signed URL withheld");
  });
});

describe("renderContentExportMarkdown: the withheld-artifact line states the reason(s) that are actually true", () => {
  it("a retracted artifact on an approved, current deliverable names retraction, not the other two (both false) reasons", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a-retracted",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a-retracted.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
        superseded_at: "2026-07-04T00:00:00Z",
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].may_publish).toBe(true);
    const md = renderContentExportMarkdown(result.bundle);
    expect(md).toContain("it has been retracted");
    expect(md).not.toContain("it is not bound to the deliverable's current version");
    expect(md).not.toContain("the deliverable is not cleared to publish");
  });

  it("an other-version artifact on a publishable deliverable (not retracted) names the version-binding reason, not retraction", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v2", approved_version_id: "v2" }),
    ];
    state.versions = [makeVersion({ id: "v2", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a-stale",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "hero_image",
        locale: "en-CA",
        destination: "firm_website",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a-stale.png",
        public_url: null,
        sha256: "def456",
        size_bytes: 1024,
        created_at: "2026-07-02T00:00:00Z",
        superseded_at: null,
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].may_publish).toBe(true);
    const md = renderContentExportMarkdown(result.bundle);
    expect(md).toContain("it is not bound to the deliverable's current version");
    expect(md).not.toContain("it has been retracted");
  });

  it("a current, matching artifact on a non-publishable deliverable (not retracted) names the publish-clearance reason, not retraction", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", status: "in_review", current_version_id: "v1", approved_version_id: null }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a1",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a1.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
        superseded_at: null,
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].may_publish).toBe(false);
    const md = renderContentExportMarkdown(result.bundle);
    expect(md).toContain("the deliverable is not cleared to publish");
    expect(md).not.toContain("it has been retracted");
    // The old fixed sentence also contained "the deliverable is not cleared
    // to publish" verbatim, so the assertion above alone does not
    // discriminate a real fix from the pre-FU6-1 fixed string ("this
    // artifact is not bound to the deliverable's current version, or...",
    // printed unconditionally whenever withheld). This one does.
    expect(md).not.toContain("this artifact is not bound to the deliverable's current version");
  });
});

describe("renderContentExportMarkdown: the version section is gated the same way the artifact section is", () => {
  it("a lead_magnet_pdf in_review with a stored version asset withholds the signed URL in the version section -- the version asset IS the deliverable's content for this role", async () => {
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        status: "in_review",
        current_version_id: "v1",
        approved_version_id: null,
        deliverable_role: "lead_magnet_pdf",
        publication_path: "/resources/checklist",
      }),
    ];
    state.versions = [
      makeVersion({
        id: "v1",
        deliverable_id: "d1",
        storage_path: "deliverables/f1/d1/checklist.pdf",
        asset_name: "checklist.pdf",
      }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].may_publish).toBe(false);
    const md = renderContentExportMarkdown(result.bundle);
    expect(md).toContain("Signed URL withheld");
    expect(md).not.toContain("https://signed.example/deliverables/f1/d1/checklist.pdf");
    // The ONLY true reason to withhold here is publish-clearance: this IS
    // the deliverable's current version, so a version-binding clause would
    // be false under a "Current version" heading.
    expect(md).toContain("the deliverable is not cleared to publish");
    expect(md).not.toContain("not the deliverable's current version");
  });

  it("the same lead_magnet_pdf, approved and current, prints the version's working signed URL", async () => {
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        status: "approved",
        current_version_id: "v1",
        approved_version_id: "v1",
        deliverable_role: "lead_magnet_pdf",
        publication_path: "/resources/checklist",
      }),
    ];
    state.versions = [
      makeVersion({
        id: "v1",
        deliverable_id: "d1",
        storage_path: "deliverables/f1/d1/checklist.pdf",
        asset_name: "checklist.pdf",
      }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].may_publish).toBe(true);
    const md = renderContentExportMarkdown(result.bundle);
    expect(md).toContain("https://signed.example/deliverables/f1/d1/checklist.pdf");
    expect(md).not.toContain("Signed URL withheld");
  });

  it("a retracted artifact on an approved, current deliverable withholds its signed URL in the artifact section", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a-retracted",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a-retracted.png",
        public_url: null,
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
        superseded_at: "2026-07-04T00:00:00Z",
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].may_publish).toBe(true);
    const md = renderContentExportMarkdown(result.bundle);
    expect(md).toContain("Superseded:");
    expect(md).toContain("Signed URL withheld");
    expect(md).not.toContain("https://signed.example/publication-artifacts/d1/a-retracted.png");
  });

  it("an other-version artifact's public_url is withheld from the Markdown, matching the pure layer's stripAccess", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v2", approved_version_id: "v2" }),
    ];
    state.versions = [makeVersion({ id: "v2", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a-stale",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "hero_image",
        locale: "en-CA",
        destination: "firm_website",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a-stale.png",
        public_url: "https://drglaw.ca/a-stale.png",
        sha256: "def456",
        size_bytes: 1024,
        created_at: "2026-07-02T00:00:00Z",
        superseded_at: null,
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const md = renderContentExportMarkdown(result.bundle);
    expect(md).not.toContain("https://drglaw.ca/a-stale.png");
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

// ─── withholdBundleLinks: the JSON branch gets the same gate as the Markdown ──
//
// buildContentExportBundle signs every asset unconditionally -- signing runs
// before may_publish is computed -- so the raw bundle is NOT safe to serialise.
// The route applies withholdBundleLinks to the json response. These tests pin
// both directions: that access really is removed where the Markdown withholds
// it, and that it is NOT removed anywhere else (a strip-everything
// implementation would satisfy the first half alone).

describe("withholdBundleLinks", () => {
  it("withholds the version signed URL for a blocked deliverable, keeping durable identity and body", async () => {
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        status: "in_review",
        current_version_id: "v1",
        approved_version_id: null,
        deliverable_role: "lead_magnet_pdf",
      }),
    ];
    state.versions = [
      makeVersion({
        id: "v1",
        deliverable_id: "d1",
        storage_path: "deliverables/f1/d1/checklist.pdf",
        asset_name: "checklist.pdf",
      }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");

    // The RAW bundle carries a working URL: this is exactly why the route
    // must not serialise it directly.
    expect(result.bundle.deliverables[0].current_version?.signed_url).toBeTruthy();

    const safe = withholdBundleLinks(result.bundle);
    const v = safe.deliverables[0].current_version;
    expect(v?.signed_url).toBeNull();
    expect(v?.signed_url_expires_at).toBeNull();
    // Identity and content survive -- an operator still has to be able to find
    // the file by hand and read the draft.
    expect(v?.storage_path).toBe("deliverables/f1/d1/checklist.pdf");
    expect(v?.asset_name).toBe("checklist.pdf");
    expect(v?.body_html).toBeTruthy();
  });

  it("withholds both signed_url and public_url for a retracted artifact on an approved, current deliverable", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    state.artifacts = [
      {
        id: "a-retracted",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a-retracted.png",
        public_url: "https://drglaw.ca/retracted.png",
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
        superseded_at: "2026-07-04T00:00:00Z",
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].may_publish).toBe(true);

    const a = withholdBundleLinks(result.bundle).deliverables[0].artifacts[0];
    expect(a.signed_url).toBeNull();
    expect(a.signed_url_expires_at).toBeNull();
    expect(a.public_url).toBeNull();
    expect(a.storage_path).toBe("publication-artifacts/d1/a-retracted.png");
    expect(a.sha256).toBe("abc123");
  });

  it("does NOT withhold an active artifact bound to the current version of a publishable deliverable", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" }),
    ];
    // storage_path is required for the version to be signed at all -- without
    // it the version's signed_url is null for want of an asset, not because
    // anything withheld it, and the assertion below would prove nothing.
    state.versions = [
      makeVersion({ id: "v1", deliverable_id: "d1", storage_path: "deliverables/f1/d1/asset.pdf" }),
    ];
    state.artifacts = [
      {
        id: "a-live",
        firm_id: FIRM_ID,
        deliverable_id: "d1",
        version_id: "v1",
        artifact_type: "social_image",
        locale: "en-CA",
        destination: "linkedin",
        storage_bucket: "firm-files",
        storage_path: "publication-artifacts/d1/a-live.png",
        public_url: "https://drglaw.ca/live.png",
        sha256: "abc123",
        size_bytes: 1024,
        created_at: "2026-07-03T00:00:00Z",
        superseded_at: null,
      },
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");

    const safe = withholdBundleLinks(result.bundle);
    const a = safe.deliverables[0].artifacts[0];
    expect(a.signed_url).toBeTruthy();
    expect(a.public_url).toBe("https://drglaw.ca/live.png");
    expect(safe.deliverables[0].current_version?.signed_url).toBeTruthy();
  });

  it("agrees with the Markdown: whatever the Markdown refuses to print is absent from the withheld bundle", async () => {
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        status: "in_review",
        current_version_id: "v1",
        approved_version_id: null,
        deliverable_role: "lead_magnet_pdf",
      }),
    ];
    state.versions = [
      makeVersion({
        id: "v1",
        deliverable_id: "d1",
        storage_path: "deliverables/f1/d1/checklist.pdf",
        asset_name: "checklist.pdf",
      }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");

    // The Markdown renderer keeps the RAW bundle on purpose: its withheld
    // line is gated on signed_url being present, so it needs to see the URL
    // in order to refuse it.
    const md = renderContentExportMarkdown(result.bundle);
    expect(md).toContain("Signed URL withheld");
    expect(md).not.toContain("https://signed.example/deliverables/f1/d1/checklist.pdf");

    const json = JSON.stringify(withholdBundleLinks(result.bundle));
    expect(json).not.toContain("https://signed.example/deliverables/f1/d1/checklist.pdf");
  });
});

// ─── the standing-authorization path (DR-107) ────────────────────────────────
//
// The bug these pin: evaluateMayPublish used to reconstruct the release bar
// locally and implemented only individual approval, so a firm running on
// standing publishing authorization -- for whom Path B is the NORMAL path, not
// an edge case -- had its entire week reported as unpublishable. DRG Law's
// week of 2026-06-29 was 15 pieces cleared through Path B, every one of them
// locked, copy withheld and downloads disabled, in an export whose whole
// purpose is to hand over exactly that material.

function enableStandingAuth() {
  state.standingAuth = [
    {
      id: "sa-1",
      firm_id: FIRM_ID,
      event_seq: 1,
      event: "enabled",
      actor_role: "lawyer",
      actor_name: "Test Lawyer",
      scope: "all_future_content",
      effective_at: "2026-07-01T00:00:00Z",
      created_at: "2026-07-01T00:00:00Z",
    },
  ];
}

describe("buildContentExportBundle: standing publishing authorization (DR-107)", () => {
  it("an in_review deliverable with NO individual approval is publishable when standing authorization is active", async () => {
    enableStandingAuth();
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        status: "in_review",
        current_version_id: "v1",
        approved_version_id: null,
      }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1", requires_individual_review: false })];

    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables.find((d) => d.id === "d1")!;
    expect(d1.may_publish).toBe(true);
    expect(d1.may_publish_reason).toBeNull();
  });

  it("requires_individual_review overrides standing authorization unconditionally", async () => {
    enableStandingAuth();
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        status: "in_review",
        current_version_id: "v1",
        approved_version_id: null,
      }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1", requires_individual_review: true })];

    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables.find((d) => d.id === "d1")!;
    expect(d1.may_publish).toBe(false);
    expect(d1.may_publish_reason).toContain("requires_individual_review");
  });

  it("the same deliverable is NOT publishable once standing authorization is absent", async () => {
    state.standingAuth = [];
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        status: "in_review",
        current_version_id: "v1",
        approved_version_id: null,
      }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1", requires_individual_review: false })];

    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables.find((d) => d.id === "d1")!.may_publish).toBe(false);
  });

  it("a revoked authorization does not authorize: only the latest event counts", async () => {
    state.standingAuth = [
      { id: "sa-1", firm_id: FIRM_ID, event_seq: 1, event: "enabled", created_at: "2026-07-01T00:00:00Z" },
      { id: "sa-2", firm_id: FIRM_ID, event_seq: 2, event: "revoked", created_at: "2026-07-02T00:00:00Z" },
    ];
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        status: "in_review",
        current_version_id: "v1",
        approved_version_id: null,
      }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1", requires_individual_review: false })];

    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables.find((d) => d.id === "d1")!.may_publish).toBe(false);
  });

  it("another firm's standing authorization never authorizes this firm's content", async () => {
    state.standingAuth = [
      {
        id: "sa-other",
        firm_id: OTHER_FIRM_ID,
        event_seq: 1,
        event: "enabled",
        created_at: "2026-07-01T00:00:00Z",
      },
    ];
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        status: "in_review",
        current_version_id: "v1",
        approved_version_id: null,
      }),
    ];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1", requires_individual_review: false })];

    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables.find((d) => d.id === "d1")!.may_publish).toBe(false);
  });

  it("standing authorization does not rescue a foreign or dangling current_version_id", async () => {
    enableStandingAuth();
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        status: "in_review",
        current_version_id: "v-foreign",
        approved_version_id: null,
      }),
    ];
    // v-foreign belongs to a different deliverable, so resolveOwnedVersion
    // rejects it and the pointer-integrity guard fires before any
    // authorization path is consulted.
    state.versions = [makeVersion({ id: "v-foreign", deliverable_id: "d-other", requires_individual_review: false })];

    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const d1 = result.bundle.deliverables.find((d) => d.id === "d1")!;
    expect(d1.may_publish).toBe(false);
    expect(d1.may_publish_reason).toContain("does not resolve to an existing version row");
  });

  it("a standing-authorized piece really does get its links, not just may_publish true", async () => {
    enableStandingAuth();
    state.deliverables = [
      makeDeliverable({
        id: "d1",
        status: "in_review",
        current_version_id: "v1",
        approved_version_id: null,
      }),
    ];
    state.versions = [
      makeVersion({
        id: "v1",
        deliverable_id: "d1",
        requires_individual_review: false,
        storage_path: "deliverables/f1/d1/asset.pdf",
        asset_name: "asset.pdf",
      }),
    ];

    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    // The whole point: the operator can actually collect the file.
    const safe = withholdBundleLinks(result.bundle);
    expect(safe.deliverables[0].current_version?.signed_url).toBeTruthy();
    const md = renderContentExportMarkdown(result.bundle);
    expect(md).not.toContain("Signed URL withheld");
  });
});

// ─── individual_review_hold: exported so the reason can be attributed ────────

describe("buildContentExportBundle: individual_review_hold", () => {
  it("exports the reason and its author when the current version is held", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", status: "in_review", current_version_id: "v1", approved_version_id: null }),
    ];
    state.versions = [
      makeVersion({
        id: "v1",
        deliverable_id: "d1",
        requires_individual_review: true,
        requires_individual_review_reason: "Unsubscribe link is a placeholder pending GHL sending setup.",
        requires_individual_review_set_by_role: "operator",
        requires_individual_review_set_by_name: null,
        requires_individual_review_set_at: "2026-07-22T00:00:00Z",
      }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    const hold = result.bundle.deliverables[0].individual_review_hold;
    expect(hold?.reason).toBe("Unsubscribe link is a placeholder pending GHL sending setup.");
    expect(hold?.set_by_role).toBe("operator");
    expect(hold?.set_at).toBe("2026-07-22T00:00:00Z");
  });

  it("is null when the current version is not held", async () => {
    state.deliverables = [makeDeliverable({ id: "d1", current_version_id: "v1", approved_version_id: "v1" })];
    state.versions = [makeVersion({ id: "v1", deliverable_id: "d1" })];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bundle.deliverables[0].individual_review_hold).toBeNull();
  });

  it("reads the flag off the RESOLVED version: a foreign pointer yields no hold", async () => {
    state.deliverables = [
      makeDeliverable({ id: "d1", status: "in_review", current_version_id: "v-foreign", approved_version_id: null }),
    ];
    state.versions = [
      makeVersion({ id: "v-foreign", deliverable_id: "d-other", requires_individual_review: true }),
    ];
    const result = await buildContentExportBundle(PERIOD_ID);
    if (!result.ok) throw new Error("expected ok");
    // The version is not owned by this deliverable, so neither the decision nor
    // its explanation may be taken from it.
    expect(result.bundle.deliverables[0].individual_review_hold).toBeNull();
  });
});
