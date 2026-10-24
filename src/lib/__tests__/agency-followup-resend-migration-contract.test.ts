import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20261020025251_agency_followup_resend_events_and_shared_suppression.sql";
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations", migrationName), "utf8");
const rowLockMigrationName = "20261020141945_agency_followup_provider_event_row_lock_privilege.sql";
const rowLockMigration = readFileSync(resolve(process.cwd(), "supabase/migrations", rowLockMigrationName), "utf8");
const providerEventPrivilegeMigrationName = "20261022222611_agency_followup_provider_event_least_privilege.sql";
const providerEventPrivilegeMigration = readFileSync(resolve(process.cwd(), "supabase/migrations", providerEventPrivilegeMigrationName), "utf8");
const testClaimMigrationName = "20261021173939_agency_followup_test_message_claim.sql";
const testClaimMigration = readFileSync(resolve(process.cwd(), "supabase/migrations", testClaimMigrationName), "utf8");
const liveClaimMigrationName = "20261023185535_agency_followup_live_message_claim.sql";
const liveClaimMigration = readFileSync(resolve(process.cwd(), "supabase/migrations", liveClaimMigrationName), "utf8");
const replayGuardMigrationName = "20261022172352_agency_followup_webhook_replay_quarantine_guard.sql";
const replayGuardMigration = readFileSync(resolve(process.cwd(), "supabase/migrations", replayGuardMigrationName), "utf8");
const idempotencyFenceMigrationName = "20261023185615_agency_followup_provider_idempotency_fence.sql";
const idempotencyFenceMigration = readFileSync(resolve(process.cwd(), "supabase/migrations", idempotencyFenceMigrationName), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/lib/agency-followup-service.ts"), "utf8");
const suppressionMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261024054520_agency_followup_resend_suppressed_status.sql"), "utf8");

describe("Agency follow-up Resend migration contract", () => {
  it("keeps webhook evidence append-only, minimized, private, and replay-safe", () => {
    expect(migration).toContain("CREATE TABLE public.agency_followup_provider_events");
    expect(migration).toContain("provider_event_id text PRIMARY KEY");
    expect(migration).toContain("agency_followup_messages_provider_message_recipient_unique");
    expect(migration).toContain("GROUP BY provider_message_id, provider_recipient_email_sha256");
    expect(migration).not.toContain("agency_followup_messages_provider_message_id_unique");
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

  it("grants only the provider event key update privilege required for row locking", () => {
    expect(rowLockMigration).toContain("GRANT UPDATE (provider_event_id) ON public.agency_followup_provider_events TO service_role");
    expect(rowLockMigration).not.toMatch(/GRANT\s+UPDATE\s+ON\s+public\.agency_followup_provider_events/i);
    expect(providerEventPrivilegeMigration).toContain("REVOKE ALL PRIVILEGES ON TABLE public.agency_followup_provider_events FROM service_role");
    expect(providerEventPrivilegeMigration).toContain("GRANT SELECT, INSERT ON TABLE public.agency_followup_provider_events TO service_role");
    expect(providerEventPrivilegeMigration).toContain("GRANT UPDATE (provider_event_id) ON TABLE public.agency_followup_provider_events TO service_role");
    expect(providerEventPrivilegeMigration).not.toContain("GRANT UPDATE ON TABLE public.agency_followup_provider_events TO service_role");
    expect(providerEventPrivilegeMigration).not.toContain("GRANT ALL ON TABLE public.agency_followup_provider_events TO service_role");
    expect(migration).toContain("CREATE TRIGGER agency_followup_provider_events_no_mutation");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON public.agency_followup_provider_events");
    expect(migration).toContain("SECURITY INVOKER");
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
    expect(migration).toContain("AND message.provider_recipient_email_sha256 = p_recipient_sha256");
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
    expect(migration).toMatch(/WHEN 'failed' THEN 2\s+WHEN 'delivered' THEN 3/);
  });

  it("keeps first-result source and recipient quarantines closed to replay rematching", () => {
    expect(replayGuardMigration).toContain("IF v_existing_event.processing_result IS DISTINCT FROM 'unmatched_message' THEN");
    expect(replayGuardMigration).toContain("RETURN jsonb_build_object('result', 'duplicate');");
    expect(replayGuardMigration).toContain("REVOKE ALL ON FUNCTION public.persist_agency_followup_resend_event");
    expect(replayGuardMigration).toContain("GRANT EXECUTE ON FUNCTION public.persist_agency_followup_resend_event");
    expect(replayGuardMigration).toContain("TO service_role");
  });

  it("records Resend suppression as a durable shared stop and preserves replay quarantine", () => {
    expect(suppressionMigration).toContain("'email.suppressed'");
    expect(suppressionMigration).toContain("'resend_email_suppressed'");
    expect(suppressionMigration).toContain("'provider_suppressed'");
    expect(suppressionMigration).toContain("pg_catalog.pg_constraint");
    expect(suppressionMigration).toContain("pg_catalog.pg_get_constraintdef");
    expect(suppressionMigration).toContain("DROP CONSTRAINT %I");
    expect(suppressionMigration).toContain("ADD CONSTRAINT prospect_provider_suppression_reason_check");
    expect(suppressionMigration).toMatch(/WHEN 'email\.suppressed' THEN 'suppressed'/);
    expect(suppressionMigration).toMatch(/WHEN 'suppressed' THEN 7 ELSE 0 END/);
    expect(suppressionMigration).toContain("p_event_type IN ('email.bounced', 'email.complained', 'email.unsubscribed', 'email.suppressed', 'contact.updated')");
    expect(suppressionMigration).toContain("IF v_existing_event.processing_result IS DISTINCT FROM 'unmatched_message' THEN");
    expect(suppressionMigration).toContain("RETURN jsonb_build_object('result', 'duplicate');");
  });

  it("claims only the exact allowlisted enrollment/message pairs in test mode", () => {
    expect(testClaimMigration).toContain("CREATE OR REPLACE FUNCTION public.claim_agency_followup_test_messages(");
    expect(testClaimMigration).toContain("message.id::text = allowed.target ->> 'messageId'");
    expect(testClaimMigration).toContain("message.enrollment_id::text = allowed.target ->> 'enrollmentId'");
    expect(testClaimMigration).toContain("message.recipient_email_snapshot = allowed.target ->> 'recipientEmail'");
    expect(testClaimMigration).toContain("message.state = 'scheduled' AND message.scheduled_at <= p_now");
    expect(testClaimMigration).toContain("public.agency_followup_messages.recipient_email_snapshot = allowed.target ->> 'recipientEmail'");
    expect(testClaimMigration).toContain("public.agency_followup_messages.id::text = allowed.target ->> 'messageId'");
    expect(testClaimMigration).toContain("FOR UPDATE OF message SKIP LOCKED");
    expect(testClaimMigration).toContain("REVOKE ALL ON FUNCTION public.claim_agency_followup_test_messages");
    expect(testClaimMigration).toContain("GRANT EXECUTE ON FUNCTION public.claim_agency_followup_test_messages");
    expect(testClaimMigration).toContain("TO service_role");
    expect(service).toContain('supabase.rpc("claim_agency_followup_test_messages"');
    expect(service).toContain("p_allowed_targets: input.claimPolicy.targets");
    expect(service).toContain('supabase.rpc("claim_agency_followup_messages", claimParameters)');
  });

  it("claims and quarantines only allowlisted enrollments in live mode", () => {
    expect(liveClaimMigration).toContain("CREATE OR REPLACE FUNCTION public.claim_agency_followup_live_messages(");
    expect(liveClaimMigration).toContain("p_allowed_enrollment_ids uuid[]");
    expect(liveClaimMigration).toContain("p_limit IS DISTINCT FROM 1");
    expect(liveClaimMigration).toContain("message.enrollment_id = ANY(p_allowed_enrollment_ids)");
    expect(liveClaimMigration).toContain("AND enrollment_id = ANY(p_allowed_enrollment_ids)");
    expect(liveClaimMigration).toContain("message.state = 'scheduled' AND message.scheduled_at <= p_now");
    expect(liveClaimMigration).toContain("FOR UPDATE OF message SKIP LOCKED");
    expect(liveClaimMigration).toContain("SECURITY INVOKER");
    expect(liveClaimMigration).toContain("REVOKE ALL ON FUNCTION public.claim_agency_followup_live_messages");
    expect(liveClaimMigration).toContain("GRANT EXECUTE ON FUNCTION public.claim_agency_followup_live_messages");
    expect(liveClaimMigration).toContain("TO service_role");
    expect(service).toContain('supabase.rpc("claim_agency_followup_live_messages"');
    expect(service).toContain("p_allowed_enrollment_ids: input.claimPolicy.enrollmentIds");
    expect(service).toContain('mode: "unrestricted"');
  });

  it("persists the first Resend key-use time and quarantines retries before the 24-hour provider expiry", () => {
    expect(idempotencyFenceMigration).toContain("ADD COLUMN provider_idempotency_first_used_at timestamptz NULL");
    expect(idempotencyFenceMigration).toContain("min(event.occurred_at)");
    expect(idempotencyFenceMigration).toContain("'resend_concurrent_idempotent_requests'");
    expect(idempotencyFenceMigration).toContain("'resend_rate_limit_exceeded'");
    expect(idempotencyFenceMigration).toContain("provider_idempotency_first_used_at IS DISTINCT FROM OLD.provider_idempotency_first_used_at");
    expect(idempotencyFenceMigration).toContain("BEFORE INSERT OR UPDATE OF provider_idempotency_first_used_at");
    expect(idempotencyFenceMigration).toContain("NEW.provider_idempotency_first_used_at := LEAST(");
    expect(idempotencyFenceMigration).toContain("CREATE OR REPLACE FUNCTION public.prepare_agency_followup_provider_attempt(");
    expect(idempotencyFenceMigration).toContain("message.lease_owner = btrim(p_lease_owner)");
    expect(idempotencyFenceMigration).toContain("message.attempt_count = p_attempt_count");
    expect(idempotencyFenceMigration).toContain("message.lease_until > v_now");
    expect(idempotencyFenceMigration).toContain("v_now timestamptz := clock_timestamp()");
    expect(idempotencyFenceMigration).toContain("p_max_idempotency_age_seconds NOT BETWEEN 3600 AND 82800");
    expect(idempotencyFenceMigration).toContain("RETURN 'stale'");
    expect(idempotencyFenceMigration).toContain("RETURN 'expired'");
    expect(idempotencyFenceMigration).toContain("'resend_idempotency_window_expired'");
    expect(idempotencyFenceMigration).toContain("'provider_unknown'");
    expect(idempotencyFenceMigration).toContain("REVOKE ALL ON FUNCTION public.prepare_agency_followup_provider_attempt");
    expect(idempotencyFenceMigration).toContain("GRANT EXECUTE ON FUNCTION public.prepare_agency_followup_provider_attempt");
    expect(idempotencyFenceMigration).toContain("TO service_role");
    expect(idempotencyFenceMigration).not.toContain("SECURITY DEFINER");
  });
});
