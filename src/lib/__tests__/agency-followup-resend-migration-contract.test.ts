import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20261020025251_agency_followup_resend_events_and_shared_suppression.sql";
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations", migrationName), "utf8");

describe("Agency follow-up Resend migration contract", () => {
  it("keeps webhook evidence append-only, minimized, private, and replay-safe", () => {
    expect(migration).toContain("CREATE TABLE public.agency_followup_provider_events");
    expect(migration).toContain("provider_event_id text PRIMARY KEY");
    expect(migration).toContain("provider events are append-only");
    expect(migration).toContain("ON CONFLICT (provider_event_id) DO NOTHING");
    expect(migration).toContain("CREATE TABLE public.agency_followup_provider_event_applications");
    expect(migration).toContain("authoritative resolved message/source binding");
    expect(migration).toContain("Immutable result of first receipt");
    expect(migration).toContain("allow an identical signed retry to rematch");
    expect(migration).toContain("provider event id was replayed with different content");
    expect(migration).toContain("agency_followup_provider_event_applications AS application");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("GRANT SELECT, INSERT ON public.agency_followup_provider_events TO service_role");
    expect(migration).not.toMatch(/raw_payload|webhook_body|recipient_email text NULL/i);
  });

  it("maps recipient status only through an accepted message and exact Agency source binding", () => {
    expect(migration).toContain("message.state = 'accepted'");
    expect(migration).toContain("lower(btrim(message.recipient_email_snapshot)) = lower(btrim(p_recipient_email))");
    expect(migration).toContain("lower(btrim(prospect.contact_email)) = lower(btrim(p_recipient_email))");
    expect(migration).toContain("source_link.source_record_key = v_prospect_id::text");
    expect(migration).toContain("ambiguous_source");
    expect(migration).toContain("contact.updated");
    expect(migration).toContain("suppressed_by_provider_event_id");
    expect(migration).toContain("FOREIGN KEY (conversation_id, source_link_id)");
    expect(migration).toContain("OR p_recipient_sha256 IS NULL");
    expect(migration).toContain("message.provider_recipient_email_sha256 = p_recipient_sha256");
  });

  it("persists worker disposition and audit event in one lease-guarded RPC", () => {
    expect(migration).toContain("persist_agency_followup_disposition(");
    expect(migration).toContain("message.state = 'claimed'");
    expect(migration).toContain("message.lease_owner = btrim(p_lease_owner)");
    expect(migration).toContain("message.attempt_count = p_attempt_count");
    expect(migration).toContain("worker:' || p_message_id::text || ':' || p_attempt_count::text || ':' || v_event_type");
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.persist_agency_followup_disposition");
    expect(migration).toContain("'send_mode_off'");
    expect(migration).toContain("'test_enrollment_message_recipient_not_allowlisted'");
  });

  it("does not let a late provider failure roll a delivered message backward", () => {
    expect(migration).toContain("WHEN 'failed' THEN 2\n          WHEN 'delivered' THEN 3");
  });
});
