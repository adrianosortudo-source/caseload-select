/**
 * PIPEDA erasure for caseload_prospects (DR-114).
 *
 * caseload_prospects holds CaseLoad Select's OWN inbound demand from the
 * public "Start a conversation" flow: name, firm name, email and province.
 * That is personal information, so it needs an erasure path. It does not get
 * a deletion path, for the same reason leads and screened_leads do not:
 * the row is anonymised in place, keeping the non-identifying answers so
 * funnel counts stay correct.
 *
 * The linked caseload_prospect_consent_log row is left completely alone.
 * That table is unconditionally append-only and its ip_address and user_agent
 * are the evidence it exists to be, so they are retained rather than scrubbed.
 * See DR-114 for the reasoning and the CASL section 13 basis.
 *
 * Everything below is a thin wrapper over the anonymize_caseload_prospects
 * SQL function. The replacement itself is defined exactly once, in
 * supabase/migrations/20260808120000_caseload_prospect_erasure.sql, so the
 * operator path and the retention sweep cannot drift apart.
 *
 * No `import "server-only"` here on purpose: the purge route has its own
 * vitest suite, and a real server-only import throws when the test loads the
 * route module. Repo convention for IO libs, see the Developer Gotchas
 * section of CLAUDE.md.
 */

import { supabaseAdmin as supabase } from "./supabase-admin";

export type ProspectAnonymizationReason =
  | "subject_request"
  | "retention_sweep"
  | "internal_test_record";

export const PROSPECT_ANONYMIZATION_REASONS: readonly ProspectAnonymizationReason[] = [
  "subject_request",
  "retention_sweep",
  "internal_test_record",
];

/**
 * Retention period for CaseLoad Select's own prospects, measured from
 * submitted_at. A sales enquiry that has not converted in two years is no
 * longer necessary for the purpose it was collected for (PIPEDA principle
 * 4.5). Consent here was express (a ticked box), so CASL's six-month
 * implied-consent window does not set this number; the retention principle
 * does.
 */
export const PROSPECT_RETENTION_DAYS = 730;

/**
 * Exactly one selector per call, mirroring the SQL function:
 *   prospectId  one row, by id
 *   email       every row for a subject (an erasure request arrives by email)
 *   before      every row submitted before a cutoff (the retention sweep)
 */
export type ProspectErasureSelector =
  | { prospectId: string }
  | { email: string }
  | { before: string };

export interface ProspectErasureResult {
  ok: boolean;
  anonymized_count: number;
  prospect_ids: string[];
  error?: string;
}

export function isProspectAnonymizationReason(
  value: unknown,
): value is ProspectAnonymizationReason {
  return (
    typeof value === "string" &&
    (PROSPECT_ANONYMIZATION_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Count the selectors present on a caller-supplied object. Exported so the
 * route can reject a malformed request with a 400 before touching the
 * database, rather than relying on the function's own error string.
 */
export function countProspectSelectors(input: {
  prospectId?: unknown;
  email?: unknown;
  before?: unknown;
}): number {
  let n = 0;
  if (typeof input.prospectId === "string" && input.prospectId.length > 0) n += 1;
  if (typeof input.email === "string" && input.email.length > 0) n += 1;
  if (typeof input.before === "string" && input.before.length > 0) n += 1;
  return n;
}

export async function anonymizeCaseloadProspects(
  selector: ProspectErasureSelector,
  reason: ProspectAnonymizationReason,
): Promise<ProspectErasureResult> {
  const { data, error } = await supabase.rpc("anonymize_caseload_prospects", {
    p_prospect_id: "prospectId" in selector ? selector.prospectId : null,
    p_email: "email" in selector ? selector.email : null,
    p_before: "before" in selector ? selector.before : null,
    p_reason: reason,
  });

  if (error) {
    return { ok: false, anonymized_count: 0, prospect_ids: [], error: error.message };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    anonymized_count?: number;
    prospect_ids?: string[];
  };

  if (result.ok !== true) {
    return {
      ok: false,
      anonymized_count: 0,
      prospect_ids: [],
      error: result.error ?? "anonymization refused",
    };
  }

  const count = result.anonymized_count ?? 0;
  const ids = Array.isArray(result.prospect_ids) ? result.prospect_ids : [];

  // Console record, same audit-trail convention purgeLeadPii already uses.
  console.log(
    `[caseload-prospect-erasure] anonymized ${count} prospect row(s), reason=${reason}`,
  );

  return { ok: true, anonymized_count: count, prospect_ids: ids };
}

/**
 * The retention sweep's entry point. Called from runDataRetention so the
 * daily cron covers CaseLoad Select's own prospects the same way it covers
 * the client firms' leads.
 */
export async function runProspectRetentionSweep(
  now: Date = new Date(),
): Promise<ProspectErasureResult> {
  const cutoff = new Date(
    now.getTime() - PROSPECT_RETENTION_DAYS * 86_400_000,
  ).toISOString();

  return anonymizeCaseloadProspects({ before: cutoff }, "retention_sweep");
}
