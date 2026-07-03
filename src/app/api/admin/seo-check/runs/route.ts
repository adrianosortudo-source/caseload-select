/**
 * /api/admin/seo-check/runs
 *
 * Operator-only saved-scan history for the canonical /admin/seo-check tool.
 * Stores the full SeoCheckResult JSON from a single-domain scan so an
 * operator can revisit a prior run without re-crawling. Distinct from
 * seo_audit_runs (the prospecting-diagnostic table): that one requires a
 * prospect firm name and wraps the result in an ACTS-narrative "diagnostic"
 * object; this table is a plain save of the operator scan as-is.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export async function GET(req: NextRequest) {
  const session = await getOperatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = str(searchParams.get("id"), 80);
  const domain = str(searchParams.get("domain"), 255);
  const limitRaw = Number(searchParams.get("limit") || 25);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 25;

  if (id) {
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid run id." }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("seo_check_runs")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ run: data });
  }

  let query = supabase
    .from("seo_check_runs")
    .select("id, domain, scan_mode, pages_scanned, overall_score, ai_search_score, ai_policy_score, grade, rendering_risk, issue_count, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (domain) query = query.eq("domain", domain.toLowerCase());

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getOperatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: JsonRecord;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const result = asRecord(body.result);
  if (!result) return NextResponse.json({ error: "result is required." }, { status: 400 });

  const domain = str(result.domain, 255)?.toLowerCase();
  if (!domain) return NextResponse.json({ error: "result.domain is required." }, { status: 400 });

  const renderingSummary = asRecord(result.renderingSummary);
  const issues = Array.isArray(result.issues) ? result.issues : [];

  const row = {
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
    created_by_lawyer_id: session.lawyer_id || null,
  };

  const { data, error } = await supabase
    .from("seo_check_runs")
    .insert(row)
    .select("id, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, run: data }, { status: 201 });
}
