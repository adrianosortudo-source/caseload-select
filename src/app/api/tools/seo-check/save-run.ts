/**
 * Shared row-builder and best-effort auto-save for seo_check_runs, used by:
 *   - POST /api/tools/seo-check: auto-saves every OPERATOR scan server-side,
 *     so a scan is recoverable without the operator remembering to click
 *     "Save this scan" on the report.
 *   - POST /api/admin/seo-check/runs: the manual "Save this scan" button on
 *     the report, kept for now because SeoCheckTool.tsx (where that button
 *     lives) is currently frozen under the marketing-site rebuild and cannot
 *     be edited to remove it.
 *
 * Both routes build the identical row shape from a raw SeoCheckResult-shaped
 * object through buildSeoCheckRunRow, so the two save paths cannot drift.
 * A scan an operator both auto-saves and manually saves produces two rows;
 * that duplication is harmless (both are valid snapshots of the same scan),
 * not a correctness bug. Whoever unfreezes the marketing tree next can drop
 * the now-redundant manual button.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRecord) : null;
}

function str(v: unknown, max = 240): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function int01(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null;
}

function nonnegativeInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

function scanMode(v: unknown): "quick" | "standard" | "deep" {
  return v === "standard" || v === "deep" ? v : "quick";
}

function renderingRisk(v: unknown): "low" | "medium" | "high" | null {
  return v === "low" || v === "medium" || v === "high" ? v : null;
}

export interface SeoCheckRunRow {
  domain: string;
  scan_mode: "quick" | "standard" | "deep";
  pages_scanned: number;
  overall_score: number | null;
  ai_search_score: number | null;
  ai_policy_score: number | null;
  grade: string | null;
  rendering_risk: "low" | "medium" | "high" | null;
  issue_count: number;
  result: JsonRecord;
  created_by_lawyer_id: string | null;
}

/** Returns null when the result carries no domain (nothing meaningful to save). */
export function buildSeoCheckRunRow(result: JsonRecord, lawyerId: string | null): SeoCheckRunRow | null {
  const domain = str(result.domain, 255)?.toLowerCase();
  if (!domain) return null;

  const renderingSummary = asRecord(result.renderingSummary);
  const issues = Array.isArray(result.issues) ? result.issues : [];

  return {
    domain,
    scan_mode: scanMode(result.scanMode),
    pages_scanned: nonnegativeInt(result.pagesScanned),
    overall_score: int01(result.overallScore),
    ai_search_score: int01(result.aiSearchScore),
    ai_policy_score: int01(result.aiPolicyScore),
    grade: str(result.grade, 10),
    rendering_risk: renderingRisk(renderingSummary?.risk),
    issue_count: issues.length,
    result,
    created_by_lawyer_id: lawyerId,
  };
}

/**
 * Fire-and-forget insert. Never throws: a save failure must never fail or
 * slow down the operator's scan response.
 */
export async function saveSeoCheckRunBestEffort(result: JsonRecord, lawyerId: string | null): Promise<void> {
  const row = buildSeoCheckRunRow(result, lawyerId);
  if (!row) return;
  try {
    await supabase.from("seo_check_runs").insert(row);
  } catch {
    // Best-effort only; swallow.
  }
}
