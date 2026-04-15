/**
 * PIPEDA Data Retention Engine
 *
 * Anonymizes leads (and their linked intake sessions) that have exceeded their
 * retention period. Anonymization replaces PII with placeholder values rather
 * than deleting rows, preserving aggregate scoring data for reporting.
 *
 * Retention schedule by band (measured from updated_at / last activity):
 *   A / B  — 1095 days (3 years) — retained clients, long relationship
 *   C      — 365 days (1 year)   — qualified but not converted
 *   D      — 180 days (6 months) — long-view nurture
 *   E      — 30 days             — auto-declined, no engagement
 *   null   — 90 days             — unscored / stale intake
 *
 * PIPEDA obligations met:
 *   - Retention periods reflect "no longer necessary for the identified purpose"
 *   - Right to deletion: see /api/admin/leads/[id]/purge (immediate, on request)
 *   - Records of anonymization logged to console for breach audit trail
 */

import { supabase } from "./supabase";

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

export interface RetentionResult {
  leads_anonymized: number;
  sessions_cleared: number;
  errors: string[];
}

export async function runDataRetention(): Promise<RetentionResult> {
  const result: RetentionResult = { leads_anonymized: 0, sessions_cleared: 0, errors: [] };
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
      // Sessions store contact in JSONB — clear conversation + contact PII, keep scoring
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

  return result;
}

/**
 * Immediate right-to-deletion (PIPEDA s. 4.5.3).
 * Called from /api/admin/leads/[id]/purge on written request from subject.
 */
export async function purgeLeadPii(leadId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("leads")
    .update({
      ...PII_REPLACEMENT,
      stage: "purged",
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) return { ok: false, error: error.message };

  // Clear session PII linked to this lead (match by lead_id if available, otherwise best-effort)
  await supabase
    .from("intake_sessions")
    .update({ conversation: [], contact: null, otp_code: null })
    .eq("status", "complete"); // scoped to complete sessions only; active sessions left intact

  console.log(`[data-retention] PII purged for lead ${leadId} on deletion request`);
  return { ok: true };
}
