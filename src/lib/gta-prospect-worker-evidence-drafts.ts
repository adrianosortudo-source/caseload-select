import "server-only";

type RpcError = { message?: string } | null;
export type GtaProspectWorkerEvidenceClient = { rpc: (functionName: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }> };
export const GTA_PROSPECT_WORKER_HOLD_STATES = ["identity_unresolved", "lawyer_count_unverified", "downtown_unverified", "owner_email_unavailable", "advertising_unverified", "gbp_unverified", "website_intake_unverified", "source_inaccessible", "outside_downtown", "outside_lawyer_band", "not_a_firm", "other"] as const;
export type GtaProspectWorkerHoldState = typeof GTA_PROSPECT_WORKER_HOLD_STATES[number];
export type GtaProspectWorkerEvidenceDraft = Readonly<Record<string, unknown>>;

const sha256 = /^[a-f0-9]{64}$/;
const asObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const rpcError = (error: RpcError, fallback: string) => new Error(error?.message ?? fallback);

/** Client guard only; the service-only database canonicalizer is authoritative. */
export function validateGtaProspectWorkerEvidenceDraft(input: unknown): GtaProspectWorkerEvidenceDraft {
  if (!asObject(input) || input.schemaVersion !== 1 || !text(input.observedOn)) throw new Error("Worker evidence draft has an invalid version or observation date.");
  if (!asObject(input.controls) || input.controls.contactFormsSubmitted !== false || input.controls.chatSessionsStarted !== false || input.controls.outreachSent !== false) throw new Error("Worker evidence draft forbids form submission, chat, and outreach.");
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 50) throw new Error("Worker evidence draft requires 1 to 50 source artifacts.");
  const sourceIds = new Set<string>();
  for (const source of input.sources) {
    if (!asObject(source) || !text(source.sourceId) || !text(source.sourceUrl) || !/^https?:\/\//.test(source.sourceUrl) || !text(source.observedOn) || !text(source.sourceKind) || !text(source.contentSha256) || !sha256.test(source.contentSha256)) throw new Error("Worker evidence draft has an invalid source artifact.");
    if (sourceIds.has(source.sourceId)) throw new Error("Worker evidence draft source IDs must be unique.");
    sourceIds.add(source.sourceId);
  }
  for (const field of ["identity", "lawyerCount", "ownerContact", "downtown", "advertising", "googleBusinessProfile", "website", "intakeChannels"] as const) {
    const finding = input[field];
    if (!asObject(finding) || !Array.isArray(finding.sourceIds) || finding.sourceIds.length === 0 || finding.sourceIds.some((id) => !text(id) || !sourceIds.has(id))) throw new Error(`Worker evidence draft ${field} must cite source artifacts.`);
  }
  if (!asObject(input.ownerContact) || !["confirmed_owner", "leadership_only", "unavailable"].includes(input.ownerContact.relationship as string) || !["direct_owner_email", "firm_general_email", "unavailable"].includes(input.ownerContact.emailKind as string)) throw new Error("Worker evidence draft has invalid owner-contact evidence.");
  if (input.ownerContact.emailKind === "direct_owner_email" && (input.ownerContact.relationship !== "confirmed_owner" || !text(input.ownerContact.name) || !text(input.ownerContact.publicEmail))) throw new Error("Direct owner email requires public confirmed-owner evidence; email patterns are never guessed.");
  if (input.ownerContact.emailKind === "unavailable" && input.ownerContact.publicEmail !== null) throw new Error("Unavailable owner email cannot include an email.");
  if (!Array.isArray(input.holdStates) || input.holdStates.some((hold) => !GTA_PROSPECT_WORKER_HOLD_STATES.includes(hold as GtaProspectWorkerHoldState))) throw new Error("Worker evidence draft has invalid hold states.");
  if (!["qualified", "needs_evidence", "disqualified"].includes(input.qualificationState as string)) throw new Error("Worker evidence draft has invalid qualification state.");
  return input;
}

export async function submitGtaProspectWorkerEvidenceDraft({ workItemId, workerId, observation, client }: Readonly<{ workItemId: string; workerId: string; observation: unknown; client?: GtaProspectWorkerEvidenceClient }>): Promise<Readonly<{ state: "created" | "already_present"; draftId: string; observationSha256: string }>> {
  const draft = validateGtaProspectWorkerEvidenceDraft(observation);
  if (!text(workItemId) || !text(workerId) || !/^[-_a-z0-9]{1,120}$/.test(workerId)) throw new Error("workItemId and workerId are invalid.");
  const db = client ?? await (async () => { const { supabaseAdmin } = await import("@/lib/supabase-admin"); return supabaseAdmin as unknown as GtaProspectWorkerEvidenceClient; })();
  const hashed = await db.rpc("gta_prospect_worker_evidence_draft_sha256", { p_observation: draft });
  if (hashed.error || !text(hashed.data) || !sha256.test(hashed.data)) throw rpcError(hashed.error, "Could not canonicalize the worker evidence draft.");
  const submitted = await db.rpc("submit_gta_prospect_worker_evidence_draft", { p_work_item_id: workItemId, p_worker_id: workerId, p_observation: draft, p_observation_sha256: hashed.data });
  if (submitted.error || !asObject(submitted.data) || (submitted.data.state !== "created" && submitted.data.state !== "already_present") || !text(submitted.data.draft_id) || !text(submitted.data.observation_sha256)) throw rpcError(submitted.error, "Could not submit the worker evidence draft.");
  return { state: submitted.data.state, draftId: submitted.data.draft_id, observationSha256: submitted.data.observation_sha256 };
}

export async function reconcileGtaProspectWorkerEvidenceDraft({ draftId, reconciliationState, firmId = null, stableFirmId = null, holdState = null, note, client }: Readonly<{ draftId: string; reconciliationState: "linked" | "identity_hold" | "evidence_hold" | "out_of_scope"; firmId?: string | null; stableFirmId?: string | null; holdState?: GtaProspectWorkerHoldState | null; note: string; client?: GtaProspectWorkerEvidenceClient }>): Promise<void> {
  const linked = reconciliationState === "linked";
  if (!text(draftId) || !text(note) || note.length > 2_000 || (linked !== Boolean(firmId && stableFirmId)) || (!linked && !holdState)) throw new Error("Worker evidence reconciliation is invalid.");
  const db = client ?? await (async () => { const { supabaseAdmin } = await import("@/lib/supabase-admin"); return supabaseAdmin as unknown as GtaProspectWorkerEvidenceClient; })();
  const response = await db.rpc("reconcile_gta_prospect_worker_evidence_draft", { p_draft_id: draftId, p_reconciliation_state: reconciliationState, p_firm_id: firmId, p_stable_firm_id: stableFirmId, p_hold_state: holdState, p_reconciliation_note: note.trim() });
  if (response.error) throw rpcError(response.error, "Could not reconcile the worker evidence draft.");
}
