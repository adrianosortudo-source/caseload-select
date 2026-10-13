import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20261013154000_agency_followup_journeys.sql";
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations", migrationName), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/lib/agency-followup-service.ts"), "utf8");
const route = readFileSync(resolve(process.cwd(), "src/app/api/admin/agency-crm/follow-up/route.ts"), "utf8");

describe("Agency follow-up additive migration and service contract", () => {
  it("uses a versioned journey model tied to current agency prospects and approved template snapshots", () => {
    expect(migrationName).toMatch(/^20261013154000_/);
    for (const table of ["agency_followup_journeys", "agency_followup_template_versions", "agency_followup_steps", "agency_followup_enrollments", "agency_followup_messages", "agency_followup_events"]) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
    }
    expect(migration).toContain("REFERENCES public.agency_prospects(id)");
    expect(migration).toContain("content_snapshot jsonb NOT NULL");
    expect(migration).toContain("eligibility_evidence_ref text NULL");
    expect(migration).toContain("released_by_operator_id uuid NULL");
    expect(migration).toContain("recipient_sha256 text NOT NULL");
  });

  it("requires approved reviewer identity and timestamp, and invalidates stale message approvals", () => {
    expect(migration).toContain("reviewed_by_operator_id uuid NULL REFERENCES public.firm_lawyers(id)");
    expect(migration).toContain("reviewed_at timestamptz NULL");
    expect(migration).toContain("reviewed_by_operator_id IS NOT NULL AND reviewed_at IS NOT NULL");
    expect(migration).toContain("invalidate_agency_followup_message_approval");
    expect(migration).toContain("approved_content_sha256 = content_sha256 AND approved_recipient_sha256 = recipient_sha256");
    expect(service).toContain("reviewerId: String(message.reviewed_by_operator_id)");
    expect(service).toContain("reviewedAt: String(message.reviewed_at)");
    expect(route).toContain("actorId: auth.actorId");
  });

  it("claims with SKIP LOCKED and quarantines expired claims as unknown", () => {
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(migration).toContain("SET state = 'unknown', unknown_since = p_now");
    expect(migration).toContain("provider acceptance may have occurred before a worker stopped responding");
    expect(migration).toContain("state = 'scheduled' AND scheduled_at <= p_now");
  });

  it("keeps these tables service-role only and uses the existing shared conversation history", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.agency_followup_messages FROM anon, authenticated, PUBLIC");
    expect(migration).toContain("GRANT ALL ON public.agency_followup_messages TO service_role");
    expect(service).toContain('.from("prospect_source_links")');
    expect(service).toContain('.from("prospect_conversation_sources")');
    expect(service).toContain('.from("prospect_conversations")');
    expect(service).toContain('.from("prospect_contactability")');
    expect(service).toContain('.from("prospect_activities")');
    expect(service).not.toContain('from("prospect_operations")');
  });
});
