import { beforeEach, describe, expect, it, vi } from "vitest";
import { agencyFollowupRecipientEmailHash } from "@/lib/agency-followup-domain";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
const h = vi.hoisted(() => {
  const rows: Record<string, Row[]> = {}, calls: string[] = [], rpc = vi.fn();
  const selects: Array<{ table: string; columns: string }> = [];
  const orders: Array<{ table: string; column: string; ascending: boolean }> = [];
  const ranges: Array<{ table: string; from: number; to: number }> = [];
  const supabaseAdmin = { from: (table: string) => {
    calls.push(table);
    const filters: Array<[string, unknown]> = [], q: Record<string, unknown> = {};
    let pageRange: [number, number] | null = null;
    Object.assign(q, {
      select: (columns: string) => { selects.push({ table, columns }); return q; },
      eq: (key: string, val: unknown) => { filters.push([key, val]); return q; },
      order: (column: string, options?: { ascending?: boolean }) => { orders.push({ table, column, ascending: options?.ascending !== false }); return q; },
      range: (from: number, to: number) => { pageRange = [from, to]; ranges.push({ table, from, to }); return q; },
      maybeSingle: () => Promise.resolve((rows[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v))).then((found) => ({ data: found.length === 1 ? found[0] : null, error: found.length > 1 ? { message: "multiple" } : null })),
      then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => {
        const found = (rows[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
        const page = pageRange ? found.slice(pageRange[0], pageRange[1] + 1) : found;
        return Promise.resolve({ data: page, error: null }).then(resolve, reject);
      },
    });
    return q;
  }, rpc };
  return { rows, calls, selects, orders, ranges, rpc, supabaseAdmin };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: h.supabaseAdmin }));
import { AgencyFollowupOptInError, recordAgencyFollowupOptInEvent } from "@/lib/agency-followup-opt-in";

const ACTOR = "11111111-1111-4111-8111-111111111111", PROSPECT = "22222222-2222-4222-8222-222222222222", EMAIL = "owner@example.test", SHA = "a".repeat(64);
const input = (eventType: "opt_in_granted" | "opt_in_withdrawn" = "opt_in_granted") => ({
  prospectId: PROSPECT, actorOperatorId: ACTOR, eventType, capturedAt: "2026-10-20T12:00:00Z",
  captureSource: "subject_email" as const, consentTextVersion: "v1", consentTextSha256: SHA,
  evidenceReference: "vault://consent/evidence-1", evidenceSha256: "b".repeat(64),
  idempotencyKey: "event-1", evidenceReviewed: true as const,
});
function setContext() {
  h.rows.firm_lawyers = [{ id: ACTOR, role: "operator", disabled: false }];
  h.rows.agency_prospects = [{ id: PROSPECT, contact_email: EMAIL }];
  h.rows.prospect_source_links = [{ id: "source", source_record_key: PROSPECT, source_system: "agency_crm_contact", active: true, organization_id: "org", person_id: "person" }];
  h.rows.prospect_conversation_sources = [{ source_link_id: "source", conversation_id: "conversation" }];
  h.rows.prospect_conversations = [{ id: "conversation", organization_id: "org", person_id: "person" }];
  h.rows.prospect_people = [{ id: "person", primary_email: EMAIL }];
  h.rows.prospect_person_firm_roles = [{ organization_id: "org", person_id: "person", active: true }];
}
beforeEach(() => {
  Object.keys(h.rows).forEach((key) => delete h.rows[key]);
  h.calls.length = 0; h.selects.length = 0; h.orders.length = 0; h.ranges.length = 0;
  h.rpc.mockReset(); setContext();
  h.rpc.mockResolvedValue({ data: [{ event_id: "event", replayed: false }], error: null });
});
describe("recordAgencyFollowupOptInEvent", () => {
  it.each(["opt_in_granted", "opt_in_withdrawn"] as const)("records %s through the validated append-only RPC", async (eventType) => {
    const result = await recordAgencyFollowupOptInEvent(input(eventType));
    expect(result).toEqual({ eventId: "event", replayed: false, recipientEmailSha256: agencyFollowupRecipientEmailHash(EMAIL) });
    expect(h.rpc).toHaveBeenCalledWith("record_agency_followup_opt_in_event", expect.objectContaining({
      p_event_type: eventType, p_source_link_id: "source", p_conversation_id: "conversation",
      p_recipient_email_sha256: agencyFollowupRecipientEmailHash(EMAIL), p_actor_operator_id: ACTOR,
    }));
    expect(h.selects.filter((selection) => selection.table === "firm_lawyers")).toEqual([
      { table: "firm_lawyers", columns: "id,role,disabled" },
    ]);
  });
  it("rejects a current contact/source-person mismatch without appending", async () => {
    h.rows.prospect_people[0].primary_email = "changed@example.test";
    await expect(recordAgencyFollowupOptInEvent(input())).rejects.toThrow("does not match the source person");
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("rejects inactive operators without appending", async () => {
    h.rows.firm_lawyers[0].disabled = true;
    await expect(recordAgencyFollowupOptInEvent(input())).rejects.toThrow("Only an active operator");
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("returns the existing event on an exact idempotent replay", async () => {
    h.rpc.mockResolvedValue({ data: [{ event_id: "event", replayed: true }], error: null });
    await expect(recordAgencyFollowupOptInEvent(input())).resolves.toMatchObject({ eventId: "event", replayed: true });
  });
  it("classifies a known RPC identity/idempotency conflict as a safe conflict", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Agency follow-up opt-in does not match the exact active contact, source, conversation, and recipient" },
    });
    await expect(recordAgencyFollowupOptInEvent(input())).rejects.toMatchObject({
      name: "AgencyFollowupOptInError",
      kind: "conflict",
      message: "Current opt-in evidence conflicts with the prospect context or an existing event.",
    } satisfies Partial<AgencyFollowupOptInError>);
  });
  it("rejects ambiguous source conversation context without appending", async () => {
    h.rows.prospect_conversation_sources.push({ source_link_id: "source", conversation_id: "other" });
    await expect(recordAgencyFollowupOptInEvent(input())).rejects.toThrow("exactly one conversation");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("lists chronologically ordered, allowlisted history without exposing raw recipient email", async () => {
    h.rows.agency_followup_opt_in_events = [
      { id: "event-1", agency_prospect_id: PROSPECT, event_type: "opt_in_granted", captured_at: "2026-10-20T10:00:00Z", recorded_at: "2026-10-20T10:01:00Z",
        capture_source: "subject_email", consent_text_version: "v1", consent_text_sha256: "a".repeat(64),
        evidence_reference: "vault://grant", evidence_sha256: "b".repeat(64), recipient_email_sha256: "c".repeat(64),
        actor_operator_id: ACTOR, recipient_email: EMAIL, private_payload: "must not escape" },
      { id: "event-2", agency_prospect_id: PROSPECT, event_type: "opt_in_withdrawn", captured_at: "2026-10-21T10:00:00Z", recorded_at: "2026-10-21T10:01:00Z",
        capture_source: "subject_email", consent_text_version: "v1", consent_text_sha256: "a".repeat(64),
        evidence_reference: "vault://withdrawal", evidence_sha256: "d".repeat(64), recipient_email_sha256: "c".repeat(64),
        actor_operator_id: ACTOR, recipient_email: EMAIL, private_payload: "must not escape" },
    ];
    const { listAgencyFollowupOptInHistory } = await import("@/lib/agency-followup-opt-in");
    const history = await listAgencyFollowupOptInHistory({ prospectId: PROSPECT, actorOperatorId: ACTOR });
    expect(history.map((event) => event.eventType)).toEqual(["opt_in_granted", "opt_in_withdrawn"]);
    expect(Object.keys(history[0]).sort()).toEqual([
      "actorOperatorId", "capturedAt", "captureSource", "consentTextSha256", "consentTextVersion", "eventId",
      "eventType", "evidenceReference", "evidenceSha256", "recordedAt", "recipientEmailSha256",
    ].sort());
    expect(JSON.stringify(history)).not.toContain(EMAIL);
    expect(JSON.stringify(history)).not.toContain("must not escape");
    expect(h.selects).toContainEqual({
      table: "agency_followup_opt_in_events",
      columns: "id,event_type,captured_at,recorded_at,capture_source,consent_text_version,consent_text_sha256,evidence_reference,evidence_sha256,recipient_email_sha256,actor_operator_id",
    });
    expect(h.selects.filter((selection) => selection.table === "firm_lawyers")).toEqual([
      { table: "firm_lawyers", columns: "id,role,disabled" },
    ]);
    expect(h.orders).toContainEqual({ table: "agency_followup_opt_in_events", column: "recorded_at", ascending: true });
    expect(h.orders).toContainEqual({ table: "agency_followup_opt_in_events", column: "id", ascending: true });
  });

  it("requires an active operator to read consent history", async () => {
    h.rows.firm_lawyers[0].disabled = true;
    const { listAgencyFollowupOptInHistory } = await import("@/lib/agency-followup-opt-in");
    await expect(listAgencyFollowupOptInHistory({ prospectId: PROSPECT, actorOperatorId: ACTOR })).rejects.toThrow("Only an active operator");
    expect(h.calls).not.toContain("agency_followup_opt_in_events");
  });
});
