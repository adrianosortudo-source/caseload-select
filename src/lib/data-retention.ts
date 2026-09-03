/**
 * PIPEDA Data Retention Engine
 *
 * Anonymizes leads (and their linked intake sessions) that have exceeded their
 * retention period. Anonymization replaces PII with placeholder values rather
 * than deleting rows, preserving aggregate scoring data for reporting.
 *
 * Retention schedule by band (measured from updated_at / last activity):
 *   A / B   -  1095 days (3 years)  -  retained clients, long relationship
 *   C       -  365 days (1 year)    -  qualified but not converted
 *   D       -  180 days (6 months)  -  long-view nurture
 *   E       -  30 days              -  auto-declined, no engagement
 *   null    -  90 days              -  unscored / stale intake
 *
 * Privacy controls implemented here (subject to the system-wide policy and
 * processor procedures):
 *   - Retention periods reflect "no longer necessary for the identified purpose"
 *   - Verified erasure request: see /api/admin/leads/[id]/purge
 *   - Non-identifying redaction audit facts are retained by the database workflow
 */

import { supabaseAdmin as supabase } from "./supabase-admin";
import { runProspectRetentionSweep } from "./caseload-prospect-erasure";
import {
  eraseScreenedLead,
  listPendingScreenedLeadPrivacyCleanups,
  purgeExpiredPrivacyAuditEnvelopes,
  removeIntakeSessionAttachments,
  type CleanupCompletionStatus,
  type ManualCleanupCompletionStatus,
  type PendingScreenedLeadPrivacyCleanup,
  type ScreenedLeadRedactionReason,
} from "./screened-lead-erasure";
import { randomUUID } from "node:crypto";

const RETENTION_DAYS: Record<string, number> = {
  A: 1095,
  B: 1095,
  C: 365,
  D: 180,
  E: 30,
};
const DEFAULT_RETENTION_DAYS = 90;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_SCREEN_LEAD_PREFIX = "L-S1-";
const PENDING_PRIVACY_CLEANUP_LIMIT = 100;
const PRIVACY_AUDIT_EXPIRY_BATCH_LIMIT = 100;
const PRIVACY_AUDIT_EXPIRY_MAX_BATCHES = 100;

const PII_REPLACEMENT = {
  name: "[anonymized]",
  email: null,
  phone: null,
  description: null,
  city: null,
  location: null,
};

const LEGACY_SESSION_PII_REPLACEMENT = {
  conversation: [] as unknown[],
  contact: {},
  extracted_entities: {},
  situation_summary: null,
  round3_answers: null,
  memo_text: null,
  otp_code: null,
  otp_expires_at: null,
  otp_verified: false,
};

export interface RetentionResult {
  leads_anonymized: number;
  sessions_cleared: number;
  screened_leads_anonymized: number;
  caseload_prospects_anonymized: number;
  privacy_audit_requests_expired: number;
  privacy_audit_events_purged: number;
  privacy_audit_channel_events_purged: number;
  privacy_audit_consent_events_purged: number;
  privacy_audit_attribution_events_purged: number;
  privacy_audit_remaining_eligible: number;
  privacy_cleanup_retries: number;
  privacy_cleanup_completed: number;
  errors: string[];
}

export async function runDataRetention(): Promise<RetentionResult> {
  const result: RetentionResult = {
    leads_anonymized: 0,
    sessions_cleared: 0,
    screened_leads_anonymized: 0,
    caseload_prospects_anonymized: 0,
    privacy_audit_requests_expired: 0,
    privacy_audit_events_purged: 0,
    privacy_audit_channel_events_purged: 0,
    privacy_audit_consent_events_purged: 0,
    privacy_audit_attribution_events_purged: 0,
    privacy_audit_remaining_eligible: 0,
    privacy_cleanup_retries: 0,
    privacy_cleanup_completed: 0,
    errors: [],
  };
  const now = new Date();

  // Resume non-transactional cleanup from durable pending requests before
  // selecting new retention candidates. This closes the crash gap where the
  // database transaction committed but Storage/provider acknowledgement did
  // not. Manual-required providers remain an explicit cron failure until an
  // operator records their completion through the purge route.
  try {
    const pending = await listPendingScreenedLeadPrivacyCleanups(
      PENDING_PRIVACY_CLEANUP_LIMIT,
    );
    if (!pending.ok) {
      result.errors.push(`pending privacy cleanup listing: ${pending.error}`);
    } else {
      if (pending.pending_count >= PENDING_PRIVACY_CLEANUP_LIMIT) {
        result.errors.push(
          "pending privacy cleanup listing reached its 100-request safety limit; later requests may require a cursor-capable recovery RPC",
        );
      }
      for (const request of pending.requests) {
        result.privacy_cleanup_retries += 1;
        const retry = await eraseScreenedLead({
          firmId: request.firm_id,
          leadId: request.current_lead_id,
          reason: "retention_sweep",
          deletionRequestId: request.deletion_request_id,
        });
        if (retry.ok) {
          result.privacy_cleanup_completed += 1;
        } else {
          result.errors.push(
            `pending privacy cleanup: ${retry.error ?? "cleanup incomplete"}`,
          );
        }
      }
    }
  } catch (error) {
    result.errors.push(`pending privacy cleanup listing: ${(error as Error).message}`);
  }

  for (const [band, days] of [...Object.entries(RETENTION_DAYS), ["_default", DEFAULT_RETENTION_DAYS]] as [string, number][]) {
    try {
      const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();

      let query = supabase
        .from("leads")
        .select("id, band, intake_session_id")
        .neq("name", "[anonymized]") // skip already-anonymized rows
        .lt("updated_at", cutoff);

      if (band === "_default") {
        query = query.is("band", null);
      } else {
        query = query.eq("band", band);
      }

      const { data: leads, error } = await query;
      if (error) { result.errors.push(`band ${band} fetch: ${error.message}`); continue; }
      if (!leads?.length) continue;

      let bandCount = 0;
      for (const lead of leads as Array<{
        id: string;
        intake_session_id: string | null;
      }>) {
        const purge = await purgeLegacyLeadRecord({
          leadId: lead.id,
          intakeSessionId: lead.intake_session_id,
          nowIso: now.toISOString(),
          markPurged: false,
        });
        if (!purge.ok) {
          result.errors.push(`band ${band} legacy purge: ${purge.error}`);
          continue;
        }
        result.leads_anonymized += purge.lead_anonymized ? 1 : 0;
        result.sessions_cleared += purge.session_cleared ? 1 : 0;
        bandCount += purge.lead_anonymized ? 1 : 0;
      }
      if (bandCount > 0) {
        console.log(
          `[data-retention] Anonymized ${bandCount} band-${band} legacy leads (>${days}d inactive)`,
        );
      }

    } catch (e) {
      result.errors.push(`band ${band}: ${(e as Error).message}`);
    }
  }

  // ─── screened_leads (Screen 2.0) ──────────────────────────────────────────
  //
  // Same band-based retention schedule applies. The triple-write columns
  // (brief_html, brief_json, slot_answers) are NOT NULL so we use sentinel
  // placeholders rather than NULL; raw_transcript is nullable and is cleared
  // outright. PII columns (contact_name/email/phone) anonymize the same way
  // legacy leads do.
  //
  // We retain band, scores, lifecycle status, and dates so the operator's
  // analytics surface and the firm's KPI tiles still produce correct
  // historical counts after PII has been stripped.
  for (const [band, days] of [...Object.entries(RETENTION_DAYS), ["_default", DEFAULT_RETENTION_DAYS]] as [string, number][]) {
    try {
      const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();

      let sQuery = supabase
        .from("screened_leads")
        .select("id, lead_id, firm_id, band")
        .is("privacy_redacted_at", null)
        .lt("updated_at", cutoff);

      if (band === "_default") {
        sQuery = sQuery.is("band", null);
      } else {
        sQuery = sQuery.eq("band", band);
      }

      const { data: sleads, error: sFetchErr } = await sQuery;
      if (sFetchErr) { result.errors.push(`screened band ${band} fetch: ${sFetchErr.message}`); continue; }
      if (!sleads?.length) continue;

      let bandCount = 0;
      for (const lead of sleads as Array<{
        id: string;
        lead_id: string;
        firm_id: string;
      }>) {
        const erased = await eraseScreenedLead({
          firmId: lead.firm_id,
          leadId: lead.lead_id,
          reason: "retention_sweep",
          deletionRequestId: randomUUID(),
        });
        result.screened_leads_anonymized += erased.redacted_count;
        bandCount += erased.redacted_count;
        if (!erased.ok) {
          result.errors.push(
            `screened band ${band} erase: ${erased.error ?? "cleanup incomplete"}`,
          );
          continue;
        }
      }
      if (bandCount > 0) {
        console.log(
          `[data-retention] Anonymized ${bandCount} band-${band} screened_leads (>${days}d inactive)`,
        );
      }
    } catch (e) {
      result.errors.push(`screened band ${band}: ${(e as Error).message}`);
    }
  }

  // The database owns the fixed three-year maximum and does not accept a
  // caller-supplied cutoff. A failure is part of the retention result, never a
  // best-effort warning, because otherwise stale audit envelopes accumulate
  // behind a superficially successful cron response.
  try {
    for (let batch = 0; batch < PRIVACY_AUDIT_EXPIRY_MAX_BATCHES; batch += 1) {
      const expiry = await purgeExpiredPrivacyAuditEnvelopes(
        PRIVACY_AUDIT_EXPIRY_BATCH_LIMIT,
      );
      if (!expiry.ok) {
        result.errors.push(`privacy audit expiry: ${expiry.error}`);
        break;
      }
      result.privacy_audit_requests_expired += expiry.eligible_request_count;
      result.privacy_audit_events_purged += expiry.purged_event_count;
      result.privacy_audit_channel_events_purged +=
        expiry.purged_channel_event_count;
      result.privacy_audit_consent_events_purged +=
        expiry.purged_consent_event_count;
      result.privacy_audit_attribution_events_purged +=
        expiry.purged_attribution_event_count;
      result.privacy_audit_remaining_eligible = expiry.remaining_eligible_count;
      if (!expiry.has_more) break;
      if (batch === PRIVACY_AUDIT_EXPIRY_MAX_BATCHES - 1) {
        result.errors.push(
          `privacy audit expiry: safety cap reached with ${expiry.remaining_eligible_count} eligible records remaining`,
        );
      }
    }
  } catch (error) {
    result.errors.push(`privacy audit expiry: ${(error as Error).message}`);
  }

  // ─── caseload_prospects (CaseLoad Select's own inbound demand) ────────────
  //
  // Not band-based: these are sales enquiries about CaseLoad Select itself,
  // not legal matters, so there is no CPI band to key a schedule off. One flat
  // period from submitted_at (PROSPECT_RETENTION_DAYS, see DR-114).
  //
  // Anonymised, never deleted: deletion is structurally blocked because the
  // linked consent evidence is append-only and must outlive the prospect row.
  // The replacement itself lives in the anonymize_caseload_prospects SQL
  // function so this sweep and the operator purge route cannot drift.
  try {
    const sweep = await runProspectRetentionSweep(now);
    if (sweep.ok) {
      result.caseload_prospects_anonymized = sweep.anonymized_count;
      if (sweep.anonymized_count > 0) {
        console.log(
          `[data-retention] Anonymized ${sweep.anonymized_count} caseload_prospects rows past retention`,
        );
      }
    } else {
      result.errors.push(`caseload_prospects: ${sweep.error}`);
    }
  } catch (e) {
    result.errors.push(`caseload_prospects: ${(e as Error).message}`);
  }

  return result;
}

/**
 * Immediate right-to-deletion (PIPEDA s. 4.5.3).
 * Called from /api/admin/leads/[id]/purge on written request from subject.
 *
 * The `id` parameter accepts EITHER:
 *   - leads.id (uuid) for legacy leads
 *   - screened_leads.lead_id (text, "L-YYYY-MM-DD-XXX") for Screen 2.0 rows
 *
 * Both paths are attempted; whichever matches gets anonymized. A request
 * that does not match either is treated as a no-op success — DSR endpoints
 * intentionally do not reveal whether a row existed (enumeration defence).
 */
interface LegacyLeadPurgeResult {
  ok: boolean;
  matched: boolean;
  lead_anonymized: boolean;
  session_cleared: boolean;
  attachments_removed: number;
  error?: string;
}
async function scrubWebhookOutbox(leadId: string): Promise<string[]> {
  const errors: string[] = [];
  const { data: outboxRows, error: outboxFetchErr } = await supabase
    .from("webhook_outbox")
    .select("id, status, attempts, max_attempts")
    .eq("lead_id", leadId);

  if (outboxFetchErr) return [`webhook_outbox fetch: ${outboxFetchErr.message}`];
  for (const row of (outboxRows ?? []) as Array<{
    id: string;
    status: string;
    attempts: number;
    max_attempts: number;
  }>) {
    const nowIso = new Date().toISOString();
    const update: Record<string, unknown> = {
      lead_id: `privacy-redacted:${row.id}`,
      idempotency_key: `privacy-redacted:${row.id}`,
      payload: { privacy_redacted: true },
      webhook_url: "[redacted]",
      last_error:
        row.status === "failed" || row.status === "pending" ? "[redacted]" : null,
      updated_at: nowIso,
    };
    if (row.status === "pending") {
      update.status = "failed";
      update.attempts = row.max_attempts;
      update.next_attempt_at = nowIso;
      update.failed_at = nowIso;
    }
    const { error } = await supabase
      .from("webhook_outbox")
      .update(update)
      .eq("id", row.id);
    if (error) errors.push(`webhook_outbox update: ${error.message}`);
  }
  return errors;
}

async function purgeLegacyLeadRecord(args: {
  leadId: string;
  intakeSessionId: string | null;
  nowIso: string;
  markPurged: boolean;
  expectedFirmId?: string;
}): Promise<LegacyLeadPurgeResult> {
  const errors: string[] = [];
  let sessionCleared = false;
  let attachmentsRemoved = 0;
  let attachmentScope: { firmId: string; sessionId: string } | null = null;

  if (args.intakeSessionId) {
    const { data: session, error: sessionFetchError } = await supabase
      .from("intake_sessions")
      .select("id, firm_id")
      .eq("id", args.intakeSessionId)
      .maybeSingle();
    if (sessionFetchError) {
      return {
        ok: false,
        matched: true,
        lead_anonymized: false,
        session_cleared: false,
        attachments_removed: 0,
        error: `intake session fetch: ${sessionFetchError.message}`,
      };
    }
    if (
      args.expectedFirmId &&
      (!session || session.firm_id !== args.expectedFirmId)
    ) {
      return {
        ok: true,
        matched: false,
        lead_anonymized: false,
        session_cleared: false,
        attachments_removed: 0,
      };
    }
    if (session) {
      attachmentScope = {
        firmId: (session.firm_id as string | null) ?? "unknown",
        sessionId: args.intakeSessionId,
      };
    }
  } else if (args.expectedFirmId) {
    // A legacy lead without its intake session cannot be tenant-scoped to an
    // intake firm. Refuse the scoped request instead of guessing ownership.
    return {
      ok: true,
      matched: false,
      lead_anonymized: false,
      session_cleared: false,
      attachments_removed: 0,
    };
  }

  if (args.intakeSessionId && attachmentScope) {
    const { error: sessionError } = await supabase
      .from("intake_sessions")
      .update(LEGACY_SESSION_PII_REPLACEMENT)
      .eq("id", args.intakeSessionId)
      .eq("firm_id", attachmentScope.firmId);
    if (sessionError) {
      return {
        ok: false,
        matched: true,
        lead_anonymized: false,
        session_cleared: false,
        attachments_removed: 0,
        error: `intake session: ${sessionError.message}`,
      };
    }
    sessionCleared = true;
  }

  const leadUpdate: Record<string, unknown> = {
    ...PII_REPLACEMENT,
    updated_at: args.nowIso,
  };
  if (args.markPurged) leadUpdate.stage = "purged";
  const { error: leadError } = await supabase
    .from("leads")
    .update(leadUpdate)
    .eq("id", args.leadId);
  if (leadError) errors.push(`leads: ${leadError.message}`);

  if (attachmentScope) {
    const cleanup = await removeIntakeSessionAttachments(
      attachmentScope.firmId,
      attachmentScope.sessionId,
    );
    attachmentsRemoved = cleanup.removed;
    if (!cleanup.ok) errors.push(cleanup.error ?? "intake attachment cleanup incomplete");
  }
  errors.push(...(await scrubWebhookOutbox(args.leadId)));

  return {
    ok: errors.length === 0,
    matched: true,
    lead_anonymized: !leadError,
    session_cleared: sessionCleared,
    attachments_removed: attachmentsRemoved,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}
async function findScreenedLeadTarget(
  leadRef: string,
  expectedFirmId?: string,
): Promise<{ id: string; lead_id: string; firm_id: string } | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadRef);
  for (const column of isUuid ? ["id", "lead_id"] : ["lead_id"]) {
    let query = supabase
      .from("screened_leads")
      .select("id, lead_id, firm_id")
      .eq(column, leadRef);
    if (expectedFirmId) query = query.eq("firm_id", expectedFirmId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`screened lead lookup: ${error.message}`);
    if (data) return data as { id: string; lead_id: string; firm_id: string };
  }
  return null;
}

function legacySessionIdFromScreenLeadId(leadId: string): string | null {
  if (!leadId.startsWith(LEGACY_SCREEN_LEAD_PREFIX)) return null;
  const sessionId = leadId.slice(LEGACY_SCREEN_LEAD_PREFIX.length);
  return UUID_RE.test(sessionId) ? sessionId : null;
}

async function findPendingCleanupByRequestId(
  deletionRequestId: string,
  expectedFirmId?: string,
): Promise<PendingScreenedLeadPrivacyCleanup | null> {
  const pending = await listPendingScreenedLeadPrivacyCleanups(1000);
  if (!pending.ok) {
    throw new Error(`pending privacy cleanup listing: ${pending.error}`);
  }
  const request = pending.requests.find(
    (candidate) => candidate.deletion_request_id === deletionRequestId,
  );
  if (!request) return null;
  if (expectedFirmId && request.firm_id !== expectedFirmId) return null;
  return request;
}

async function findLegacyScreenSessionFirm(
  sessionId: string,
  expectedFirmId?: string,
): Promise<string | null> {
  const { data: session, error: sessionFetchError } = await supabase
    .from("intake_sessions")
    .select("id, firm_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionFetchError) {
    throw new Error(`intake session fetch: ${sessionFetchError.message}`);
  }
  if (!session) return null;
  const firmId = session.firm_id as string | null;
  if (!firmId || (expectedFirmId && firmId !== expectedFirmId)) return null;
  return firmId;
}

export interface PurgeLeadPiiOptions {
  firmId?: string;
  reason?: ScreenedLeadRedactionReason;
  deletionRequestId?: string;
  externalCleanup?: {
    ghlStatus?: ManualCleanupCompletionStatus;
    metaStatus?: CleanupCompletionStatus;
    resendStatus?: CleanupCompletionStatus;
  };
}
export interface PurgeLeadPiiResult {
  ok: boolean;
  deletion_request_id: string;
  screened_lead_redacted: boolean;
  legacy_lead_anonymized: boolean;
  external_cleanup_status: string;
  error?: string;
}

export async function purgeLeadPii(
  leadId: string,
  options: PurgeLeadPiiOptions = {},
): Promise<PurgeLeadPiiResult> {
  let deletionRequestId = options.deletionRequestId ?? randomUUID();
  const errors: string[] = [];
  let screenedLeadRedacted = false;
  let legacyLeadAnonymized = false;
  let externalCleanupStatus = "not_applicable";

  try {
    const target = await findScreenedLeadTarget(leadId, options.firmId);
    const legacyScreenSessionId = legacySessionIdFromScreenLeadId(leadId);
    const legacyScreenFirmId =
      !target && legacyScreenSessionId
        ? await findLegacyScreenSessionFirm(
            legacyScreenSessionId,
            options.firmId,
          )
        : null;
    // A redacted row no longer carries its original public lead_id, so an
    // idempotent retry may not be discoverable through the table lookup. A
    // tenant-scoped call can ask the enumeration-safe RPC to resolve the
    // original id; a request-scoped call can recover the current id below.
    let screenedTarget = target
      ? { firmId: target.firm_id, leadId: target.lead_id }
      : options.firmId || legacyScreenFirmId
        ? { firmId: options.firmId ?? legacyScreenFirmId!, leadId }
        : null;
    if (!screenedTarget && options.deletionRequestId) {
      const pending = await findPendingCleanupByRequestId(
        options.deletionRequestId,
        options.firmId,
      );
      if (pending) {
        screenedTarget = {
          firmId: pending.firm_id,
          leadId: pending.current_lead_id,
        };
      } else if (options.externalCleanup) {
        // External completion must never become an enumeration-safe no-op: an
        // operator supplied evidence for a specific durable request, so losing
        // that request is an actionable failure.
        errors.push("pending privacy cleanup request not found");
      }
    }
    if (screenedTarget) {
      const erased = await eraseScreenedLead({
        firmId: screenedTarget.firmId,
        leadId: screenedTarget.leadId,
        reason: options.reason ?? "subject_request",
        deletionRequestId,
        externalCleanup: options.externalCleanup,
      });
      deletionRequestId = erased.deletion_request_id;
      screenedLeadRedacted = erased.database_redacted;
      externalCleanupStatus = erased.external_cleanup_status;
      if (!erased.ok) errors.push(erased.error ?? "screened lead cleanup incomplete");
    }
  } catch (error) {
    errors.push((error as Error).message);
  }

  const isLikelyUuid = UUID_RE.test(leadId);
  if (isLikelyUuid) {
    const { data: legacy, error: legacyFetchError } = await supabase
      .from("leads")
      .select("id, intake_session_id")
      .eq("id", leadId)
      .maybeSingle();
    if (legacyFetchError) {
      errors.push(`legacy lead fetch: ${legacyFetchError.message}`);
    } else if (legacy) {
      const purge = await purgeLegacyLeadRecord({
        leadId: legacy.id as string,
        intakeSessionId: (legacy.intake_session_id as string | null) ?? null,
        nowIso: new Date().toISOString(),
        markPurged: true,
        expectedFirmId: options.firmId,
      });
      legacyLeadAnonymized = purge.lead_anonymized;
      if (!purge.ok) errors.push(purge.error ?? "legacy lead cleanup incomplete");
    }
  }

  console.log(
    `[data-retention] deletion request processed; screened=${screenedLeadRedacted}; legacy=${legacyLeadAnonymized}; external=${externalCleanupStatus}`,
  );
  return {
    ok: errors.length === 0,
    deletion_request_id: deletionRequestId,
    screened_lead_redacted: screenedLeadRedacted,
    legacy_lead_anonymized: legacyLeadAnonymized,
    external_cleanup_status: externalCleanupStatus,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}
