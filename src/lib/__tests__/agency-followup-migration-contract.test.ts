import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20261013173327_agency_followup_journeys.sql";
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations", migrationName), "utf8");
const agencyCrmGrants = readFileSync(resolve(process.cwd(), "supabase/migrations", "20261013230354_agency_crm_service_role_grants.sql"), "utf8");
const agencyCrmSchema = readFileSync(resolve(process.cwd(), "supabase/migrations", "20260625000001_agency_crm.sql"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/lib/agency-followup-service.ts"), "utf8");
const provider = readFileSync(resolve(process.cwd(), "src/lib/agency-followup-resend-provider.ts"), "utf8");
const route = readFileSync(resolve(process.cwd(), "src/app/api/admin/agency-crm/follow-up/route.ts"), "utf8");

describe("Agency follow-up additive migration and service contract", () => {
  it("uses a versioned journey model tied to current agency prospects and approved template snapshots", () => {
    expect(migrationName).toMatch(/^20261013173327_/);
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
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).not.toContain("SECURITY DEFINER");
    expect(migration).toContain("lease-expired:' || expired.id::text");
    expect(provider).toContain("CreateEmailRequestOptions = { idempotencyKey: request.idempotencyKey }");
    expect(service).toContain('rpc("claim_agency_followup_messages"');
    expect(service).toContain("new FakeAgencyFollowupProvider()");
  });

  it("keeps template versions reusable and journey configuration versioned and immutable", () => {
    expect(migration).toContain("UNIQUE (template_key, version)");
    expect(migration).not.toContain("journey_id uuid NOT NULL REFERENCES public.agency_followup_journeys(id) ON DELETE RESTRICT,\r\n  template_key");
    expect(migration).toContain("agency_followup_journeys_one_active_idx");
    expect(migration).toContain("agency_followup_steps_immutable");
    expect(migration).toContain("agency_followup_journeys_version_immutable");
    expect(migration).toContain("activate_agency_followup_journey");
    expect(service).toContain("createAgencyFollowupTemplateVersion");
    expect(service).toContain("createAgencyFollowupJourneyVersion");
    expect(service).toContain('state: "scheduled"');
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

  it("grants the Agency CRM service client access while keeping public roles revoked", () => {
    for (const table of ["agency_prospects", "agency_deals", "agency_reminders"]) {
      expect(agencyCrmSchema).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(agencyCrmSchema).toContain(`ALTER TABLE public.${table} FORCE  ROW LEVEL SECURITY`);
      expect(agencyCrmGrants).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated, PUBLIC`);
      expect(agencyCrmGrants).toContain(`GRANT ALL ON TABLE public.${table} TO service_role`);
    }
    expect(agencyCrmGrants).not.toMatch(/DISABLE\s+ROW LEVEL SECURITY/i);
  });
});
