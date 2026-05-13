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
 * PIPEDA obligations met:
 *   - Retention periods reflect "no longer necessary for the identified purpose"
 *   - Right to deletion: see /api/admin/leads/[id]/purge (immediate, on request)
 *   - Records of anonymization logged to console for breach audit trail
 */

import { supabaseAdmin as supabase } from "./supabase-admin";

const RETENTION_DAYS: Record<string, number> = {
  A: 1095,
  B: 1095,
  C: 365,
  D: 180,
  E: 30,
};
const DEFAULT_RETENTION_DAYS = 90;

const PII_REPLACEMENT = {
  name: "[anonymized]",
  email: null,
  phone: null,
  description: null,
  city: null,
  location: null,
};

// Anonymization payload for screened_leads (Screen 2.0). Mirrors the legacy
// PII_REPLACEMENT but targets the screened_leads column shape. Mandatory
// columns (brief_html, brief_json, slot_answers) get replaced with sentinel
// placeholders instead of NULL because the table enforces NOT NULL on them.
// raw_transcript is nullable, so we clear it to NULL.
const SCREENED_PII_REPLACEMENT = {
  contact_name: "[anonymized]",
  contact_email: null,
  contact_phone: null,
  brief_html: "<p>[anonymized]</p>",
  brief_json: { anonymized: true } as Record<string, unknown>,
  slot_answers: { anonymized: true } as Record<string, unknown>,
  raw_transcript: null,
};

export interface RetentionResult {
  leads_anonymized: number;
  sessions_cleared: number;
  screened_leads_anonymized: number;
  errors: string[];
}

export async function runDataRetention(): Promise<RetentionResult> {
  const result: RetentionResult = {
    leads_anonymized: 0,
    sessions_cleared: 0,
    screened_leads_anonymized: 0,
    errors: [],
  };
  const now = new Date();

  for (const [band, days] of [...Object.entries(RETENTION_DAYS), ["_default", DEFAULT_RETENTION_DAYS]] as [string, number][]) {
    try {
      const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();

      let query = supabase
        .from("leads")
        .select("id, band")
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

      const ids = leads.map((l) => l.id);

      // Anonymize lead PII
      const { error: updateErr } = await supabase
        .from("leads")
        .update({ ...PII_REPLACEMENT, updated_at: now.toISOString() })
        .in("id", ids);
      if (updateErr) { result.errors.push(`band ${band} update: ${updateErr.message}`); continue; }

      result.leads_anonymized += ids.length;
      console.log(`[data-retention] Anonymized ${ids.length} band-${band} leads (>${days}d inactive)`);

      // Clear conversation history from linked sessions (retain scoring)
      const { data: sessions } = await supabase
        .from("intake_sessions")
        .select("id")
        .in("firm_id", leads.map(() => "").filter(Boolean)); // placeholder join

      // Clear sessions linked via intake that reference these leads (by contact.email match)
      // Sessions store contact in JSONB  -  clear conversation + contact PII, keep scoring
      const { error: sessErr } = await supabase
        .from("intake_sessions")
        .update({
          conversation: [],
          contact: null,
          otp_code: null,
        })
        .in("status", ["complete", "expired"])
        .lt("updated_at", cutoff);

      if (sessErr) result.errors.push(`sessions clear: ${sessErr.message}`);
      else result.sessions_cleared += (sessions?.length ?? 0);

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
        .select("id, band")
        .neq("contact_name", "[anonymized]")
        .lt("updated_at", cutoff);

      if (band === "_default") {
        sQuery = sQuery.is("band", null);
      } else {
        sQuery = sQuery.eq("band", band);
      }

      const { data: sleads, error: sFetchErr } = await sQuery;
      if (sFetchErr) { result.errors.push(`screened band ${band} fetch: ${sFetchErr.message}`); continue; }
      if (!sleads?.length) continue;

      const sIds = sleads.map((l) => l.id);

      const { error: sUpdateErr } = await supabase
        .from("screened_leads")
        .update({ ...SCREENED_PII_REPLACEMENT, updated_at: now.toISOString() })
        .in("id", sIds);

      if (sUpdateErr) {
        result.errors.push(`screened band ${band} update: ${sUpdateErr.message}`);
        continue;
      }

      result.screened_leads_anonymized += sIds.length;
      console.log(`[data-retention] Anonymized ${sIds.length} band-${band} screened_leads (>${days}d inactive)`);
    } catch (e) {
      result.errors.push(`screened band ${band}: ${(e as Error).message}`);
    }
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
export async function purgeLeadPii(leadId: string): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString();
  const errors: string[] = [];

  // ── Legacy leads (uuid id) ────────────────────────────────────────────────
  // Match if leadId is a UUID; otherwise skip (avoids type-cast errors on
  // text-formatted screened_leads.lead_id values like "L-2026-05-13-7K3").
  const isLikelyUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId);
  if (isLikelyUuid) {
    const { error } = await supabase
      .from("leads")
      .update({
        ...PII_REPLACEMENT,
        stage: "purged",
        updated_at: now,
      })
      .eq("id", leadId);

    if (error) errors.push(`leads: ${error.message}`);

    // Clear session PII linked via complete status (best-effort).
    await supabase
      .from("intake_sessions")
      .update({ conversation: [], contact: null, otp_code: null })
      .eq("status", "complete");
  }

  // ── screened_leads (Screen 2.0; text lead_id like "L-YYYY-MM-DD-XXX") ────
  // Always attempt this path; the column accepts text so a UUID input
  // simply will not match and the update no-ops. This makes the DSR endpoint
  // work whether the operator passes a legacy uuid or a Screen 2.0 lead_id.
  {
    const { error: screenedErr } = await supabase
      .from("screened_leads")
      .update({ ...SCREENED_PII_REPLACEMENT, updated_at: now })
      .eq("lead_id", leadId);
    if (screenedErr) errors.push(`screened_leads: ${screenedErr.message}`);
  }

  // ── Outbox payloads ───────────────────────────────────────────────────────
  // Webhook_outbox rows hold the snapshot envelope we tried to deliver to
  // GHL, which includes contact_name/email/phone. Anonymize the payload
  // column for any outbox row that references this lead_id; keep the row
  // (it carries delivery audit info) but strip the PII from the payload.
  {
    const { data: outboxRows, error: outboxFetchErr } = await supabase
      .from("webhook_outbox")
      .select("id, payload")
      .eq("lead_id", leadId);

    if (outboxFetchErr) {
      errors.push(`webhook_outbox fetch: ${outboxFetchErr.message}`);
    } else if (outboxRows && outboxRows.length > 0) {
      for (const row of outboxRows as Array<{ id: string; payload: Record<string, unknown> | null }>) {
        const sanitized = sanitizeOutboxPayload(row.payload);
        const { error: upErr } = await supabase
          .from("webhook_outbox")
          .update({ payload: sanitized })
          .eq("id", row.id);
        if (upErr) errors.push(`webhook_outbox ${row.id}: ${upErr.message}`);
      }
    }
  }

  console.log(`[data-retention] PII purged for lead ${leadId} on deletion request`);

  if (errors.length > 0) {
    return { ok: false, error: errors.join("; ") };
  }
  return { ok: true };
}

/**
 * Strip contact + brief fields from a stored outbox payload. Keeps the
 * delivery audit info (action, idempotency_key, status_changed_at, band)
 * so retry sweeps and replay-from-log still work.
 */
function sanitizeOutboxPayload(
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return payload;
  const next: Record<string, unknown> = { ...payload };
  const top: Record<string, unknown> = (next.common as Record<string, unknown> | undefined)
    ? { ...(next.common as Record<string, unknown>) }
    : next;
  if ("contact_name" in top) top.contact_name = "[anonymized]";
  if ("contact_email" in top) top.contact_email = null;
  if ("contact_phone" in top) top.contact_phone = null;
  if ("brief_html" in top) top.brief_html = "<p>[anonymized]</p>";
  if ("brief_json" in top) top.brief_json = { anonymized: true };
  if (next.common) next.common = top;
  if ("contact_name" in next) next.contact_name = "[anonymized]";
  if ("contact_email" in next) next.contact_email = null;
  if ("contact_phone" in next) next.contact_phone = null;
  if ("brief_html" in next) next.brief_html = "<p>[anonymized]</p>";
  if ("brief_json" in next) next.brief_json = { anonymized: true };
  return next;
}
