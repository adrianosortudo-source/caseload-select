import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const id = "11111111-1111-4111-8111-111111111111";
  const rows: Record<string, Record<string, unknown>[]> = {
    prospect_source_links: [{ id: "agency-link", source_system: "agency_crm", source_record_key: id, organization_id: "org", person_id: "person", history_coverage: "complete" }],
    prospect_conversation_sources: [{ source_link_id: "agency-link", conversation_id: "conversation" }],
    prospect_conversations: [{ id: "conversation", organization_id: "org", person_id: "person", status: "not_contacted" }],
    prospect_organizations: [{ id: "org", display_name: "Synthetic Firm" }],
    prospect_people: [{ id: "person", display_name: "Synthetic Contact", primary_email: "person@example.test" }],
    prospect_contactability: [{ conversation_id: "conversation", state: "unknown", reason: null }],
    prospect_activities: [
      { id: "agency-event", source_link_id: "agency-link", conversation_id: "conversation", body: "Synthetic CRM note" },
      { id: "external-event", source_link_id: "external-link", conversation_id: "conversation", body: "Excluded other source" },
    ],
  };
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const found = () => (rows[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value));
    const q = {
      select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      order: () => q, range: (start: number, end: number) => Promise.resolve({ data: found().slice(start, end + 1), error: null }),
      maybeSingle: () => Promise.resolve({ data: found()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: found()[0] ?? null, error: null }),
    };
    return q;
  };
  return { id, from };
});
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { from: fixture.from } }));
import { getAgencyProspectConversation } from "../prospect-operations";

describe("CRM agent source history isolation", () => {
  it("excludes another source's activity even when it shares the same conversation", async () => {
    const agent = await getAgencyProspectConversation(fixture.id, { sourceOnly: true });
    expect(agent?.activities.map(item => item.id)).toEqual(["agency-event"]);
    expect(JSON.stringify(agent)).not.toContain("Excluded other source");
  });
  it("preserves existing human operator history behavior", async () => {
    const human = await getAgencyProspectConversation(fixture.id);
    expect(human?.activities.map(item => item.id)).toEqual(["agency-event", "external-event"]);
  });
});
