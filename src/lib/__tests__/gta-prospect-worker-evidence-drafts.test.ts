import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { reconcileGtaProspectWorkerEvidenceDraft, submitGtaProspectWorkerEvidenceDraft, validateGtaProspectWorkerEvidenceDraft } from "../gta-prospect-worker-evidence-drafts";

const draft = {
  schemaVersion: 1, observedOn: "2026-09-14",
  sources: [{ sourceId: "firm-site", sourceUrl: "https://example.test/team", observedOn: "2026-09-14", sourceKind: "first_party", contentSha256: "a".repeat(64) }],
  identity: { state: "confirmed", candidateName: "Example Law", canonicalDomain: "example.test", confidence: "high", sourceIds: ["firm-site"] },
  lawyerCount: { count: 2, qualifier: "exact", confidence: "high", sourceIds: ["firm-site"] },
  ownerContact: { name: "Avery Owner", relationship: "confirmed_owner", publicEmail: "avery@example.test", emailKind: "direct_owner_email", confidence: "high", sourceIds: ["firm-site"] },
  downtown: { state: "inside", confidence: "high", sourceIds: ["firm-site"] },
  advertising: { state: "observable_activity", confidence: "moderate", sourceIds: ["firm-site"] },
  googleBusinessProfile: { state: "opportunity_supported", confidence: "moderate", sourceIds: ["firm-site"] },
  website: { state: "opportunity_supported", confidence: "moderate", sourceIds: ["firm-site"] },
  intakeChannels: { channels: ["phone", "contact_form"], sourceIds: ["firm-site"] },
  qualificationState: "qualified", holdStates: [],
  controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false },
};

describe("GTA prospect worker evidence drafts", () => {
  it("requires source-backed evidence and no-contact controls", () => {
    expect(validateGtaProspectWorkerEvidenceDraft(draft)).toEqual(draft);
    expect(() => validateGtaProspectWorkerEvidenceDraft({ ...draft, controls: { ...draft.controls, outreachSent: true } })).toThrow("forbids form submission");
    expect(() => validateGtaProspectWorkerEvidenceDraft({ ...draft, ownerContact: { ...draft.ownerContact, name: null } })).toThrow("Direct owner email");
  });
  it("canonicalizes through the service-only hash RPC before it submits an owned lease draft", async () => {
    const rpc = vi.fn(async (name: string) => name === "gta_prospect_worker_evidence_draft_sha256"
      ? { data: "b".repeat(64), error: null }
      : { data: { state: "created", draft_id: "00000000-0000-0000-0000-000000000001", observation_sha256: "b".repeat(64) }, error: null });
    await expect(submitGtaProspectWorkerEvidenceDraft({ workItemId: "00000000-0000-0000-0000-000000000001", workerId: "worker-a", observation: draft, client: { rpc } })).resolves.toMatchObject({ state: "created" });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["gta_prospect_worker_evidence_draft_sha256", "submit_gta_prospect_worker_evidence_draft"]);
  });
  it("keeps identity and evidence holds explicit during reconciliation", async () => {
    const rpc = vi.fn(async () => ({ data: { state: "reconciled" }, error: null }));
    await reconcileGtaProspectWorkerEvidenceDraft({ draftId: "00000000-0000-0000-0000-000000000001", reconciliationState: "evidence_hold", holdState: "owner_email_unavailable", note: "Published firm inbox does not establish a direct owner email.", client: { rpc } });
    expect(rpc).toHaveBeenCalledWith("reconcile_gta_prospect_worker_evidence_draft", expect.objectContaining({ p_hold_state: "owner_email_unavailable", p_firm_id: null }));
  });
});
