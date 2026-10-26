import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations", "20261026180704_agency_followup_recipient_unsubscribe.sql"), "utf8");

describe("Agency recipient unsubscribe migration contract", () => {
  it("stores append-only hash-only unsubscribe evidence under service-role access", () => {
    expect(migration).toContain("CREATE TABLE public.agency_followup_recipient_unsubscribes");
    expect(migration).toContain("recipient_email_sha256 text NOT NULL");
    expect(migration).toContain("token_sha256 text NOT NULL UNIQUE");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("agency_followup_recipient_unsubscribes_no_mutation");
    expect(migration).toContain("lock_agency_followup_identity(v_prospect_id)");
    expect(migration).toContain("lock_agency_followup_unsubscribe_recipient(NEW.recipient_email_sha256)");
    expect(migration).toContain("PERFORM public.lock_agency_followup_unsubscribe_recipient(hash_email_now)");
    expect(migration).toContain("WHERE recipient_unsubscribe.recipient_email_sha256=hash_email_now");
    expect(migration).toContain("agency_followup_recipient_unsubscribe_handoff_gate");
  });

  it("binds an idempotent one-click opt-out to an attempted exact message and records the UI event", () => {
    expect(migration).toContain("agency_followup_email_sha256(message.recipient_email_snapshot) = p_recipient_email_sha256");
    expect(migration).toContain("agency_followup_email_sha256(enrollment.recipient_email_snapshot) = p_recipient_email_sha256");
    expect(migration).not.toContain("message.recipient_sha256 = p_recipient_email_sha256");
    expect(migration).not.toContain("enrollment.recipient_sha256 = p_recipient_email_sha256");
    expect(migration).toContain("message.attempt_count > 0");
    expect(migration).toContain("message.state IN ('claimed', 'accepted', 'unknown', 'failed')");
    expect(migration).toContain("ON CONFLICT (token_sha256) DO NOTHING");
    expect(migration).toContain("'unsubscribe_observed'");
    expect(migration).toContain("'recipient_one_click_link'");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.record_agency_followup_recipient_unsubscribe");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.record_agency_followup_recipient_unsubscribe");
  });
});
