/**
 * Real-Postgres coverage for the service-only screened-lead privacy RPCs.
 * DIRECT_DATABASE_URL must point to an ephemeral database with all migrations
 * applied. This test intentionally leaves fixtures for stack teardown because
 * the mutation guards being tested prohibit ordinary cleanup DELETEs.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

interface RedactionRpcResult {
  ok: boolean;
  redacted_count?: number;
  deletion_request_id?: string;
  external_cleanup_status?: string;
  external_cleanup_manifest?: unknown;
  error?: string;
}

interface PendingCleanupRpcResult {
  ok: boolean;
  requests: Array<{
    firm_id: string;
    screened_lead_id: string;
    current_lead_id: string;
    deletion_request_id: string;
  }>;
}

interface ExternalCleanupSummary {
  storage_deleted_count: number;
  ghl_status: string;
  meta_status: string;
  resend_status: string;
}

interface CleanupCompletionRpcResult {
  ok: boolean;
  external_cleanup_status?: string;
  cleanup_summary?: ExternalCleanupSummary;
}

interface AuditPurgeRpcResult {
  ok: boolean;
  retention_period: string;
  purged_channel_event_count: number;
  purged_consent_event_count: number;
  purged_attribution_event_count: number;
  purged_event_count: number;
  has_more: boolean;
}

function parseDirectDatabaseUrl(url: string) {
  const trimmed = url.trim();
  const unquoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
      ? trimmed.slice(1, -1)
      : trimmed;
  const parsed = new URL(unquoted);
  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : undefined,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || undefined,
  };
}

describe.skipIf(!DB_URL)("screened-lead privacy redaction (real Postgres)", () => {
  let Client: typeof import("pg").Client;
  let conn: import("pg").Client;

  const firmId = randomUUID();
  const otherFirmId = randomUUID();
  const leadPk = randomUUID();
  const otherLeadPk = randomUUID();
  const publicLeadId = `privacy-fixture-${randomUUID()}`;
  const otherPublicLeadId = `privacy-fixture-${randomUUID()}`;
  const requestId = randomUUID();
  const pendingRequestId = randomUUID();
  const senderId = `meta-sender-${randomUUID()}`;
  const inboundMid = `meta-mid-${randomUUID()}`;
  let conflictCheckId: string;

  async function serviceRpc<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await conn.query("begin");
    try {
      await conn.query("set local role service_role");
      const result = await conn.query(sql, params);
      await conn.query("commit");
      return result.rows[0].result as T;
    } catch (error) {
      await conn.query("rollback");
      throw error;
    }
  }

  beforeAll(async () => {
    ({ Client } = await import("pg"));
    conn = new Client(parseDirectDatabaseUrl(DB_URL!));
    await conn.connect();

    await conn.query(
      `insert into intake_firms (id, name, custom_domain, subdomain) values
         ($1, 'Privacy Fixture Firm', null, $3),
         ($2, 'Privacy Fixture Other Firm', null, $4)`,
      [firmId, otherFirmId, `privacy-${firmId}`, `privacy-${otherFirmId}`],
    );

    await conn.query(
      `insert into screened_leads
         (id, firm_id, lead_id, brief_json, brief_html, slot_answers,
          matter_type, practice_area, decision_deadline, contact_name,
          contact_email, contact_phone, raw_transcript, consent_ip,
          consent_user_agent)
       values
         ($1, $3, $5, '{"name":"A Person"}'::jsonb, '<p>A Person</p>',
          '{"email":"person@example.test"}'::jsonb, 'employment', 'employment',
          now() + interval '48 hours', 'A Person', 'person@example.test',
          '+14165550100', 'private transcript', '192.0.2.9', 'fixture agent'),
         ($2, $4, $6, '{}'::jsonb, '<p>Other</p>', '{}'::jsonb,
          'employment', 'employment', now() + interval '48 hours',
          'Other Person', 'other@example.test', null, null, null, null)`,
      [leadPk, otherLeadPk, firmId, otherFirmId, publicLeadId, otherPublicLeadId],
    );

    await conn.query(
      `insert into channel_intake_sessions
         (firm_id, channel, sender_id, engine_state, finalized, screened_lead_id)
       values ($1, 'facebook', $2, '{"email":"person@example.test"}'::jsonb, true, $3)`,
      [firmId, senderId, leadPk],
    );
    await conn.query(
      `insert into unconfirmed_inquiries
         (firm_id, channel, sender_id, sender_meta, raw_transcript, reason)
       values ($1, 'facebook', $2, '{"name":"A Person"}'::jsonb, 'private text', 'abandoned')`,
      [firmId, senderId],
    );

    await conn.query(
      `insert into channel_conversation_events
         (screened_lead_id, firm_id, channel, direction, source, body,
          status, meta_message_id, client_request_id, actor_type, actor_id,
          authoritative_inbound, occurred_at)
       values
         ($1, $2, 'facebook', 'inbound', 'webhook', 'old private inbound',
          'received', $3, null, 'lead', $4, true, now() - interval '4 years'),
         ($1, $2, 'facebook', 'outbound', 'operator', 'pending private reply',
          'pending', null, $5, 'operator', 'operator@example.test', false, now())`,
      [leadPk, firmId, inboundMid, senderId, pendingRequestId],
    );

    await conn.query(
      `insert into processed_channel_messages (firm_id, channel, message_mid, sender_id)
       values ($1, 'facebook', $2, $3)`,
      [firmId, inboundMid, senderId],
    );
    await conn.query(
      `insert into webhook_outbox
         (firm_id, lead_id, action, idempotency_key, payload, webhook_url)
       values ($1, $2, 'taken', $3, '{"email":"person@example.test"}'::jsonb,
         'https://example.test/private-hook')`,
      [firmId, publicLeadId, `privacy-outbox-${randomUUID()}`],
    );

    await conn.query(
      `insert into consent_log
         (firm_id, subject_id, channel, event_type, consent_type,
           consent_status, basis_evidence, ip_address, user_agent, note, captured_at)
       values ($1, $2, 'email', 'implied_set', 'implied_inquiry', 'granted',
          '{"email":"person@example.test"}'::jsonb, '192.0.2.9',
          'fixture agent', 'private consent note', now() - interval '4 years')`,
      [firmId, leadPk],
    );
    await conn.query(
      `insert into content_attribution_evidence
         (firm_id, screened_lead_id, attribution_state, evidence_method,
          evidence_payload, evidence_note, observed_at, recorded_by_role)
       values ($1, $2, 'unknown', 'insufficient_evidence',
          '{"landing":"private-path"}'::jsonb, 'private attribution note',
          now() - interval '4 years', 'system')`,
      [firmId, leadPk],
    );
    const conflict = await conn.query(
      `insert into screened_conflict_checks (firm_id, screened_lead_id, notes)
       values ($1, $2, 'private conflict note') returning id`,
      [firmId, leadPk],
    );
    conflictCheckId = conflict.rows[0].id;
    await conn.query(
      `insert into screened_conflict_parties
         (conflict_check_id, firm_id, party_name, party_name_raw, party_role, notes)
       values ($1, $2, 'Private Opponent', 'Private Opponent', 'opposing_party', 'private party note')`,
      [conflictCheckId, firmId],
    );
  }, 30000);

  afterAll(async () => {
    await conn.end();
  });

  it("exposes privacy RPCs only to service_role", async () => {
    const privileges = await conn.query(
      `select
         has_function_privilege('anon', 'public.redact_screened_lead_subject(uuid,text,text,uuid)', 'execute') as anon_redact,
         has_function_privilege('authenticated', 'public.redact_screened_lead_subject(uuid,text,text,uuid)', 'execute') as authenticated_redact,
         has_function_privilege('service_role', 'public.redact_screened_lead_subject(uuid,text,text,uuid)', 'execute') as service_redact,
         has_function_privilege('anon', 'public.complete_screened_lead_external_cleanup(uuid,uuid,jsonb)', 'execute') as anon_complete,
         has_function_privilege('authenticated', 'public.complete_screened_lead_external_cleanup(uuid,uuid,jsonb)', 'execute') as authenticated_complete,
         has_function_privilege('service_role', 'public.complete_screened_lead_external_cleanup(uuid,uuid,jsonb)', 'execute') as service_complete,
         has_function_privilege('anon', 'public.is_channel_subject_privacy_suppressed(uuid,text,text)', 'execute') as anon_suppression,
         has_function_privilege('service_role', 'public.is_channel_subject_privacy_suppressed(uuid,text,text)', 'execute') as service_suppression,
         has_function_privilege('anon', 'public.list_pending_screened_lead_privacy_cleanups(integer)', 'execute') as anon_pending,
         has_function_privilege('service_role', 'public.list_pending_screened_lead_privacy_cleanups(integer)', 'execute') as service_pending,
         has_function_privilege('anon', 'public.purge_expired_privacy_audit_envelopes(integer)', 'execute') as anon_purge,
         has_function_privilege('service_role', 'public.purge_expired_privacy_audit_envelopes(integer)', 'execute') as service_purge,
         has_table_privilege('service_role', 'public.privacy_deletion_requests', 'select') as service_direct_request_read,
         has_table_privilege('authenticated', 'public.privacy_deletion_requests', 'select') as authenticated_request_read`,
    );
    expect(privileges.rows[0]).toMatchObject({
      anon_redact: false,
      authenticated_redact: false,
      service_redact: true,
      anon_complete: false,
      authenticated_complete: false,
      service_complete: true,
      anon_suppression: false,
      service_suppression: true,
      anon_pending: false,
      service_pending: true,
      anon_purge: false,
      service_purge: true,
      service_direct_request_read: false,
      authenticated_request_read: false,
    });
  });

  it("exposes operational recovery RPCs only to service_role", async () => {
    const privileges = await conn.query(
      `with recovery_functions(signature) as (values
         ('public.resolve_screened_lead_privacy_coordinate(uuid,text,uuid)'),
         ('public.redact_screened_lead_subject_by_id(uuid,uuid,text,uuid)'),
         ('public.list_privacy_deletion_registry_backfill_firms(uuid,uuid,integer)'),
         ('public.list_privacy_deletion_registry_backfill_candidates(uuid,uuid,timestamptz,uuid,timestamptz,integer)'),
         ('public.begin_privacy_registry_reconciliation(text,boolean)'),
         ('public.mark_privacy_registry_reconciliation_complete(text,uuid,uuid,uuid)'),
         ('public.open_privacy_recovery(uuid,uuid)')
       )
       select signature,
              has_function_privilege('anon', signature, 'execute') as anon_execute,
              has_function_privilege('authenticated', signature, 'execute') as authenticated_execute,
              has_function_privilege('service_role', signature, 'execute') as service_execute
         from recovery_functions`,
    );
    expect(privileges.rows).toHaveLength(7);
    for (const privilege of privileges.rows) {
      expect(privilege).toMatchObject({
        anon_execute: false,
        authenticated_execute: false,
        service_execute: true,
      });
    }
  });

  it("opens a completed replay from locked or replaying, but rejects incomplete coordinates", async () => {
    const cycleId = randomUUID();
    const operationId = randomUUID();
    const otherId = randomUUID();

    await conn.query("begin");
    try {
      const setControl = async (overrides: {
        state?: string;
        schemaVersion?: string;
        cycleId?: string;
        requiredOperation?: string | null;
        operationId?: string | null;
        completed?: boolean;
      } = {}) => {
        await conn.query("reset role");
        await conn.query(
          `update private.privacy_recovery_control
              set state = $1,
                  schema_version = $2,
                  cycle_id = $3,
                  cycle_started_at = now() - interval '1 minute',
                  initial_backfill_started_at = now() - interval '1 minute',
                  required_operation = $4,
                  reconciliation_operation_id = $5,
                  reconciliation_completed_at = case when $6 then now() else null end
            where singleton`,
          [
            overrides.state ?? "locked",
            overrides.schemaVersion ?? "20260903183915",
            overrides.cycleId ?? cycleId,
            overrides.requiredOperation === undefined ? "replay" : overrides.requiredOperation,
            overrides.operationId === undefined ? operationId : overrides.operationId,
            overrides.completed ?? true,
          ],
        );
        await conn.query("set local role service_role");
      };

      await setControl();
      const locked = await conn.query(
        `select public.open_privacy_recovery($1, $2) as result`,
        [cycleId, operationId],
      );
      expect(locked.rows[0].result).toEqual({ ok: true, state: "open" });

      const idempotent = await conn.query(
        `select public.open_privacy_recovery($1, $2) as result`,
        [cycleId, operationId],
      );
      expect(idempotent.rows[0].result).toEqual({ ok: true, state: "open" });

      await setControl({ state: "replaying" });
      const replaying = await conn.query(
        `select public.open_privacy_recovery($1, $2) as result`,
        [cycleId, operationId],
      );
      expect(replaying.rows[0].result).toEqual({ ok: true, state: "open" });

      for (const mismatch of [
        { schemaVersion: "stale" },
        { cycleId: otherId },
        { operationId: otherId },
        { completed: false },
        { requiredOperation: "backfill" },
      ]) {
        await setControl(mismatch);
        const refused = await conn.query(
          `select public.open_privacy_recovery($1, $2) as result`,
          [cycleId, operationId],
        );
        expect(refused.rows[0].result).toEqual({
          ok: false,
          error: "privacy recovery is not ready to open",
        });
      }

      await conn.query("reset role");
      await conn.query("savepoint invalid_recovery_state");
      try {
        await expect(conn.query(
          `update private.privacy_recovery_control set state = 'failed' where singleton`,
        )).rejects.toMatchObject({ code: "23514" });
      } finally {
        await conn.query("rollback to savepoint invalid_recovery_state");
        await conn.query("release savepoint invalid_recovery_state");
      }
    } finally {
      await conn.query("rollback");
    }
  });

  it("freezes initial backfill at activation time and refuses direct first replay", async () => {
    const lateLeadPk = randomUUID();
    const lateRequestId = randomUUID();
    const oldCycleId = randomUUID();
    await conn.query("begin");
    try {
      await conn.query(
        `update private.privacy_recovery_control
            set state = 'locked', schema_version = '20260903183915',
                cycle_id = $1, cycle_started_at = now() - interval '1 day',
                initial_backfill_started_at = null, required_operation = null,
                reconciliation_operation_id = null, reconciliation_completed_at = null
          where singleton`,
        [oldCycleId],
      );
      await conn.query(
        `insert into screened_leads
           (id, firm_id, lead_id, brief_json, brief_html, slot_answers,
            matter_type, practice_area, decision_deadline)
         values ($1, $2, $3, '{}'::jsonb, '<p>Late fixture</p>', '{}'::jsonb,
           'employment', 'employment', now() + interval '48 hours')`,
        [lateLeadPk, firmId, `privacy-late-${randomUUID()}`],
      );
      await conn.query(
        `insert into privacy_deletion_requests
           (id, firm_id, screened_lead_id, subject_key_hash, reason,
            requested_at, database_redacted_at)
         values ($1, $2, $3, $4, 'internal_test_record', now(), now())`,
        [lateRequestId, firmId, lateLeadPk, `late-subject-${randomUUID()}`],
      );

      await conn.query("set local role service_role");
      const refusedReplay = await conn.query(
        `select public.begin_privacy_registry_reconciliation('replay', false) as result`,
      );
      expect(refusedReplay.rows[0].result).toMatchObject({
        ok: false,
        error: "initial registry backfill is not initialized",
      });

      const begun = await conn.query(
        `select public.begin_privacy_registry_reconciliation('backfill', false) as result`,
      );
      expect(begun.rows[0].result).toMatchObject({ ok: true, operation: "backfill" });
      expect(begun.rows[0].result.cycle_id).not.toBe(oldCycleId);
      const firms = await conn.query(
        `select public.list_privacy_deletion_registry_backfill_firms($1, null, 100) as result`,
        [begun.rows[0].result.cycle_id],
      );
      expect(firms.rows[0].result).toMatchObject({ ok: true });
      expect(firms.rows[0].result.firm_ids).toContain(firmId);
    } finally {
      await conn.query("rollback");
    }
  });

  it("is tenant-scoped and enumeration-safe", async () => {
    const result = await serviceRpc(
      `select public.redact_screened_lead_subject($1, $2, 'subject_request', $3) as result`,
      [otherFirmId, publicLeadId, randomUUID()],
    );
    expect(result).toMatchObject({ ok: true, redacted_count: 0, external_cleanup_status: "not_applicable" });

    const row = await conn.query(`select privacy_redacted_at from screened_leads where id = $1`, [leadPk]);
    expect(row.rows[0].privacy_redacted_at).toBeNull();
  });

  it("rejects a deletion-request UUID bound to a different public lead", async () => {
    const boundLeadPk = randomUUID();
    const boundRequestId = randomUUID();
    const boundPublicLeadId = `privacy-bound-${randomUUID()}`;
    await conn.query(
      `insert into screened_leads
         (id, firm_id, lead_id, brief_json, brief_html, slot_answers,
          matter_type, practice_area, decision_deadline)
       values ($1, $2, $3, '{}'::jsonb, '<p>Bound fixture</p>', '{}'::jsonb,
         'employment', 'employment', now() + interval '48 hours')`,
      [boundLeadPk, firmId, boundPublicLeadId],
    );
    await conn.query(
      `insert into privacy_deletion_requests
         (id, firm_id, screened_lead_id, subject_key_hash, reason, database_redacted_at)
       values ($1, $2, $3, $4, 'internal_test_record', now())`,
      [boundRequestId, firmId, boundLeadPk, `bound-subject-${randomUUID()}`],
    );

    const mismatch = await serviceRpc<RedactionRpcResult>(
      `select public.resolve_screened_lead_privacy_coordinate($1, $2, $3) as result`,
      [firmId, otherPublicLeadId, boundRequestId],
    );
    expect(mismatch).toMatchObject({ ok: false, error: "deletion request coordinate mismatch" });

    const matching = await serviceRpc<{ ok: boolean; found: boolean; screened_lead_id: string }>(
      `select public.resolve_screened_lead_privacy_coordinate($1, $2, $3) as result`,
      [firmId, boundPublicLeadId, boundRequestId],
    );
    expect(matching).toMatchObject({ ok: true, found: true, screened_lead_id: boundLeadPk });
  });

  it("resolves an already-redacted lead when retried with its original public lead ID", async () => {
    const redactedLeadPk = randomUUID();
    const redactedRequestId = randomUUID();
    const originalPublicLeadId = `privacy-original-${randomUUID()}`;
    const subjectKeyHash = createHash("sha256")
      .update(`${firmId}:${originalPublicLeadId}:${redactedRequestId}`, "utf8")
      .digest("hex");
    await conn.query(
      `insert into screened_leads
         (id, firm_id, lead_id, brief_json, brief_html, slot_answers,
          matter_type, practice_area, decision_deadline)
       values ($1, $2, $3, '{}'::jsonb, '<p>Redacted fixture</p>', '{}'::jsonb,
         'employment', 'employment', now() + interval '48 hours')`,
      [redactedLeadPk, firmId, `privacy-redacted:${redactedLeadPk}`],
    );
    await conn.query(
      `insert into privacy_deletion_requests
         (id, firm_id, screened_lead_id, subject_key_hash, reason, database_redacted_at)
       values ($1, $2, $3, $4, 'internal_test_record', now())`,
      [redactedRequestId, firmId, redactedLeadPk, subjectKeyHash],
    );

    const retry = await serviceRpc<{ ok: boolean; found: boolean; screened_lead_id: string }>(
      `select public.resolve_screened_lead_privacy_coordinate($1, $2, $3) as result`,
      [firmId, originalPublicLeadId, redactedRequestId],
    );
    expect(retry).toMatchObject({ ok: true, found: true, screened_lead_id: redactedLeadPk });
  });

  it("atomically redacts direct identifiers and returns the external manifest", async () => {
    const result = await serviceRpc<RedactionRpcResult>(
      `select public.redact_screened_lead_subject($1, $2, 'subject_request', $3) as result`,
      [firmId, publicLeadId, requestId],
    );

    expect(result).toMatchObject({
      ok: true,
      redacted_count: 1,
      deletion_request_id: requestId,
      external_cleanup_status: "pending",
      external_cleanup_manifest: {
        version: 1,
        storage_objects: [],
        external_systems: {
          ghl: { status: "manual_required" },
          meta: { status: "provider_managed" },
          resend: { status: "provider_managed" },
        },
      },
    });

    const lead = await conn.query(
      `select lead_id, contact_name, contact_email, contact_phone, raw_transcript,
              brief_json, slot_answers, consent_ip, consent_user_agent,
              archived, privacy_deletion_request_id
         from screened_leads where id = $1`,
      [leadPk],
    );
    expect(lead.rows[0]).toMatchObject({
      lead_id: `privacy-redacted:${leadPk}`,
      contact_name: "[anonymized]",
      contact_email: null,
      contact_phone: null,
      raw_transcript: null,
      brief_json: { anonymized: true },
      slot_answers: { anonymized: true },
      consent_ip: null,
      consent_user_agent: null,
      archived: true,
      privacy_deletion_request_id: requestId,
    });

    const events = await conn.query(
      `select body, meta_message_id, actor_id, authoritative_inbound, failure_reason
         from channel_conversation_events where screened_lead_id = $1`,
      [leadPk],
    );
    expect(events.rows.every((row) => row.body === "[redacted]" && row.meta_message_id == null && row.actor_id == null)).toBe(true);
    expect(events.rows.every((row) => row.authoritative_inbound === false && row.failure_reason == null)).toBe(true);

    const secondary = await conn.query(
      `select
         (select count(*)::int from processed_channel_messages where message_mid = $2) as processed_count,
         (select sender_id from unconfirmed_inquiries where firm_id = $1 limit 1) as unconfirmed_sender,
         (select payload from webhook_outbox where firm_id = $1 limit 1) as outbox_payload,
         (select basis_evidence from consent_log where subject_id = $3 limit 1) as consent_evidence,
         (select evidence_payload from content_attribution_evidence where screened_lead_id = $3 limit 1) as attribution_payload,
         (select party_name from screened_conflict_parties where conflict_check_id = $4 limit 1) as party_name`,
      [firmId, inboundMid, leadPk, conflictCheckId],
    );
    expect(secondary.rows[0]).toMatchObject({
      processed_count: 0,
      unconfirmed_sender: null,
      outbox_payload: { privacy_redacted: true },
      consent_evidence: { redacted: true },
      attribution_payload: { redacted: true },
      party_name: "[redacted]",
    });

    const suppressed = await serviceRpc<boolean>(
      `select public.is_channel_subject_privacy_suppressed($1, 'facebook', $2) as result`,
      [firmId, senderId],
    );
    expect(suppressed).toBe(true);

    const pending = await serviceRpc<PendingCleanupRpcResult>(
      `select public.list_pending_screened_lead_privacy_cleanups(100) as result`,
    );
    expect(pending.ok).toBe(true);
    expect(pending.requests).toContainEqual({
      firm_id: firmId,
      screened_lead_id: leadPk,
      current_lead_id: `privacy-redacted:${leadPk}`,
      deletion_request_id: requestId,
    });
  });

  it("serializes transient message claims with redaction in both lock orders", async () => {
    const claimFirstLeadPk = randomUUID();
    const claimFirstPublicId = `privacy-race-${randomUUID()}`;
    const claimFirstSender = `meta-race-${randomUUID()}`;
    const claimFirstMid = `meta-race-mid-${randomUUID()}`;
    const claimFirstRequest = randomUUID();
    const redactFirstLeadPk = randomUUID();
    const redactFirstPublicId = `privacy-race-${randomUUID()}`;
    const redactFirstSender = `meta-race-${randomUUID()}`;
    const redactFirstMid = `meta-race-mid-${randomUUID()}`;
    const redactFirstRequest = randomUUID();
    const claimConn = new Client(parseDirectDatabaseUrl(DB_URL!));
    const redactConn = new Client(parseDirectDatabaseUrl(DB_URL!));
    await claimConn.connect();
    await redactConn.connect();

    async function waitForAdvisoryLock(pid: number) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await conn.query(
          `select wait_event_type, wait_event from pg_stat_activity where pid = $1`,
          [pid],
        );
        if (
          activity.rows[0]?.wait_event_type === "Lock" &&
          activity.rows[0]?.wait_event === "advisory"
        ) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`backend ${pid} did not wait on the privacy advisory lock`);
    }

    try {
      await conn.query(
        `insert into screened_leads
           (id, firm_id, lead_id, brief_json, brief_html, slot_answers,
            matter_type, practice_area, decision_deadline, contact_name)
         values
           ($1, $3, $4, '{}'::jsonb, '', '{}'::jsonb, 'employment', 'employment',
            now() + interval '48 hours', 'Race One'),
           ($2, $3, $5, '{}'::jsonb, '', '{}'::jsonb, 'employment', 'employment',
            now() + interval '48 hours', 'Race Two')`,
        [claimFirstLeadPk, redactFirstLeadPk, firmId, claimFirstPublicId, redactFirstPublicId],
      );
      await conn.query(
        `insert into channel_intake_sessions
           (firm_id, channel, sender_id, engine_state, finalized, screened_lead_id)
         values
           ($1, 'facebook', $2, '{}'::jsonb, true, $3),
           ($1, 'facebook', $4, '{}'::jsonb, true, $5)`,
        [firmId, claimFirstSender, claimFirstLeadPk, redactFirstSender, redactFirstLeadPk],
      );

      // Claim commits first: the waiting redaction must remove that claim.
      await claimConn.query("begin");
      await claimConn.query(
        `insert into processed_channel_messages (firm_id, channel, message_mid, sender_id)
         values ($1, 'facebook', $2, $3)`,
        [firmId, claimFirstMid, claimFirstSender],
      );
      await redactConn.query("begin");
      const redactPid = Number((await redactConn.query(`select pg_backend_pid() as pid`)).rows[0].pid);
      await redactConn.query("set local role service_role");
      const waitingRedaction = redactConn.query(
        `select public.redact_screened_lead_subject($1, $2, 'subject_request', $3) as result`,
        [firmId, claimFirstPublicId, claimFirstRequest],
      );
      await waitForAdvisoryLock(redactPid);
      await claimConn.query("commit");
      const redactionResult = await waitingRedaction;
      await redactConn.query("commit");
      expect(redactionResult.rows[0].result).toMatchObject({ ok: true, redacted_count: 1 });
      const removedClaim = await conn.query(
        `select count(*)::integer as count
           from processed_channel_messages
          where firm_id = $1 and message_mid = $2`,
        [firmId, claimFirstMid],
      );
      expect(removedClaim.rows[0].count).toBe(0);

      // Redaction commits first: the waiting claim must observe the tombstone
      // and fail with the stable suppression error instead of recreating PII.
      await redactConn.query("begin");
      await redactConn.query("set local role service_role");
      await redactConn.query(
        `select public.redact_screened_lead_subject($1, $2, 'subject_request', $3)`,
        [firmId, redactFirstPublicId, redactFirstRequest],
      );
      const claimPid = Number((await claimConn.query(`select pg_backend_pid() as pid`)).rows[0].pid);
      const waitingClaim = claimConn.query(
        `insert into processed_channel_messages (firm_id, channel, message_mid, sender_id)
         values ($1, 'facebook', $2, $3)`,
        [firmId, redactFirstMid, redactFirstSender],
      );
      await waitForAdvisoryLock(claimPid);
      await redactConn.query("commit");
      await expect(waitingClaim).rejects.toMatchObject({
        code: "P0001",
        message: "privacy-suppressed channel subject cannot be claimed",
      });
    } finally {
      await claimConn.query("rollback").catch(() => undefined);
      await redactConn.query("rollback").catch(() => undefined);
      await claimConn.end();
      await redactConn.end();
    }
  }, 30000);

  it("is idempotent across a newly generated retry UUID and rejects UUID reuse for another subject", async () => {
    const exactRetry = await serviceRpc<RedactionRpcResult>(
      `select public.redact_screened_lead_subject($1, $2, 'subject_request', $3) as result`,
      [firmId, `privacy-redacted:${leadPk}`, requestId],
    );
    expect(exactRetry).toMatchObject({ ok: true, redacted_count: 0, deletion_request_id: requestId });

    const retry = await serviceRpc<RedactionRpcResult>(
      `select public.redact_screened_lead_subject($1, $2, 'subject_request', $3) as result`,
      [firmId, publicLeadId, randomUUID()],
    );
    expect(retry).toMatchObject({ ok: true, redacted_count: 0, deletion_request_id: requestId });

    const reused = await serviceRpc<RedactionRpcResult>(
      `select public.redact_screened_lead_subject($1, $2, 'subject_request', $3) as result`,
      [otherFirmId, otherPublicLeadId, requestId],
    );
    expect(reused).toMatchObject({ ok: false, error: "deletion_request_id was already used for another subject" });
  });

  it("keeps direct mutation blocked and fails closed on new subject-linked writes", async () => {
    await expect(
      conn.query(`update channel_conversation_events set body = 'restored' where screened_lead_id = $1`, [leadPk]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      conn.query(`delete from channel_conversation_events where screened_lead_id = $1`, [leadPk]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      conn.query(`update screened_leads set contact_email = 'restored@example.test' where id = $1`, [leadPk]),
    ).rejects.toThrow(/privacy-redacted and immutable/i);
    await expect(
      conn.query(
        `insert into consent_log
           (firm_id, subject_id, channel, event_type, consent_type, consent_status)
         values ($1, $2, 'email', 'implied_set', 'implied_inquiry', 'granted')`,
        [firmId, leadPk],
      ),
    ).rejects.toThrow(/privacy-redacted/i);
    await expect(
      conn.query(
        `insert into channel_intake_sessions
           (firm_id, channel, sender_id, engine_state)
         values ($1, 'facebook', $2, '{}'::jsonb)`,
        [firmId, senderId],
      ),
    ).rejects.toThrow(/privacy-suppressed/i);
    await expect(
      conn.query(
        `insert into unconfirmed_inquiries
           (firm_id, channel, sender_id, raw_transcript, reason)
         values ($1, 'facebook', $2, 'restored private text', 'abandoned')`,
        [firmId, senderId],
      ),
    ).rejects.toThrow(/privacy-suppressed/i);
    await expect(
      conn.query(
        `insert into processed_channel_messages (firm_id, channel, message_mid, sender_id)
         values ($1, 'facebook', $2, $3)`,
        [firmId, `late-processed-${randomUUID()}`, senderId],
      ),
    ).rejects.toMatchObject({
      code: "P0001",
      message: "privacy-suppressed channel subject cannot be claimed",
    });
    await expect(
      conn.query(
        `insert into processed_channel_messages (firm_id, channel, message_mid)
         values ($1, 'facebook', $2)`,
        [firmId, `unbound-processed-${randomUUID()}`],
      ),
    ).rejects.toMatchObject({
      code: "23502",
      message: "processed channel message sender_id is required",
    });
    await expect(
      conn.query(
        `insert into channel_conversation_events
           (screened_lead_id, firm_id, channel, direction, source, body,
            status, meta_message_id, actor_type, actor_id,
            authoritative_inbound, occurred_at)
         values ($1, $2, 'facebook', 'inbound', 'webhook', 'late private text',
           'received', $3, 'lead', $4, true, now())`,
        [leadPk, firmId, `late-mid-${randomUUID()}`, senderId],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      message: "channel conversation event rejected: channel subject is privacy-suppressed",
    });
    await expect(
      conn.query(
        `insert into webhook_outbox
           (firm_id, lead_id, action, idempotency_key, payload, webhook_url)
         values ($1, $2, 'taken', $3, '{}'::jsonb, 'https://example.test/hook')`,
        [firmId, publicLeadId, `late-outbox-${randomUUID()}`],
      ),
    ).rejects.toThrow(/privacy-redacted/i);
    await expect(
      conn.query(
        `update webhook_outbox
            set payload = '{"email":"restored@example.test"}'::jsonb
          where firm_id = $1`,
        [firmId],
      ),
    ).rejects.toThrow(/privacy-redacted and immutable/i);
    await expect(
      conn.query(
        `update unconfirmed_inquiries
            set raw_transcript = 'restored private text'
          where firm_id = $1`,
        [firmId],
      ),
    ).rejects.toThrow(/privacy-redacted and immutable/i);
    await expect(
      conn.query(
        `insert into web_intake_sessions
           (firm_id, lead_id, engine_state, screened_lead_id)
         values ($1, $2, '{"email":"restored@example.test"}'::jsonb, $3)`,
        [firmId, `late-web-${randomUUID()}`, leadPk],
      ),
    ).rejects.toThrow(/privacy-redacted/i);
    await expect(
      conn.query(
        `insert into web_intake_sessions
           (firm_id, lead_id, engine_state, screened_lead_id)
         values ($1, $2, '{"email":"restored@example.test"}'::jsonb, null)`,
        [firmId, publicLeadId],
      ),
    ).rejects.toThrow(/privacy-redacted/i);
    await expect(
      conn.query(
        `insert into voice_turn_sessions
           (call_id, firm_id, engine_state, screened_lead_id)
         values ($1, $2, '{"phone":"+14165550199"}'::jsonb, $3)`,
        [`late-call-${randomUUID()}`, firmId, leadPk],
      ),
    ).rejects.toThrow(/privacy-redacted/i);
    await expect(
      conn.query(
        `insert into outbound_messages
           (firm_id, screened_lead_id, channel, recipient_email, subject, body)
         values ($1, $2, 'email', 'restored@example.test', 'Private', 'Private')`,
        [firmId, leadPk],
      ),
    ).rejects.toThrow(/privacy-redacted/i);
  });

  it("coerces a late outbound terminal event to a redacted envelope", async () => {
    await conn.query(
      `insert into channel_conversation_events
         (screened_lead_id, firm_id, channel, direction, source, body,
          status, meta_message_id, client_request_id, actor_type, actor_id,
          authoritative_inbound, occurred_at, failure_reason)
       values ($1, $2, 'facebook', 'outbound', 'operator', 'pending private reply',
         'sent', $3, $4, 'operator', 'operator@example.test', false, now(), null)`,
      [leadPk, firmId, `late-terminal-${randomUUID()}`, pendingRequestId],
    );

    const terminal = await conn.query(
      `select body, meta_message_id, actor_id, privacy_deletion_request_id
         from channel_conversation_events
        where screened_lead_id = $1 and client_request_id = $2 and status = 'sent'`,
      [leadPk, pendingRequestId],
    );
    expect(terminal.rows[0]).toMatchObject({
      body: "[redacted]",
      meta_message_id: null,
      actor_id: null,
      privacy_deletion_request_id: requestId,
    });
  });

  it("completes external cleanup idempotently with a closed non-PII summary", async () => {
    const invalidSummaries = [
      null,
      [],
      "scalar cleanup summary",
      {
        storage_deleted_count: 0,
        ghl_status: "completed",
        meta_status: "provider_managed",
        resend_status: "completed",
      },
      {
        storage_deleted_count: 0,
        ghl_status: "completed",
        meta_status: null,
        resend_status: "completed",
      },
      {
        storage_deleted_count: 0,
        ghl_status: "completed",
        resend_status: "completed",
      },
      {
        storage_deleted_count: 0,
        ghl_status: "completed",
        meta_status: "unknown",
        resend_status: "completed",
      },
    ];
    for (const invalidSummary of invalidSummaries) {
      const rejected = await serviceRpc<CleanupCompletionRpcResult>(
        `select public.complete_screened_lead_external_cleanup($1, $2, $3::jsonb) as result`,
        [firmId, requestId, JSON.stringify(invalidSummary)],
      );
      expect(rejected).toMatchObject({
        ok: false,
        external_cleanup_status: "pending",
      });
    }
    const stillPending = await conn.query(
      `select external_cleanup_status, external_cleanup_manifest, cleanup_summary
         from privacy_deletion_requests
        where id = $1`,
      [requestId],
    );
    expect(stillPending.rows[0]).toMatchObject({
      external_cleanup_status: "pending",
      cleanup_summary: null,
    });
    expect(stillPending.rows[0].external_cleanup_manifest).not.toEqual({});

    const summary = {
      storage_deleted_count: 0,
      ghl_status: "completed",
      meta_status: "completed",
      resend_status: "not_applicable",
    };
    const first = await serviceRpc<CleanupCompletionRpcResult>(
      `select public.complete_screened_lead_external_cleanup($1, $2, $3::jsonb) as result`,
      [firmId, requestId, JSON.stringify(summary)],
    );
    const second = await serviceRpc<CleanupCompletionRpcResult>(
      `select public.complete_screened_lead_external_cleanup($1, $2, $3::jsonb) as result`,
      [firmId, requestId, JSON.stringify(summary)],
    );
    expect(first).toMatchObject({ ok: true, external_cleanup_status: "complete", cleanup_summary: summary });
    expect(second).toMatchObject({ ok: true, external_cleanup_status: "complete", cleanup_summary: summary });

    const request = await conn.query(
      `select external_cleanup_manifest from privacy_deletion_requests where id = $1`,
      [requestId],
    );
    expect(request.rows[0].external_cleanup_manifest).toEqual({});

    const pending = await serviceRpc<PendingCleanupRpcResult>(
      `select public.list_pending_screened_lead_privacy_cleanups(100) as result`,
    );
    expect(pending.requests).not.toContainEqual(
      expect.objectContaining({ deletion_request_id: requestId }),
    );
  });

  it("reopens legacy complete requests with null, missing, or invalid provider evidence", async () => {
    const legacyLeadIds = [randomUUID(), randomUUID(), randomUUID()];
    const legacyRequestIds = [randomUUID(), randomUUID(), randomUUID()];
    const legacySummaries = [
      {
        storage_deleted_count: 0,
        ghl_status: null,
        meta_status: "completed",
        resend_status: "completed",
      },
      {
        storage_deleted_count: 0,
        ghl_status: "completed",
        resend_status: "not_applicable",
      },
      {
        storage_deleted_count: 0,
        ghl_status: "completed",
        meta_status: "completed",
        resend_status: "unknown",
      },
    ];

    for (let index = 0; index < legacyLeadIds.length; index += 1) {
      await conn.query(
        `insert into screened_leads
           (id, firm_id, lead_id, brief_json, brief_html, slot_answers,
            matter_type, practice_area, decision_deadline)
         values ($1, $2, $3, '{}'::jsonb, '<p>Legacy fixture</p>', '{}'::jsonb,
           'employment', 'employment', now() + interval '48 hours')`,
        [legacyLeadIds[index], firmId, `legacy-privacy-${randomUUID()}`],
      );
      await conn.query(
        `insert into privacy_deletion_requests
           (id, firm_id, screened_lead_id, subject_key_hash, reason,
            database_redacted_at, external_cleanup_status,
            external_cleanup_manifest, external_cleanup_completed_at,
            cleanup_summary)
         values ($1, $2, $3, $4, 'subject_request', now(), 'complete',
           '{}'::jsonb, now(), $5::jsonb)`,
        [
          legacyRequestIds[index],
          firmId,
          legacyLeadIds[index],
          `legacy-subject-${randomUUID()}`,
          JSON.stringify(legacySummaries[index]),
        ],
      );
    }

    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase",
        "migrations",
        "20260903011450_privacy_provider_evidence_required.sql",
      ),
      "utf8",
    );
    await conn.query(migration);

    const reopened = await conn.query(
      `select id, external_cleanup_status, external_cleanup_completed_at,
              cleanup_summary, external_cleanup_manifest
         from privacy_deletion_requests
        where id = any($1::uuid[])
        order by id`,
      [legacyRequestIds],
    );
    expect(reopened.rows).toHaveLength(3);
    for (const request of reopened.rows) {
      expect(request).toMatchObject({
        external_cleanup_status: "pending",
        external_cleanup_completed_at: null,
        cleanup_summary: null,
      });
      expect(request.external_cleanup_manifest).not.toEqual({});
    }
  });

  it("purges only already-redacted events that reached three years from occurred_at", async () => {
    const purge = await serviceRpc<AuditPurgeRpcResult>(
      `select public.purge_expired_privacy_audit_envelopes(100) as result`,
    );
    expect(purge.ok).toBe(true);
    expect(purge.retention_period).toBe("3 years");
    expect(purge.purged_channel_event_count).toBeGreaterThanOrEqual(1);
    expect(purge.purged_consent_event_count).toBe(1);
    expect(purge.purged_attribution_event_count).toBe(1);
    expect(purge.purged_event_count).toBeGreaterThanOrEqual(3);
    expect(purge.has_more).toBe(false);

    const remaining = await conn.query(
      `select status, occurred_at from channel_conversation_events where screened_lead_id = $1`,
      [leadPk],
    );
    expect(remaining.rows.some((row) => row.status === "pending")).toBe(true);
    expect(remaining.rows.every((row) => new Date(row.occurred_at).getTime() > Date.now() - 3 * 366 * 24 * 60 * 60 * 1000)).toBe(true);

    const otherAudit = await conn.query(
      `select
         (select count(*)::integer from consent_log where subject_id = $1) as consent_count,
         (select count(*)::integer from content_attribution_evidence where screened_lead_id = $1) as attribution_count`,
      [leadPk],
    );
    expect(otherAudit.rows[0]).toMatchObject({ consent_count: 0, attribution_count: 0 });
  });
});
