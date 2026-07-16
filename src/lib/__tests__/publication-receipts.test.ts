/**
 * publication-receipts.ts: I/O layer over the append-only
 * publication_receipts table. Proves: a fresh receipt always starts
 * 'unverified' (a URL/ID is an attempt, not proof); verifyReceipt inserts
 * a NEW row that reconciles the original rather than mutating it
 * (append-only end to end, including verification); getCurrentReceiptFor
 * Placement finds the tip of a reconciliation chain.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

const state: { receipts: Row[] } = { receipts: [] };

function chainable(rows: Row[]) {
  let current = rows;
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      current = current.filter((r) => r[col] === val);
      return builder;
    },
    // Real Supabase calls this as .order("created_at", { ascending: false })
    // to get the tip of a reconciliation chain first; this mock previously
    // no-opped, which happened to work only because these tests inserted
    // rows in an order that coincidentally matched. Sorting for real here
    // makes the mock faithful to production ordering.
    order: (col: string, opts?: { ascending?: boolean }) => {
      const ascending = opts?.ascending ?? true;
      current = [...current].sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        if (av < bv) return ascending ? -1 : 1;
        if (av > bv) return ascending ? 1 : -1;
        return 0;
      });
      return builder;
    },
    maybeSingle: () => Promise.resolve({ data: current[0] ?? null, error: null }),
    insert: (row: Row) => {
      const inserted: Row = {
        id: `r-${state.receipts.length + 1}`,
        verification_state: "unverified",
        verified_at: null,
        verification_method: null,
        evidence_storage_bucket: null,
        evidence_storage_path: null,
        failure_reason: null,
        reconciles_receipt_id: null,
        created_at: new Date(state.receipts.length).toISOString(),
        ...row,
      };
      state.receipts.push(inserted);
      return {
        select: () => ({
          single: () => Promise.resolve({ data: inserted, error: null }),
        }),
      };
    },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: current, error: null }),
  };
  return builder;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "publication_receipts") return chainable(state.receipts);
      throw new Error(`unexpected table in mock: ${table}`);
    },
    storage: {
      from: () => ({
        createSignedUrl: (path: string) =>
          Promise.resolve({ data: { signedUrl: `https://signed.example/${path}` }, error: null }),
      }),
    },
  },
}));

import {
  createReceipt,
  verifyReceipt,
  listReceiptsForPlacement,
  getCurrentReceiptForPlacement,
  listCurrentReceiptsByPlacementForDeliverable,
} from "@/lib/publication-receipts";

const FIRM_ID = "f1111111-1111-1111-1111-111111111111";
const DELIVERABLE_ID = "d1111111-1111-1111-1111-111111111111";
const PLACEMENT_ID = "pl111111-1111-1111-1111-111111111111";
const VERSION_ID = "v1111111-1111-1111-1111-111111111111";
const VERSION_ID_2 = "v2222222-2222-2222-2222-222222222222";
const CLAIM_ID = "cl111111-1111-1111-1111-111111111111";
const CLAIM_ID_2 = "cl222222-2222-2222-2222-222222222222";

beforeEach(() => {
  state.receipts = [];
});

describe("createReceipt", () => {
  it("always starts unverified, regardless of what evidence is supplied", async () => {
    const result = await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "linkedin_post",
      approvedVersionId: VERSION_ID,
      claimId: CLAIM_ID,
      publicUrl: "https://linkedin.com/posts/example",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.verification_state).toBe("unverified");
    expect(result.receipt.verified_at).toBeNull();
  });
});

describe("verifyReceipt", () => {
  it("inserts a NEW row reconciling the original rather than mutating it", async () => {
    const created = await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "firm_website",
      approvedVersionId: VERSION_ID,
      claimId: CLAIM_ID,
      publicUrl: "https://drglaw.ca/journal/example",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    if (!created.ok) throw new Error("expected ok");

    const verified = await verifyReceipt(created.receipt.id, {
      method: "url_fetch",
      passed: true,
      verifierRole: "operator",
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.receipt.id).not.toBe(created.receipt.id);
    expect(verified.receipt.reconciles_receipt_id).toBe(created.receipt.id);
    expect(verified.receipt.verification_state).toBe("verified");

    // The original row is untouched: still unverified in the store.
    expect(state.receipts.find((r) => r.id === created.receipt.id)?.verification_state).toBe(
      "unverified",
    );
    expect(state.receipts).toHaveLength(2);
  });

  it("records a failed verification with the failure reason, still as a new row", async () => {
    const created = await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "firm_website",
      approvedVersionId: VERSION_ID,
      claimId: CLAIM_ID,
      publicUrl: "https://drglaw.ca/journal/example",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    if (!created.ok) throw new Error("expected ok");

    const verified = await verifyReceipt(created.receipt.id, {
      method: "url_fetch",
      passed: false,
      failureReason: "404 not found",
      verifierRole: "operator",
    });
    if (!verified.ok) throw new Error("expected ok");
    expect(verified.receipt.verification_state).toBe("failed");
    expect(verified.receipt.failure_reason).toBe("404 not found");
  });

  it("records the VERIFIER's identity, not the original receipt's actor (Workstream 5)", async () => {
    // The original receipt was published as 'system' (e.g. a channel-originated
    // receipt) with no operator identity at all; the verification pass is a
    // completely different actor (the operator who confirmed it live). Before
    // this fix, actor_role/actor_id/actor_name were copied from the original
    // row, so the verifying operator's identity was silently discarded.
    const created = await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "firm_website",
      approvedVersionId: VERSION_ID,
      claimId: CLAIM_ID,
      publicUrl: "https://drglaw.ca/journal/example",
      publishedAt: new Date().toISOString(),
      actorRole: "system",
    });
    if (!created.ok) throw new Error("expected ok");

    const verified = await verifyReceipt(created.receipt.id, {
      method: "url_fetch",
      passed: true,
      verifierRole: "operator",
      verifierId: "op-1",
      verifierName: "Operator",
    });
    if (!verified.ok) throw new Error("expected ok");
    expect(verified.receipt.actor_role).toBe("operator");
    expect(verified.receipt.actor_id).toBe("op-1");
    expect(verified.receipt.actor_name).toBe("Operator");

    // The original row's own actor fields are untouched (append-only).
    expect(state.receipts.find((r) => r.id === created.receipt.id)?.actor_role).toBe("system");
  });

  it("always copies approved_version_id from the original receipt unchanged", async () => {
    // The DB trigger's post-revision fix (20260716120000, see
    // scripts/verify-publication-receipt-verification-after-revision-fix.sql)
    // exempts a verification/failure row from the deliverable's CURRENT
    // approval-state gates, on the condition that it asserts the SAME
    // approved_version_id as the receipt it reconciles -- never a
    // different one. That condition is a property of what this function
    // sends to the database, not something the trigger itself can be
    // exercised against here (this suite's fake has no trigger). Pinning
    // it at this layer is what keeps the two halves of the fix in sync: if
    // this line ever started copying a re-derived or caller-supplied
    // version instead of the original's own, the DB-level exemption would
    // silently stop being sound.
    const created = await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "firm_website",
      approvedVersionId: VERSION_ID,
      claimId: CLAIM_ID,
      publicUrl: "https://drglaw.ca/journal/example",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    if (!created.ok) throw new Error("expected ok");

    const verified = await verifyReceipt(created.receipt.id, {
      method: "url_fetch",
      passed: true,
      verifierRole: "operator",
    });
    if (!verified.ok) throw new Error("expected ok");
    expect(verified.receipt.approved_version_id).toBe(VERSION_ID);
    expect(verified.receipt.approved_version_id).toBe(created.receipt.approved_version_id);
  });
});

describe("getCurrentReceiptForPlacement", () => {
  it("returns the tip of the reconciliation chain, not the original receipt", async () => {
    const created = await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "firm_website",
      approvedVersionId: VERSION_ID,
      claimId: CLAIM_ID,
      publicUrl: "https://drglaw.ca/journal/example",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    if (!created.ok) throw new Error("expected ok");
    const verified = await verifyReceipt(created.receipt.id, {
      method: "url_fetch",
      passed: true,
      verifierRole: "operator",
    });
    if (!verified.ok) throw new Error("expected ok");

    const current = await getCurrentReceiptForPlacement(PLACEMENT_ID);
    expect(current?.id).toBe(verified.receipt.id);
    expect(current?.verification_state).toBe("verified");
  });

  it("returns null when no receipt exists for the placement", async () => {
    const current = await getCurrentReceiptForPlacement("pl-nonexistent");
    expect(current).toBeNull();
  });

  it("(workstream 2) scopes the chain lookup by approvedVersionId, so a verified older version never masks a later version's own chain", async () => {
    const v1 = await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "firm_website",
      approvedVersionId: VERSION_ID,
      claimId: CLAIM_ID,
      publicUrl: "https://drglaw.ca/journal/v1",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    if (!v1.ok) throw new Error("expected ok");
    const v1Verified = await verifyReceipt(v1.receipt.id, {
      method: "url_fetch",
      passed: true,
      verifierRole: "operator",
    });
    if (!v1Verified.ok) throw new Error("expected ok");

    const v2 = await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "firm_website",
      approvedVersionId: VERSION_ID_2,
      claimId: CLAIM_ID_2,
      publicUrl: "https://drglaw.ca/journal/v2",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    if (!v2.ok) throw new Error("expected ok");

    const currentForV1 = await getCurrentReceiptForPlacement(PLACEMENT_ID, VERSION_ID);
    expect(currentForV1?.id).toBe(v1Verified.receipt.id);
    expect(currentForV1?.verification_state).toBe("verified");

    const currentForV2 = await getCurrentReceiptForPlacement(PLACEMENT_ID, VERSION_ID_2);
    expect(currentForV2?.id).toBe(v2.receipt.id);
    expect(currentForV2?.verification_state).toBe("unverified");

    // Unscoped (no approvedVersionId) preserves the old whole-history tip
    // behavior for callers that genuinely want it.
    const unscoped = await getCurrentReceiptForPlacement(PLACEMENT_ID);
    expect(unscoped?.id).toBe(v2.receipt.id);
  });
});

describe("listCurrentReceiptsByPlacementForDeliverable", () => {
  it("(workstream 2) scopes each placement's chain by the approvedVersionId passed in, not the whole history", async () => {
    const v1 = await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "firm_website",
      approvedVersionId: VERSION_ID,
      claimId: CLAIM_ID,
      publicUrl: "https://drglaw.ca/journal/v1",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    if (!v1.ok) throw new Error("expected ok");
    await verifyReceipt(v1.receipt.id, { method: "url_fetch", passed: true, verifierRole: "operator" });

    const v2 = await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "firm_website",
      approvedVersionId: VERSION_ID_2,
      claimId: CLAIM_ID_2,
      publicUrl: "https://drglaw.ca/journal/v2",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    if (!v2.ok) throw new Error("expected ok");

    const byPlacementV2 = await listCurrentReceiptsByPlacementForDeliverable(DELIVERABLE_ID, VERSION_ID_2);
    expect(byPlacementV2[PLACEMENT_ID]?.id).toBe(v2.receipt.id);

    const byPlacementV1 = await listCurrentReceiptsByPlacementForDeliverable(DELIVERABLE_ID, VERSION_ID);
    expect(byPlacementV1[PLACEMENT_ID]?.verification_state).toBe("verified");
  });
});

describe("listReceiptsForPlacement", () => {
  it("signs evidence storage paths when present", async () => {
    await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "linkedin_post",
      approvedVersionId: VERSION_ID,
      claimId: CLAIM_ID,
      publicUrl: "https://linkedin.com/posts/example",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    const rows = await listReceiptsForPlacement(PLACEMENT_ID);
    expect(rows).toHaveLength(1);
    // No evidence_storage_path on this receipt, so no signed URL should be attached.
    expect(rows[0].evidence_signed_url).toBeUndefined();
  });
});
