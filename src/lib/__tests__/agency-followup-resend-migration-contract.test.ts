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
const serializedHandoffGateMigrationName = "20261024171116_agency_followup_serialized_provider_handoff_gate.sql";
const serializedHandoffGateMigration = readFileSync(resolve(process.cwd(), "supabase/migrations", serializedHandoffGateMigrationName), "utf8");
const unknownResendReconciliationMigrationName = "20261024175302_agency_followup_resend_unknown_reconciliation.sql";
const unknownResendReconciliationMigration = readFileSync(resolve(process.cwd(), "supabase/migrations", unknownResendReconciliationMigrationName), "utf8");
const resendWebhookRoute = readFileSync(resolve(process.cwd(), "src/app/api/webhooks/resend/agency-followup/route.ts"), "utf8");
const walkthrough = readFileSync(resolve(process.cwd(), "scripts/agency-followup-walkthrough.ts"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/lib/agency-followup-service.ts"), "utf8");
const suppressionMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261024054520_agency_followup_resend_suppressed_status.sql"), "utf8");
const handoffClockContactMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261024213806_agency_followup_handoff_clock_recheck_and_contact_suppression.sql"), "utf8");
const recipientUnsubscribeGateMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261026124659_agency_followup_ambiguous_recipient_suppression.sql"), "utf8");
const activityLockOrderFixMigrationName = "20261024233611_agency_followup_activity_lock_order_fix.sql";
const activityLockOrderFixMigration = readFileSync(resolve(process.cwd(), "supabase/migrations", activityLockOrderFixMigrationName), "utf8");

describe("Agency follow-up Resend migration contract", () => {
  it("blocks recipient-level unsubscribes when message resolution is unmatched or source mapping fails", () => {
    expect(recipientUnsubscribeGateMigration).toContain("CREATE INDEX agency_followup_provider_recipient_unsubscribe_hash_idx");
    expect(recipientUnsubscribeGateMigration).toContain("event_type='contact.updated' AND contact_status='unsubscribed'");
    expect(recipientUnsubscribeGateMigration).toContain("event_type='email.unsubscribed'");
    expect(recipientUnsubscribeGateMigration).toContain("processing_result IN ('unmatched_message','unmatched_source','ambiguous_source')");
    expect(recipientUnsubscribeGateMigration).toContain("signed_agency_followup_tags_recorded IS TRUE");
    expect(recipientUnsubscribeGateMigration).toContain("message_id IS NOT NULL AND enrollment_id IS NOT NULL");
    expect(recipientUnsubscribeGateMigration).toContain("recipient_unsubscribe_event.recipient_sha256=hash_email_now");
    expect(recipientUnsubscribeGateMigration).not.toContain("recipient_email");
    expect(recipientUnsubscribeGateMigration).toMatch(/v_anchor_count <> 1/);
  });

  it("orders the activity identity lock by its distinct key", () => {
    expect(activityLockOrderFixMigration).toContain("CREATE OR REPLACE FUNCTION public.lock_agency_followup_activity_before_insert()");
    expect(activityLockOrderFixMigration).toMatch(/SELECT DISTINCT prospect\.id AS prospect_id[\s\S]*?ORDER BY prospect\.id\s+LOOP/i);
    expect(activityLockOrderFixMigration).not.toContain("ORDER BY prospect.id,source_link.id");
  });

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

  it("authorizes the final provider handoff from locked current state and closes the legacy bypass", () => {
    expect(serializedHandoffGateMigration).toContain("CREATE OR REPLACE FUNCTION public.authorize_agency_followup_provider_handoff(");
    expect(serializedHandoffGateMigration).toContain("RETURNS jsonb");
    expect(serializedHandoffGateMigration).toContain("SECURITY INVOKER");
    expect(serializedHandoffGateMigration).toContain("SET search_path = ''");
    expect(serializedHandoffGateMigration).toContain("FOR UPDATE");
    expect(serializedHandoffGateMigration).toContain("provider_idempotency_first_used_at");
    expect(serializedHandoffGateMigration).toContain("'explicit_opt_in_withdrawn'");
    expect(serializedHandoffGateMigration).toContain("'contactability_blocked'");
    expect(serializedHandoffGateMigration).toContain("'conversation_stopped'");
    expect(serializedHandoffGateMigration).toContain("'approval_stale_content'");
    expect(serializedHandoffGateMigration).toContain("'approval_stale_recipient'");
    expect(serializedHandoffGateMigration).toContain("'previous_step_pending'");
    expect(serializedHandoffGateMigration).toContain("'previous_step_unresolved'");
    expect(serializedHandoffGateMigration).toContain("'minimum_spacing_not_elapsed'");
    expect(serializedHandoffGateMigration).toContain("'result','ready','request',pg_catalog.jsonb_build_object('idempotencyKey'");
    expect(serializedHandoffGateMigration).toContain("'recipientEmail'");
    expect(serializedHandoffGateMigration).toContain("'subject'");
    expect(serializedHandoffGateMigration).toContain("'body'");
    expect(serializedHandoffGateMigration).toContain("'result','blocked','blockers'");
    expect(serializedHandoffGateMigration).toContain("'result','deferred','blocker'");
    expect(serializedHandoffGateMigration).toContain("'result','blocked','blockers'");
    expect(serializedHandoffGateMigration).toContain("'previous_step_unresolved'");
    expect(serializedHandoffGateMigration).toContain("'previous_step_pending'");
    expect(serializedHandoffGateMigration).toContain("'minimum_spacing_not_elapsed'");
    // A blocked/deferred gate is a pure authorization result. Worker disposition owns all
    // message/event persistence, so neither branch may change the target or write an event.
    const blockedBranch = serializedHandoffGateMigration.match(/IF cardinality\(blockers\)>0 THEN([\s\S]*?)END IF;\s*first_used:=/i)?.[1] ?? "";
    const pendingBranch = serializedHandoffGateMigration.match(/IF prior_pending[\s\S]*?THEN([\s\S]*?)END IF;\s*IF blockers/i)?.[1] ?? "";
    const spacingBranch = serializedHandoffGateMigration.match(/'minimum_spacing_not_elapsed'=ANY\(blockers\) THEN([\s\S]*?)END IF;\s*IF cardinality\(blockers\)>0/i)?.[1] ?? "";
    const notDueBranch = serializedHandoffGateMigration.match(/IF cardinality\(blockers\)=1 AND blockers\[1\]='not_due' THEN([\s\S]*?)END IF;\s*IF cardinality\(blockers\)>0/i)?.[1] ?? "";
    expect(blockedBranch).not.toBe("");
    expect(blockedBranch).not.toMatch(/\b(?:UPDATE|INSERT\s+INTO)\b/i);
    expect(blockedBranch).not.toContain("request");
    expect(blockedBranch).toContain("jsonb_build_object('result','blocked','blockers'");
    expect(pendingBranch).not.toBe("");
    expect(pendingBranch).not.toMatch(/\b(?:UPDATE|INSERT\s+INTO)\b/i);
    expect(pendingBranch).not.toContain("request");
    expect(pendingBranch).toContain("jsonb_build_object('result','deferred','blocker','previous_step_pending'");
    expect(spacingBranch).not.toBe("");
    expect(spacingBranch).not.toMatch(/\b(?:UPDATE|INSERT\s+INTO)\b/i);
    expect(spacingBranch).not.toContain("request");
    expect(spacingBranch).toContain("jsonb_build_object('result','deferred','blocker','minimum_spacing_not_elapsed'");
    expect(notDueBranch).not.toBe("");
    expect(notDueBranch).not.toMatch(/\b(?:UPDATE|INSERT\s+INTO)\b/i);
    expect(notDueBranch).not.toContain("request");
    expect(notDueBranch).toContain("jsonb_build_object('result','deferred','blocker','not_due','retryAt',m.scheduled_at)");
    expect(serializedHandoffGateMigration).toContain("public.lock_agency_followup_identity");
    expect(serializedHandoffGateMigration).toContain("public.lock_agency_followup_opt_in_scope");
    expect(serializedHandoffGateMigration).toContain("public.lock_agency_followup_mapping_catalog");
    expect(serializedHandoffGateMigration).toContain("pg_catalog.hashtextextended('agency-followup-mapping-catalog',0)");
    expect(serializedHandoffGateMigration).toContain("pg_catalog.hashtextextended('agency-followup-identity:'||pid::text,0)");
    expect(serializedHandoffGateMigration).toContain("PERFORM public.lock_agency_followup_identity(pid)");
    expect(serializedHandoffGateMigration).toContain("agency_followup_opt_in_events_00_lock_scope");
    expect(serializedHandoffGateMigration).toContain("prospect_activities_00_lock_agency_identity");
    expect(serializedHandoffGateMigration).toContain("agency_followup_provider_events_00_lock_scope");
    expect(serializedHandoffGateMigration).toContain("agency_prospects_00_lock_agency_identity");
    expect(serializedHandoffGateMigration).toContain("prospect_source_links_00_lock_agency_identity");
    expect(serializedHandoffGateMigration).toContain("prospect_conversation_sources_00_lock_agency_identity");
    expect(serializedHandoffGateMigration).toContain("prospect_contactability_00_lock_agency_identity");
    expect(serializedHandoffGateMigration).toContain("prospect_conversations_00_lock_agency_identity");
    expect(serializedHandoffGateMigration).toContain("prospect_contactability_provider_suppressions_00_lock_agency_identity");
    expect(serializedHandoffGateMigration).toContain("prospect_people_00_lock_agency_identity");
    expect(serializedHandoffGateMigration).toContain("prospect_person_firm_roles_00_lock_agency_identity");
    const statementCatalogTriggers = [
      "agency_prospects_00_lock_agency_catalog",
      "prospect_source_links_00_lock_agency_catalog",
      "prospect_conversation_sources_00_lock_agency_catalog",
      "prospect_contactability_00_lock_agency_catalog",
      "prospect_conversations_00_lock_agency_catalog",
      "prospect_contactability_provider_suppressions_00_lock_agency_catalog",
      "prospect_people_00_lock_agency_catalog",
      "prospect_person_firm_roles_00_lock_agency_catalog",
      "prospect_activities_00_lock_agency_catalog",
      "agency_followup_provider_events_00_lock_agency_catalog",
      "agency_followup_opt_in_events_00_lock_agency_catalog",
    ];
    for (const trigger of statementCatalogTriggers) {
      expect(serializedHandoffGateMigration).toContain(`CREATE TRIGGER ${trigger}`);
    }
    expect(serializedHandoffGateMigration.match(/FOR EACH STATEMENT EXECUTE FUNCTION public\.lock_agency_followup_mapping_catalog_before_statement\(\)/g) ?? []).toHaveLength(11);
    expect(serializedHandoffGateMigration).toContain("FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_prospect_before_write()");
    expect(serializedHandoffGateMigration).toContain("FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_source_link_before_write()");
    expect(serializedHandoffGateMigration).toContain("CREATE OR REPLACE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement()");
    expect(serializedHandoffGateMigration).toContain("PERFORM public.lock_agency_followup_mapping_catalog()");
    const writerLockCalls: Array<[string, string]> = [
      ["lock_agency_followup_opt_in_event_before_insert", "lock_agency_followup_opt_in_scope"],
      ["lock_agency_followup_activity_before_insert", "lock_agency_followup_identity"],
      ["lock_agency_followup_provider_event_before_insert", "lock_agency_followup_identity"],
      ["lock_agency_followup_prospect_before_write", "lock_agency_followup_identity_set"],
      ["lock_agency_followup_source_link_before_write", "lock_agency_followup_identity_set"],
      ["lock_agency_followup_conversation_source_before_write", "lock_agency_followup_identity_set"],
      ["lock_agency_followup_contactability_before_write", "lock_agency_followup_identity_set"],
      ["lock_agency_followup_conversation_before_write", "lock_agency_followup_identity_set"],
      ["lock_agency_followup_suppression_before_insert", "lock_agency_followup_identity_set"],
      ["lock_agency_followup_person_before_write", "lock_agency_followup_identity_set"],
      ["lock_agency_followup_person_role_before_write", "lock_agency_followup_identity_set"],
    ];
    for (const [writer, lockFunction] of writerLockCalls) {
      const body = serializedHandoffGateMigration.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${writer}\\([\\s\\S]*?END \\$\\$;`, "i"))?.[0] ?? "";
      expect(body, `${writer} must use the shared identity lock`).toContain(`public.${lockFunction}`);
      if (writer === "lock_agency_followup_opt_in_event_before_insert") {
        const delegatedScope = serializedHandoffGateMigration.match(/CREATE OR REPLACE FUNCTION public\.lock_agency_followup_opt_in_scope\([\s\S]*?END \$\$;/i)?.[0] ?? "";
        const delegatedCatalogLock = delegatedScope.indexOf("PERFORM public.lock_agency_followup_mapping_catalog()");
        const delegatedIdentityLock = delegatedScope.indexOf("PERFORM public.lock_agency_followup_identity(pid)");
        expect(delegatedScope).not.toBe("");
        expect(delegatedCatalogLock, "opt-in scope must acquire catalog lock first").toBeGreaterThanOrEqual(0);
        expect(delegatedIdentityLock, "opt-in scope must acquire identity lock second").toBeGreaterThan(delegatedCatalogLock);
      } else if (writer === "lock_agency_followup_source_link_before_write") {
        const delegatedIdentitySet = serializedHandoffGateMigration.match(/CREATE OR REPLACE FUNCTION public\.lock_agency_followup_identity_set\([\s\S]*?END \$\$;/i)?.[0] ?? "";
        const delegatedCatalogLock = delegatedIdentitySet.indexOf("PERFORM public.lock_agency_followup_mapping_catalog()");
        const delegatedIdentityLock = delegatedIdentitySet.indexOf("PERFORM public.lock_agency_followup_identity(prospect_id)");
        expect(body).toContain("public.lock_agency_followup_identity_set(prospect_ids)");
        expect(delegatedIdentitySet).not.toBe("");
        expect(delegatedCatalogLock, "shared identity set must acquire catalog lock first").toBeGreaterThanOrEqual(0);
        expect(delegatedIdentityLock, "shared identity set must acquire identity lock second").toBeGreaterThan(delegatedCatalogLock);
      } else {
        expect(body, `${writer} must acquire the mapping catalog lock first`).toContain("public.lock_agency_followup_mapping_catalog");
      }
    }
    const gateFunction = serializedHandoffGateMigration.match(/CREATE OR REPLACE FUNCTION public\.authorize_agency_followup_provider_handoff\([\s\S]*?END \$\$;/i)?.[0] ?? "";
    expect(gateFunction).not.toBe("");
    expect(gateFunction.indexOf("PERFORM public.lock_agency_followup_identity(identity_prospect_id)")).toBeGreaterThanOrEqual(0);
    expect(gateFunction.indexOf("PERFORM public.lock_agency_followup_identity(identity_prospect_id)")).toBeLessThan(gateFunction.indexOf("FOR SHARE"));
    const lockOrder = [
      "PERFORM public.lock_agency_followup_mapping_catalog()",
      "PERFORM public.lock_agency_followup_identity(identity_prospect_id)",
      "FROM public.agency_prospects WHERE id=identity_prospect_id FOR SHARE",
      "FROM public.agency_followup_enrollments WHERE id=p_enrollment_id FOR NO KEY UPDATE",
      "FROM public.prospect_source_links x WHERE x.source_system=src_system AND x.source_record_key=identity_prospect_id::text ORDER BY x.id FOR SHARE",
      "FROM public.prospect_conversation_sources a WHERE a.source_link_id=src.id ORDER BY a.conversation_id FOR SHARE",
      "FROM public.prospect_people WHERE id=src.person_id FOR SHARE",
      "FROM public.prospect_person_firm_roles r WHERE r.organization_id=src.organization_id AND r.person_id=src.person_id AND r.active ORDER BY r.id FOR SHARE",
      "FROM public.prospect_conversations WHERE id=cid FOR SHARE",
      "FROM public.prospect_contactability WHERE conversation_id=cid FOR NO KEY UPDATE",
      "FROM public.agency_followup_messages WHERE id=p_message_id AND enrollment_id=p_enrollment_id FOR NO KEY UPDATE",
      "ORDER BY pm.step_number,pm.id FOR SHARE",
      "INTO prior_unresolved,prior_pending,retry_at",
    ];
    const lockPositions = lockOrder.map((statement) => gateFunction.indexOf(statement));
    expect(lockPositions.every((position) => position >= 0)).toBe(true);
    expect(lockPositions).toEqual([...lockPositions].sort((left, right) => left - right));
    expect(serializedHandoffGateMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.lock_agency_followup_identity\(pid uuid\)[\s\S]*?hashtextextended\('agency-followup-identity:'/i);
    expect(serializedHandoffGateMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.lock_agency_followup_opt_in_scope\([\s\S]*?PERFORM public\.lock_agency_followup_identity\(pid\)/i);
    expect(serializedHandoffGateMigration).toContain("REVOKE ALL ON FUNCTION public.authorize_agency_followup_provider_handoff");
    expect(serializedHandoffGateMigration).toContain("GRANT EXECUTE ON FUNCTION public.authorize_agency_followup_provider_handoff");
    expect(serializedHandoffGateMigration).toContain("REVOKE EXECUTE ON FUNCTION public.prepare_agency_followup_provider_attempt(uuid,uuid,text,integer,integer,integer) FROM service_role");
    expect(service).toContain('supabase.rpc("authorize_agency_followup_provider_handoff"');
    expect(service).not.toContain('supabase.rpc("prepare_agency_followup_provider_attempt"');
    expect(service).toContain('response.result === "deferred"');
    expect(service).toContain('typeof response.blocker !== "string"');
    expect(service).toContain('return { result: "blocked", blockers: response.blockers as string[] }');
    expect(service).toContain('return { result: "deferred", blocker: response.blocker, retryAt: response.retryAt }');
        expect(service).toContain('response.result === "ready"');
    expect(service).toContain("request: {");
    expect(service).toContain("idempotencyKey: expectedKey");
    expect(service).toContain("recipientEmail: authorizedRequest.recipientEmail");
    expect(service).toContain("subject: authorizedRequest.subject");
    expect(service).toContain("body: authorizedRequest.body");
  });

  it("promotes only an exact signed email.sent tag pair after the provider outcome is UNKNOWN", () => {
    expect(unknownResendReconciliationMigration).toContain("DROP FUNCTION IF EXISTS public.persist_agency_followup_resend_event(text, text, text, text, timestamptz, text, text)");
    expect(unknownResendReconciliationMigration).toContain("p_agency_followup_message_id uuid");
    expect(unknownResendReconciliationMigration).toContain("p_agency_followup_enrollment_id uuid");
    expect(unknownResendReconciliationMigration).toContain("signed_agency_followup_message_id");
    expect(unknownResendReconciliationMigration).toContain("signed_agency_followup_enrollment_id");
    expect(unknownResendReconciliationMigration).toContain("signed_agency_followup_tags_recorded");
    expect(unknownResendReconciliationMigration).toContain("signed_agency_followup_tags_recorded boolean NOT NULL DEFAULT false");
    expect(unknownResendReconciliationMigration).toContain("SECURITY INVOKER");
    expect(unknownResendReconciliationMigration).toContain("SET search_path = ''");
    expect(unknownResendReconciliationMigration).toContain("Agency follow-up message and enrollment tags must be supplied together");
    expect(unknownResendReconciliationMigration).toContain("contact.updated events cannot carry message identity tags");
    expect(unknownResendReconciliationMigration).toContain("message.id = p_agency_followup_message_id");
    expect(unknownResendReconciliationMigration).toContain("enrollment.id = p_agency_followup_enrollment_id");
    expect(unknownResendReconciliationMigration).toContain("signed_agency_followup_message_id IS DISTINCT FROM p_agency_followup_message_id");
    expect(unknownResendReconciliationMigration).toContain("signed_agency_followup_enrollment_id IS DISTINCT FROM p_agency_followup_enrollment_id");
    expect(unknownResendReconciliationMigration).toContain("signed_agency_followup_tags_recorded");
    expect(unknownResendReconciliationMigration).toContain("agency_followup_email_sha256(v_tag_snapshot) IS DISTINCT FROM p_recipient_sha256");
    expect(unknownResendReconciliationMigration).toContain("lower(btrim(v_tag_snapshot)) IS DISTINCT FROM lower(btrim(p_recipient_email))");
    expect(unknownResendReconciliationMigration).toContain("v_tag_state = 'claimed'");
    expect(unknownResendReconciliationMigration).toContain("v_processing_result := 'unmatched_message'");
    expect(unknownResendReconciliationMigration).toContain("v_tag_state = 'unknown'");
    expect(unknownResendReconciliationMigration).toContain("p_event_type = 'email.sent'");
    expect(unknownResendReconciliationMigration).toContain("v_promote_unknown := true");
    expect(unknownResendReconciliationMigration).toContain("IF v_promote_unknown THEN");
    expect(unknownResendReconciliationMigration).toContain("SET state = 'accepted'");
    expect(unknownResendReconciliationMigration).toContain("RETURN jsonb_build_object('result', 'duplicate')");
    expect(unknownResendReconciliationMigration).toMatch(/v_legacy_identity_enrichment\s*:=\s*NOT v_existing_event\.signed_agency_followup_tags_recorded\s+AND v_existing_event\.processing_result = 'unmatched_message'\s+AND v_existing_event\.message_id IS NULL\s+AND v_existing_event\.enrollment_id IS NULL/i);
    expect(unknownResendReconciliationMigration).toContain("SELECT application.message_id, application.enrollment_id");
    expect(unknownResendReconciliationMigration).toMatch(/IF v_legacy_identity_enrichment\s+AND v_message_id IS NOT NULL\s+AND \(v_existing_application_message_id IS DISTINCT FROM v_message_id\s+OR v_existing_application_enrollment_id IS DISTINCT FROM v_enrollment_id\)/i);
    expect(unknownResendReconciliationMigration).not.toMatch(/UPDATE\s+public\.agency_followup_provider_events/i);
    expect(unknownResendReconciliationMigration).toMatch(/GRANT EXECUTE ON FUNCTION\s+public\.persist_agency_followup_resend_event\(text,text,text,text,timestamptz,text,text,uuid,uuid\)\s+TO service_role/i);
    expect(unknownResendReconciliationMigration).not.toContain("SECURITY DEFINER");
    const reconcileFunction = unknownResendReconciliationMigration.match(/CREATE FUNCTION public\.persist_agency_followup_resend_event\([\s\S]*?END;?\s*\$\$;/i)?.[0] ?? "";
    expect(reconcileFunction).not.toBe("");
    const eventLockOrder = [
      "PERFORM public.lock_agency_followup_mapping_catalog()",
      "PERFORM public.lock_agency_followup_identity(v_locked_prospect_id)",
      "FOR UPDATE",
    ].map((statement) => reconcileFunction.indexOf(statement));
    expect(eventLockOrder.every((position) => position >= 0)).toBe(true);
    expect(eventLockOrder).toEqual([...eventLockOrder].sort((left, right) => left - right));

    expect(resendWebhookRoute).toContain("tags");
    expect(resendWebhookRoute).toContain('agency_followup_message_id');
    expect(resendWebhookRoute).toContain('agency_followup_enrollment_id');
    expect(resendWebhookRoute).toContain("if (!isObject(value)) return { ok: false }");
    expect(resendWebhookRoute).toContain("Object.values(value)");
    expect(resendWebhookRoute).toContain("(messageId === undefined) !== (enrollmentId === undefined)");
    expect(resendWebhookRoute).toContain("if (hasDuplicateAgencyFollowupTagKey(rawBody))");
    expect(resendWebhookRoute).toContain("function hasDuplicateAgencyFollowupTagKey(rawBody: string)");
    expect(resendWebhookRoute).toContain('return noStore({ error: "invalid_message_tags" }, 400)');
    const signedPayloadValidationOrder = [
      resendWebhookRoute.indexOf("new Webhook(secret).verify(rawBody"),
      resendWebhookRoute.indexOf("if (hasDuplicateAgencyFollowupTagKey(rawBody))"),
      resendWebhookRoute.indexOf("event = JSON.parse(rawBody)"),
    ];
    expect(signedPayloadValidationOrder.every((position) => position >= 0)).toBe(true);
    expect(signedPayloadValidationOrder).toEqual([...signedPayloadValidationOrder].sort((left, right) => left - right));
    expect(resendWebhookRoute).toContain("const hasAgencyFollowupIdentity = parsedTags.messageId !== null && parsedTags.enrollmentId !== null;");
    expect(resendWebhookRoute).toContain('if (outcome === "unmatched_message" && hasAgencyFollowupIdentity) {');
    expect(resendWebhookRoute).toContain('return noStore({ ok: false, outcome }, 503)');
    expect(resendWebhookRoute).toContain("p_agency_followup_message_id");
    expect(resendWebhookRoute).toContain("p_agency_followup_enrollment_id");
    expect(resendWebhookRoute).toContain('supabaseAdmin.rpc("persist_agency_followup_resend_event"');
    expect(walkthrough).toContain("persist_agency_followup_resend_event($1,$2,$3,$4,$5::timestamptz,$6,$7,$8::uuid,$9::uuid)");
    expect(walkthrough).not.toMatch(/persist_agency_followup_resend_event\(\$1,\$2,\$3,\$4,\$5::timestamptz,\$6,\$7\)/);
  });
  it("refreshes handoff time after contended locks and applies contact unsubscribes with typed hash-only evidence", () => {
    const handoff = handoffClockContactMigration.match(
      /CREATE OR REPLACE FUNCTION public\.authorize_agency_followup_provider_handoff\([\s\S]*?END \$\$;/i,
    )?.[0] ?? "";
    expect(handoff).not.toBe("");
    expect(handoff).not.toContain("now_at timestamptz:=clock_timestamp()");
    const predecessorLock = handoff.indexOf("ORDER BY pm.step_number,pm.id FOR SHARE;");
    const clockRefresh = handoff.indexOf("now_at:=clock_timestamp();", predecessorLock);
    const leaseCheck = handoff.indexOf("m.lease_until<=now_at", clockRefresh);
    expect(predecessorLock).toBeGreaterThanOrEqual(0);
    expect(clockRefresh).toBeGreaterThan(predecessorLock);
    expect(leaseCheck).toBeGreaterThan(clockRefresh);
    const futureReviewCheck = handoff.indexOf("m.reviewed_at>now_at THEN blockers:=pg_catalog.array_append(blockers,'approval_invalid_reviewer_or_time')", clockRefresh);
    expect(futureReviewCheck).toBeGreaterThan(clockRefresh);
    expect(futureReviewCheck).toBeGreaterThan(leaseCheck);
    expect(handoff).toContain("lease_until>now_at");

    expect(handoffClockContactMigration).toContain("'matched_contact'");
    expect(handoffClockContactMigration).toContain("agency_followup_provider_events_match_shape_check");
    expect(handoffClockContactMigration).toContain("recipient_sha256 IS NOT NULL");
    expect(handoffClockContactMigration).toContain("agency_followup_provider_contact_applications");
    expect(handoffClockContactMigration).toContain("FOREIGN KEY (provider_event_id,event_type,processing_result)");
    expect(handoffClockContactMigration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(handoffClockContactMigration).toContain("FORCE ROW LEVEL SECURITY");
    expect(handoffClockContactMigration).toContain("REVOKE ALL ON FUNCTION public.persist_agency_followup_resend_contact_event");
    expect(handoffClockContactMigration).toMatch(/GRANT EXECUTE ON FUNCTION\s+public\.persist_agency_followup_resend_contact_event\(text,timestamptz,text,text\)\s+TO service_role/i);
    expect(handoffClockContactMigration).not.toContain("SECURITY DEFINER");

    const contactFunction = handoffClockContactMigration.match(
      /CREATE OR REPLACE FUNCTION public\.persist_agency_followup_resend_contact_event\([\s\S]*?END;\s*\$\$;/i,
    )?.[0] ?? "";
    expect(contactFunction).not.toBe("");
    expect(contactFunction).toContain("public.agency_followup_email_sha256(p_recipient_email)");
    expect(contactFunction).toContain("p_recipient_sha256");
    expect(contactFunction).toContain("legacy_unmatched");
    expect(contactFunction).toContain("ambiguous_source");
    expect(contactFunction).toContain("provider_event_id,conversation_id,source_link_id");
    expect(contactFunction).toContain("'resend_email_unsubscribed'");
    expect(contactFunction).not.toContain("agency_followup_provider_event_applications");
    expect(contactFunction).toContain(
      "provider_event_id,provider_message_id,event_type,contact_status,occurred_at,recipient_sha256,",
    );
    expect(contactFunction).toContain(
      "btrim(p_provider_event_id),NULL,'contact.updated','unsubscribed',p_occurred_at,p_recipient_sha256,",
    );
  });
});
