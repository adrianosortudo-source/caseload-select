import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { message: string } | null };
type Call = { table: string; in: Array<[string, unknown]>; eq: Array<[string, unknown]>; range?: [number, number] };

const h = vi.hoisted(() => {
  const calls: Call[] = [];
  const rows: Record<string, unknown[]> = {};
  const supabaseAdmin = {
    from: (table: string) => {
      const call: Call = { table, in: [], eq: [] };
      calls.push(call);
      const query: Record<string, unknown> = {};
      Object.assign(query, {
        select: () => query,
        in: (column: string, value: unknown) => { call.in.push([column, value]); return query; },
        eq: (column: string, value: unknown) => { call.eq.push([column, value]); return query; },
        range: (from: number, to: number) => { call.range = [from, to]; return query; },
        order: () => query,
        limit: () => query,
        then: (resolve: (result: Result) => unknown, reject?: (error: unknown) => unknown) => {
          const allRows = rows[table] ?? [];
          const data = call.range ? allRows.slice(call.range[0], call.range[1] + 1) : allRows;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      });
      return query;
    },
  };
  return { calls, rows, supabaseAdmin };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: h.supabaseAdmin }));

import { listAgencyFollowupConsole } from "@/lib/agency-followup-service";

const P1 = "prospect-1";
const P2 = "prospect-2";
const P3 = "prospect-3";
const CONV1 = "conversation-1";
const CONV3 = "conversation-3";

function setRows() {
  h.rows.agency_followup_journeys = [{
    id: "journey-1", name: "Journey", journey_key: "journey", version: 1, state: "draft", timezone: "America/Toronto",
    business_days: [1, 2, 3, 4, 5], local_window_start: "09:00", local_window_end: "17:00", minimum_spacing_hours: 24,
  }];
  h.rows.agency_followup_enrollments = [P1, P2, P3].map((prospectId, index) => ({
    id: `enrollment-${index + 1}`, prospect_id: prospectId, journey_id: "journey-1", eligibility_state: "pending",
    eligibility_evidence_ref: null, released_at: null, state: "draft",
  }));
  h.rows.agency_followup_template_versions = [];
  h.rows.agency_followup_steps = [];
  h.rows.agency_followup_messages = [P1, P2, P3].map((_, index) => ({
    id: `message-${index + 1}`, enrollment_id: `enrollment-${index + 1}`, step_number: 1, state: "draft",
    content_snapshot: { subject: "Subject", body: "Body" }, scheduled_at: null,
  }));
  h.rows.agency_prospects = [P1, P2, P3].map((id) => ({ id, firm_name: id, contact_email: `${id}@example.test`, stage: "new" }));
  h.rows.prospect_source_links = [
    { id: "source-1", source_record_key: P1 },
    { id: "source-3", source_record_key: P3 },
  ];
  h.rows.prospect_conversation_sources = [
    { source_link_id: "source-1", conversation_id: CONV1 },
    { source_link_id: "source-3", conversation_id: CONV3 },
  ];
  h.rows.prospect_conversations = [{ id: CONV1, status: "awaiting_reply" }, { id: CONV3, status: "completed" }];
  h.rows.prospect_contactability = [{ conversation_id: CONV1, state: "eligible" }, { conversation_id: CONV3, state: "eligible" }];
  h.rows.prospect_activities = [
    { conversation_id: CONV3, kind: "meeting" },
    { conversation_id: CONV3, kind: "bounce" },
    { conversation_id: CONV3, kind: "human_reply" },
  ];
  h.rows.prospect_contactability_provider_suppressions = [{ conversation_id: CONV3 }];
}

beforeEach(() => {
  h.calls.length = 0;
  for (const key of Object.keys(h.rows)) delete h.rows[key];
  setRows();
});

describe("listAgencyFollowupConsole operations-state batching", () => {
  it("keeps prospect state isolated and reads each shared operations table once per queue", async () => {
    const result = await listAgencyFollowupConsole();

    expect(result.items.map(({ prospectId, contactability, conversationStatus }) => ({ prospectId, contactability, conversationStatus })))
      .toEqual([
        { prospectId: P1, contactability: "allowed", conversationStatus: "awaiting_reply" },
        { prospectId: P2, contactability: "unknown", conversationStatus: "not_contacted" },
        { prospectId: P3, contactability: "hold", conversationStatus: "replied" },
      ]);
    for (const table of [
      "prospect_source_links", "prospect_conversation_sources", "prospect_conversations", "prospect_contactability",
      "prospect_activities", "prospect_contactability_provider_suppressions",
    ]) expect(h.calls.filter((call) => call.table === table)).toHaveLength(1);
    const sourceCall = h.calls.find((call) => call.table === "prospect_source_links")!;
    expect(sourceCall.in).toContainEqual(["source_system", ["agency_crm", "agency_crm_contact"]]);
    expect(sourceCall.in).toContainEqual(["source_record_key", [P1, P2, P3]]);
  });

  it("fails closed when any batched operations read fails", async () => {
    const originalFrom = h.supabaseAdmin.from;
    h.supabaseAdmin.from = ((table: string) => {
      const query = originalFrom(table) as Record<string, unknown>;
      if (table === "prospect_contactability") {
        query.then = (resolve: (result: Result) => unknown) => Promise.resolve({ data: null, error: { message: "read denied" } }).then(resolve);
      }
      return query;
    }) as typeof h.supabaseAdmin.from;
    try {
      await expect(listAgencyFollowupConsole()).rejects.toThrow("Unable to read prospect contactability: read denied");
    } finally {
      h.supabaseAdmin.from = originalFrom;
    }
  });

  it("paginates operation histories beyond the PostgREST page size", async () => {
    h.rows.prospect_source_links = Array.from({ length: 1001 }, (_, index) => ({ id: `source-${index}`, source_record_key: P1 }));
    h.rows.prospect_conversation_sources = Array.from({ length: 1001 }, (_, index) => ({
      source_link_id: `source-${index}`, conversation_id: `conversation-${index}`,
    }));
    h.rows.prospect_conversations = Array.from({ length: 1001 }, (_, index) => ({ id: `conversation-${index}`, status: "awaiting_reply" }));
    h.rows.prospect_contactability = Array.from({ length: 1001 }, (_, index) => ({ conversation_id: `conversation-${index}`, state: "eligible" }));
    h.rows.prospect_activities = [];
    h.rows.prospect_contactability_provider_suppressions = [];
    const result = await listAgencyFollowupConsole();

    expect(result.items[0].contactability).toBe("allowed");
    for (const table of ["prospect_source_links", "prospect_conversation_sources", "prospect_conversations", "prospect_contactability"])
      expect(h.calls.filter((call) => call.table === table)).toHaveLength(2);
    expect(h.calls.filter((call) => call.table === "prospect_source_links").map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
  });
});
