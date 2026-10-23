import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { message: string } | null };
type Call = { table: string; in: Array<[string, unknown]>; eq: Array<[string, unknown]>; orders: Array<[string, boolean]>; range?: [number, number] };
type RpcCall = { name: string; args: Record<string, unknown> };

const h = vi.hoisted(() => {
  const calls: Call[] = [];
  const rpcCalls: RpcCall[] = [];
  const rows: Record<string, unknown[]> = {};
  let rpcError: { message: string } | null = null;
  const supabaseAdmin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: [], error: rpcError };
    },
    from: (table: string) => {
      const call: Call = { table, in: [], eq: [], orders: [] };
      calls.push(call);
      const query: Record<string, unknown> = {};
      Object.assign(query, {
        select: () => query,
        in: (column: string, value: unknown) => { call.in.push([column, value]); return query; },
        eq: (column: string, value: unknown) => { call.eq.push([column, value]); return query; },
        range: (from: number, to: number) => { call.range = [from, to]; return query; },
        order: (column: string, options?: { ascending?: boolean }) => { call.orders.push([column, options?.ascending !== false]); return query; },
        limit: () => query,
        then: (resolve: (result: Result) => unknown, reject?: (error: unknown) => unknown) => {
          let allRows = (rows[table] ?? []).filter((row) =>
            call.eq.every(([column, value]) => (row as Record<string, unknown>)[column] === value) &&
            call.in.every(([column, values]) => Array.isArray(values) && values.includes((row as Record<string, unknown>)[column])));
          for (const [column, ascending] of [...call.orders].reverse()) {
            allRows = [...allRows].sort((left, right) => {
              const a = String((left as Record<string, unknown>)[column] ?? "");
              const b = String((right as Record<string, unknown>)[column] ?? "");
              return (a < b ? -1 : a > b ? 1 : 0) * (ascending ? 1 : -1);
            });
          }
          const data = call.range ? allRows.slice(call.range[0], call.range[1] + 1) : allRows;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      });
      return query;
    },
  };
  return { calls, rpcCalls, rows, supabaseAdmin, setRpcError: (error: { message: string } | null) => { rpcError = error; } };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: h.supabaseAdmin }));

import {
  approveAgencyFollowupTemplateVersion,
  listAgencyFollowupConsole,
  runFakeAgencyFollowupDispatcher,
  runAgencyFollowupDispatcher,
} from "@/lib/agency-followup-service";
import { agencyFollowupRecipientEmailHash } from "@/lib/agency-followup-domain";

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
    provider_delivery_status: ["delivered", "accepted", "unknown"][index],
    provider_delivery_status_at: index === 0 ? "2026-10-20T12:00:00.000Z" : null,
    content_snapshot: { subject: "Subject", body: "Body" }, scheduled_at: null,
  }));
  h.rows.agency_prospects = [P1, P2, P3].map((id) => ({ id, firm_name: id, contact_email: `${id}@example.test`, stage: "new" }));
  h.rows.prospect_source_links = [
    { id: "source-1", source_record_key: P1, source_system: "agency_crm", active: true, organization_id: "org-1", person_id: "person-1" },
    { id: "source-3", source_record_key: P3, source_system: "agency_crm_contact", active: true, organization_id: "org-3", person_id: "person-3" },
  ];
  h.rows.prospect_conversation_sources = [
    { source_link_id: "source-1", conversation_id: CONV1 },
    { source_link_id: "source-3", conversation_id: CONV3 },
  ];
  h.rows.prospect_conversations = [
    { id: CONV1, status: "awaiting_reply", organization_id: "org-1", person_id: "person-1" },
    { id: CONV3, status: "completed", organization_id: "org-3", person_id: "person-3" },
  ];
  h.rows.prospect_people = [
    { id: "person-1", primary_email: `${P1}@example.test` },
    { id: "person-3", primary_email: `${P3}@example.test` },
  ];
  h.rows.prospect_person_firm_roles = [
    { organization_id: "org-1", person_id: "person-1", active: true },
    { organization_id: "org-3", person_id: "person-3", active: true },
  ];
  h.rows.agency_followup_opt_in_events = [
    { id: "opt-1", agency_prospect_id: P1, source_link_id: "source-1", conversation_id: CONV1,
      recipient_email_sha256: agencyFollowupRecipientEmailHash(`${P1}@example.test`), purpose: "agency_followup_email",
      event_type: "opt_in_granted", recorded_at: "2026-10-20T10:00:00.000Z" },
    { id: "opt-3", agency_prospect_id: P3, source_link_id: "source-3", conversation_id: CONV3,
      recipient_email_sha256: agencyFollowupRecipientEmailHash(`${P3}@example.test`), purpose: "agency_followup_email", event_type: "opt_in_withdrawn", recorded_at: "2026-10-20T11:00:00.000Z" },
  ];
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
  h.rpcCalls.length = 0;
  h.setRpcError(null);
  for (const key of Object.keys(h.rows)) delete h.rows[key];
  setRows();
});

describe("approveAgencyFollowupTemplateVersion", () => {
  it("uses one RPC for the approval row transition and its audit event", async () => {
    await approveAgencyFollowupTemplateVersion({ templateVersionId: "template-1", actorId: "operator-1" });

    expect(h.calls).toEqual([]);
    expect(h.rpcCalls).toEqual([{
      name: "approve_agency_followup_template_version",
      args: { p_template_version_id: "template-1", p_actor_operator_id: "operator-1" },
    }]);
  });

  it("surfaces an atomic approval RPC failure", async () => {
    h.setRpcError({ message: "only a draft agency follow-up template version can be approved" });

    await expect(approveAgencyFollowupTemplateVersion({ templateVersionId: "template-1", actorId: "operator-1" }))
      .rejects.toThrow("Unable to approve template version: only a draft agency follow-up template version can be approved");
    expect(h.calls).toEqual([]);
    expect(h.rpcCalls).toHaveLength(1);
  });
});

describe("runAgencyFollowupDispatcher test-mode claim scope", () => {
  it("uses an atomic claim restricted to the exact configured test message", async () => {
    const keys = [
      "AGENCY_FOLLOWUP_SEND_MODE",
      "AGENCY_FOLLOWUP_FROM",
      "AGENCY_FOLLOWUP_REPLY_TO",
      "RESEND_API_KEY",
      "AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET",
      "AGENCY_FOLLOWUP_TEST_RECIPIENT_ALLOWLIST",
      "AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST",
    ];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      AGENCY_FOLLOWUP_SEND_MODE: "test",
      AGENCY_FOLLOWUP_FROM: "CaseLoad Select <noreply@caseloadselect.ca>",
      AGENCY_FOLLOWUP_REPLY_TO: "support@caseloadselect.ca",
      RESEND_API_KEY: "synthetic-api-key",
      AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET: "synthetic-webhook-secret",
      AGENCY_FOLLOWUP_TEST_RECIPIENT_ALLOWLIST: "owner@example.test",
      AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST: JSON.stringify([
        { enrollmentId: "enrollment-allowed", messageId: "message-allowed", recipientEmail: "owner@example.test" },
      ]),
    });
    try {
      const result = await runAgencyFollowupDispatcher({ workerId: "test-allowlisted-claim" });
      expect(result.claimed).toBe(0);
      expect(h.rpcCalls).toEqual([{
        name: "claim_agency_followup_test_messages",
        args: expect.objectContaining({
          p_allowed_targets: [{
            enrollmentId: "enrollment-allowed",
            messageId: "message-allowed",
            recipientEmail: "owner@example.test",
          }],
          p_limit: 1,
        }),
      }]);
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });
});

describe("Agency follow-up dispatcher claim policy", () => {
  const liveEnrollmentId = "10000000-0000-4000-8000-000000000001";
  const keys = [
    "AGENCY_FOLLOWUP_SEND_MODE",
    "AGENCY_FOLLOWUP_FROM",
    "AGENCY_FOLLOWUP_REPLY_TO",
    "RESEND_API_KEY",
    "AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET",
    "AGENCY_FOLLOWUP_LIVE_ENROLLMENT_ALLOWLIST",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    Object.assign(process.env, {
      AGENCY_FOLLOWUP_SEND_MODE: "live",
      AGENCY_FOLLOWUP_FROM: "CaseLoad Select <noreply@caseloadselect.ca>",
      AGENCY_FOLLOWUP_REPLY_TO: "support@caseloadselect.ca",
      RESEND_API_KEY: "synthetic-api-key",
      AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET: "synthetic-webhook-secret",
      AGENCY_FOLLOWUP_LIVE_ENROLLMENT_ALLOWLIST: liveEnrollmentId,
    });
  });

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it("uses only the enrollment-filtered RPC in live mode", async () => {
    const result = await runAgencyFollowupDispatcher({ workerId: "live-allowlisted-claim" });
    expect(result.claimed).toBe(0);
    expect(h.rpcCalls).toEqual([{
      name: "claim_agency_followup_live_messages",
      args: expect.objectContaining({
        p_allowed_enrollment_ids: [liveEnrollmentId],
        p_limit: 1,
      }),
    }]);
  });

  it("fails closed before any claim when a live enrollment id is malformed", async () => {
    process.env.AGENCY_FOLLOWUP_LIVE_ENROLLMENT_ALLOWLIST = "not-a-uuid";
    const result = await runAgencyFollowupDispatcher({ workerId: "live-invalid-claim" });
    expect(result.claimed).toBe(0);
    expect(h.rpcCalls).toEqual([]);
  });

  it("keeps synthetic fake dispatch on the unrestricted claim RPC", async () => {
    await runFakeAgencyFollowupDispatcher({ workerId: "synthetic-broad-claim", outcomePlan: [] });
    expect(h.rpcCalls).toEqual([{
      name: "claim_agency_followup_messages",
      args: expect.objectContaining({ p_worker_id: "synthetic-broad-claim" }),
    }]);
  });
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
    expect(result.items.map(({ providerDeliveryStatus, providerDeliveryStatusAt }) => ({ providerDeliveryStatus, providerDeliveryStatusAt })))
      .toEqual([
        { providerDeliveryStatus: "delivered", providerDeliveryStatusAt: "2026-10-20T12:00:00.000Z" },
        { providerDeliveryStatus: "accepted", providerDeliveryStatusAt: null },
        { providerDeliveryStatus: "unknown", providerDeliveryStatusAt: null },
      ]);
    expect(result.items.map(({ prospectId, optInState, blockers }) => ({ prospectId, optInState, blockers })))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ prospectId: P1, optInState: "granted" }),
        expect.objectContaining({ prospectId: P2, optInState: "missing", blockers: expect.arrayContaining(["explicit_opt_in_missing"]) }),
        expect.objectContaining({ prospectId: P3, optInState: "withdrawn", blockers: expect.arrayContaining(["explicit_opt_in_withdrawn"]) }),
      ]));
    for (const table of [
      "prospect_source_links", "prospect_conversation_sources", "prospect_conversations", "prospect_contactability",
      "prospect_activities", "prospect_contactability_provider_suppressions", "prospect_people",
      "prospect_person_firm_roles", "agency_followup_opt_in_events",
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

  it("uses the newest event for the exact recipient, source, conversation, and purpose", async () => {
    h.rows.agency_followup_opt_in_events.push({
      id: "opt-1-withdrawn", agency_prospect_id: P1, source_link_id: "source-1", conversation_id: CONV1,
      recipient_email_sha256: agencyFollowupRecipientEmailHash(`${P1}@example.test`), purpose: "agency_followup_email",
      event_type: "opt_in_withdrawn", recorded_at: "2026-10-21T11:00:00.000Z",
    });
    const result = await listAgencyFollowupConsole();
    expect(result.items.find((item) => item.prospectId === P1)).toMatchObject({
      optInState: "withdrawn", blockers: expect.arrayContaining(["explicit_opt_in_withdrawn"]),
    });
  });

  it.each([
    ["missing opt-in history", () => { h.rows.agency_followup_opt_in_events = []; }, "allowed"],
    ["wrong canonical email", () => { (h.rows.prospect_people[0] as Record<string, unknown>).primary_email = "other@example.test"; }, "unknown"],
    ["inactive source link", () => { (h.rows.prospect_source_links[0] as Record<string, unknown>).active = false; }, "unknown"],
    ["ambiguous active source links", () => { h.rows.prospect_source_links.push({
      ...(h.rows.prospect_source_links[0] as Record<string, unknown>), id: "source-1-duplicate",
    }); }, "unknown"],
    ["conversation bound to the wrong person", () => { (h.rows.prospect_conversations[0] as Record<string, unknown>).person_id = "person-other"; }, "unknown"],
  ])("fails closed for %s", async (_label, mutate, expectedContactability) => {
    mutate();
    const result = await listAgencyFollowupConsole();
    const item = result.items.find((row) => row.prospectId === P1)!;
    expect(item.contactability).toBe(expectedContactability);
    expect(item.optInState).toBe("missing");
    if (expectedContactability === "unknown") expect(item.blockers).toContain("contactability_unknown");
    expect(item.blockers).toContain("explicit_opt_in_missing");
  });

  it("fails closed when exact opt-in history cannot be read", async () => {
    const originalFrom = h.supabaseAdmin.from;
    h.supabaseAdmin.from = ((table: string) => {
      const query = originalFrom(table) as Record<string, unknown>;
      if (table === "agency_followup_opt_in_events") {
        query.then = (resolve: (result: Result) => unknown) => Promise.resolve({ data: null, error: { message: "read denied" } }).then(resolve);
      }
      return query;
    }) as typeof h.supabaseAdmin.from;
    try {
      await expect(listAgencyFollowupConsole()).rejects.toThrow("Unable to read exact Agency follow-up opt-in history: read denied");
    } finally {
      h.supabaseAdmin.from = originalFrom;
    }
  });

  it("paginates source history and fails closed when its active source binding is ambiguous", async () => {
    h.rows.prospect_source_links = Array.from({ length: 1001 }, (_, index) => ({ id: `source-${index}`, source_record_key: P1 }));
    h.rows.prospect_source_links = h.rows.prospect_source_links.map((row, index) => ({
      ...row as Record<string, unknown>, source_system: "agency_crm", active: true, organization_id: "org-1", person_id: `person-${index}`,
    }));
    const result = await listAgencyFollowupConsole();

    expect(result.items[0].contactability).toBe("unknown");
    expect(result.items[0].optInState).toBe("missing");
    expect(h.calls.filter((call) => call.table === "prospect_source_links")).toHaveLength(2);
    expect(h.calls.filter((call) => call.table === "prospect_source_links").map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
  });
});
