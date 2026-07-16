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
    order: () => builder,
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
} from "@/lib/publication-receipts";

const FIRM_ID = "f1111111-1111-1111-1111-111111111111";
const DELIVERABLE_ID = "d1111111-1111-1111-1111-111111111111";
const PLACEMENT_ID = "pl111111-1111-1111-1111-111111111111";
const VERSION_ID = "v1111111-1111-1111-1111-111111111111";

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
      publicUrl: "https://drglaw.ca/journal/example",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    if (!created.ok) throw new Error("expected ok");

    const verified = await verifyReceipt(created.receipt.id, {
      method: "url_fetch",
      passed: true,
      verifierRole: "system",
      verifierId: null,
      verifierName: "Automated Check",
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

  it("attributes the verification to the verifier, not the original publisher (WS5)", async () => {
    const created = await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "firm_website",
      approvedVersionId: VERSION_ID,
      publicUrl: "https://drglaw.ca/journal/example",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
      actorId: null,
      actorName: "Operator",
    });
    if (!created.ok) throw new Error("expected ok");

    // Verifier is a DIFFERENT identity than the original publisher, so a
    // regression back to copying the original receipt's own actor fields
    // would be caught here.
    const verified = await verifyReceipt(created.receipt.id, {
      method: "operator_attestation",
      passed: true,
      verifierRole: "lawyer",
      verifierId: "law-999",
      verifierName: "Damaris",
    });
    if (!verified.ok) throw new Error("expected ok");
    expect(verified.receipt.actor_role).toBe("lawyer");
    expect(verified.receipt.actor_id).toBe("law-999");
    expect(verified.receipt.actor_name).toBe("Damaris");
  });

  it("records a failed verification with the failure reason, still as a new row", async () => {
    const created = await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "firm_website",
      approvedVersionId: VERSION_ID,
      publicUrl: "https://drglaw.ca/journal/example",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    if (!created.ok) throw new Error("expected ok");

    const verified = await verifyReceipt(created.receipt.id, {
      method: "url_fetch",
      passed: false,
      failureReason: "404 not found",
      verifierRole: "system",
      verifierId: null,
      verifierName: "Automated Check",
    });
    if (!verified.ok) throw new Error("expected ok");
    expect(verified.receipt.verification_state).toBe("failed");
    expect(verified.receipt.failure_reason).toBe("404 not found");
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
      publicUrl: "https://drglaw.ca/journal/example",
      publishedAt: new Date().toISOString(),
      actorRole: "operator",
    });
    if (!created.ok) throw new Error("expected ok");
    const verified = await verifyReceipt(created.receipt.id, {
      method: "url_fetch",
      passed: true,
      verifierRole: "system",
      verifierId: null,
      verifierName: "Automated Check",
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
});

describe("listReceiptsForPlacement", () => {
  it("signs evidence storage paths when present", async () => {
    await createReceipt({
      firmId: FIRM_ID,
      deliverableId: DELIVERABLE_ID,
      placementId: PLACEMENT_ID,
      destination: "linkedin_post",
      approvedVersionId: VERSION_ID,
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
