import { describe, expect, it, vi } from "vitest";

import { executeProspectProvisioningRpc, type ProspectBatchRpcClient } from "../importer";
import { PROSPECTING_MANIFEST_SCHEMA_VERSION, validateProspectProvisionManifest } from "../manifest";

function validatedManifest() {
  const records = (["BA", "AE"] as const).flatMap((arm) => Array.from({ length: 50 }, (_, offset) => {
    const index = offset + 1;
    const domain = `${arm.toLowerCase()}-${index}.example.test`;
    return {
      cls_record_id: `${arm}-B1-${String(index).padStart(2, "0")}`,
      arm,
      source_url: `https://${domain}/owner`,
      organization: { display_name: `${arm} Firm ${index}`, city: "Toronto", website_url: `https://${domain}` },
      person: null,
      source_payload: {
        arm,
        method: arm === "BA" ? "beyond_agency" : "adam_erhart",
        evidence: [{ url: `https://${domain}/owner`, observed_at: "2026-09-10T12:00:00Z", label: "Owner page" }],
        highlevel: { location_id: null, contact_id: null, smart_list_id: null, workflow_ids: [] },
      },
      provisioning_basis: "Reconciled first-party firm source.",
    };
  }));
  return validateProspectProvisionManifest(JSON.stringify({
    schema_version: PROSPECTING_MANIFEST_SCHEMA_VERSION,
    generated_at: "2026-09-10T12:00:00Z",
    records,
  }));
}

function rpcReceipt(mode: "dry-run" | "apply") {
  return {
    mode,
    source_system: "prospecting_control_plane",
    counts: {
      input: 100, BA: 50, AE: 50, existing: 0, absent: 100,
      provisioned: mode === "apply" ? 100 : 0,
      total_after: mode === "apply" ? 100 : 0,
      activities_before: 0, activities_after: 0,
    },
    assertions: {
      exact_record_count: true,
      exact_arm_split: true,
      canonical_bijection_after_apply: mode === "apply" ? true : "not_applicable_dry_run",
      activity_count_unchanged: true,
      transaction: mode === "apply" ? "rpc_atomic_apply" : "rpc_read_only",
    },
    records: Array.from({ length: 100 }, (_, index) => {
      const arm = index < 50 ? "BA" : "AE";
      const number = String(index < 50 ? index + 1 : index - 49).padStart(2, "0");
      const clsRecordId = `${arm}-B1-${number}`;
      return {
        cls_record_id: clsRecordId,
        arm,
        idempotency_key: `prospecting_control_plane:provision:${clsRecordId}:v1`,
        state: mode === "apply" ? "provisioned" : "absent",
        source_link_id: mode === "apply" ? `source-${index}` : null,
        conversation_id: mode === "apply" ? `conversation-${index}` : null,
      };
    }),
  };
}

describe("executeProspectProvisioningRpc", () => {
  it("makes exactly one dry-run RPC call without injecting the digest into source data", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: rpcReceipt("dry-run"), error: null });
    const result = await executeProspectProvisioningRpc({ rpc } as ProspectBatchRpcClient, validatedManifest(), "11111111-1111-4111-8111-111111111111", false);
    expect(result.mode).toBe("dry-run");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("provision_prospect_source_batch", expect.objectContaining({
      p_apply: false,
      p_operator_id: "11111111-1111-4111-8111-111111111111",
    }));
    expect(rpc.mock.calls[0][1].p_manifest).not.toHaveProperty("manifest_sha256");
  });

  it("makes exactly one atomic apply RPC call", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: rpcReceipt("apply"), error: null });
    const result = await executeProspectProvisioningRpc({ rpc } as ProspectBatchRpcClient, validatedManifest(), "11111111-1111-4111-8111-111111111111", true);
    expect(result.counts.provisioned).toBe(100);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_apply).toBe(true);
  });

  it("fails closed on RPC errors or malformed receipts", async () => {
    const failedRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "preflight conflict" } });
    await expect(executeProspectProvisioningRpc({ rpc: failedRpc } as ProspectBatchRpcClient, validatedManifest(), "11111111-1111-4111-8111-111111111111", false)).rejects.toThrow("preflight conflict");

    const malformedRpc = vi.fn().mockResolvedValue({ data: { mode: "dry-run" }, error: null });
    await expect(executeProspectProvisioningRpc({ rpc: malformedRpc } as ProspectBatchRpcClient, validatedManifest(), "11111111-1111-4111-8111-111111111111", false)).rejects.toThrow("invalid receipt shape");
  });
});
