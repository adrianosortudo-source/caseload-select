import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase", "migrations");
  const filename = readdirSync(directory).find((entry) =>
    entry.endsWith("_privacy_screened_lead_redaction.sql"),
  );
  expect(filename).toBeTruthy();
  return readFileSync(join(directory, filename!), "utf8").toLowerCase().replace(/\s+/g, " ");
}

describe("screened-lead privacy redaction migration contract", () => {
  it("keeps all privacy RPCs service-only and fixes their search path", () => {
    const sql = migrationSql();

    for (const signature of [
      "public.is_channel_subject_privacy_suppressed(uuid, text, text)",
      "public.redact_screened_lead_subject(uuid, text, text, uuid)",
      "public.complete_screened_lead_external_cleanup(uuid, uuid, jsonb)",
      "public.list_pending_screened_lead_privacy_cleanups(integer)",
      "public.purge_expired_privacy_audit_envelopes(integer)",
    ]) {
      expect(sql).toContain(`revoke all privileges on function ${signature} from public, anon, authenticated, service_role`);
      expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    }

    expect(sql.match(/security definer set search_path = ''/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql.match(/security invoker set search_path = ''/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql).not.toMatch(/function public\.(redact_screened_lead_subject|complete_screened_lead_external_cleanup|list_pending_screened_lead_privacy_cleanups|purge_expired_privacy_audit_envelopes)[\s\s]*\([^;]+security definer/);
    expect(sql).toContain("grant usage on schema private to service_role");
    expect(sql).toContain(
      "revoke all privileges on table public.privacy_deletion_requests from public, anon, authenticated, service_role",
    );
    expect(sql).not.toMatch(/grant execute on function public\.(redact|complete|purge)[^;]+to (anon|authenticated|public)/);
  });

  it("pins exact one-way redaction and post-erasure race guards", () => {
    const sql = migrationSql();

    expect(sql).toContain("body = '[redacted]'");
    expect(sql).toContain("meta_message_id is null");
    expect(sql).toContain("actor_id is null");
    expect(sql).toContain("failure_reason = '[redacted]'");
    expect(sql).toContain("archived = true");
    expect(sql).toContain("for key share");
    expect(sql).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(sql).toContain("channel conversation event rejected: screened lead is privacy-redacted");
    expect(sql).toContain("webhook outbox insert rejected: screened lead is privacy-redacted");
    expect(sql).toContain("consent log insert rejected: screened lead is privacy-redacted");
    expect(sql).toContain("content attribution insert rejected: screened lead is privacy-redacted");
    expect(sql).toContain("privacy_expiry_authorizations");
    expect(sql).toContain("privacy_channel_suppressions");
    expect(sql).toContain("channel_subject_is_privacy_suppressed");
    expect(sql).toContain("processed_channel_messages_privacy_guard");
    expect(sql).toContain("processed channel message sender_id is required");
    expect(sql).toContain("processed channel message subject binding is immutable");
    expect(sql).toContain("privacy-suppressed channel subject cannot be claimed");
    expect(sql).toContain("new.firm_id::text || ':' || new.channel || ':' || new.sender_id");
    expect(sql).toContain("p_firm_id::text || ':' || v_subject.channel || ':' || v_subject.sender_id");
    expect(sql).toContain("pg_catalog.jsonb_array_elements(v_meta_subjects)");
    expect(sql).toContain("guard_screened_lead_link_after_redaction");
    expect(sql).toContain("web_intake_sessions_privacy_guard");
    expect(sql).toContain("voice_turn_sessions_privacy_guard");
    expect(sql).toContain("voice_callback_requests_privacy_guard");
    expect(sql).toContain("outbound_messages_privacy_guard");
    expect(sql).toContain("unconfirmed_inquiries_privacy_suppression_guard");
    expect(sql).toContain("old.occurred_at <= pg_catalog.clock_timestamp() - interval '3 years'");
    expect(sql).toContain("old.captured_at <= pg_catalog.clock_timestamp() - interval '3 years'");
    expect(sql).toContain("old.observed_at <= pg_catalog.clock_timestamp() - interval '3 years'");
    expect(sql).toContain("purged_consent_event_count");
    expect(sql).toContain("purged_attribution_event_count");
    expect(sql).toContain("'has_more', v_remaining_eligible_count > 0");
    expect(sql).toContain("pg_catalog.sha256");
    expect(sql).not.toContain("pg_catalog.md5");
  });

  it("backfills only explicit legacy anonymization sentinels", () => {
    const sql = migrationSql();

    expect(sql).toContain("lead.contact_name = '[anonymized]'");
    expect(sql).toContain("lead.brief_json @> '{\"anonymized\":true}'::jsonb");
    expect(sql).toContain("lead.slot_answers @> '{\"anonymized\":true}'::jsonb");
    expect(sql).toContain("'legacy_anonymization_backfill'");
  });

  it("persists a closed external-cleanup manifest and clears it on completion", () => {
    const sql = migrationSql();

    expect(sql).toContain("'bucket', 'intake-attachments'");
    expect(sql).toContain("'prefix', p_firm_id::text || '/' || v_legacy_session_id::text");
    expect(sql).toContain("'ghl', pg_catalog.jsonb_build_object");
    expect(sql).toContain("'meta', pg_catalog.jsonb_build_object");
    expect(sql).toContain("'resend', pg_catalog.jsonb_build_object");
    expect(sql).toContain("external_cleanup_manifest = '{}'::jsonb");
    expect(sql).toContain("cleanup_summary must contain only the required non-pii count/status fields");
  });
});
