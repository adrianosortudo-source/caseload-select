/**
 * /api/admin/prospecting-diagnostic/runs
 *
 * Operator-only persistence for internal SEO/prospecting diagnostics.
 * The table is service-role only; this route is the tenant/security guard.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(v: unknown): JsonRecord | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as JsonRecord : null;
}

function str(v: unknown, max = 240): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function strList(v: unknown, max = 10): string[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))].slice(0, max)
    : [];
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
      .from("seo_audit_runs")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ run: data });
  }

  let query = supabase
    .from("seo_audit_runs")
    .select("id, prospect_firm_name, primary_domain, market, practice_focus, target_keyword, scan_mode, pages_scanned, total_pages_scanned, overall_score, ai_search_score, intent_score, prospect_fit_score, website_maturity, urgency_level, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (domain) query = query.eq("primary_domain", domain.toLowerCase());

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

  const diagnostic = asRecord(body.diagnostic);
  if (!diagnostic) return NextResponse.json({ error: "diagnostic is required." }, { status: 400 });

  const prospect = asRecord(diagnostic.prospect);
  const scanSummary = asRecord(diagnostic.scanSummary);
  const scans = Array.isArray(body.scans) ? body.scans : [];
  const primaryScan = scans.find((s) => asRecord(s)?.role === "primary");
  const primaryResult = asRecord(asRecord(primaryScan)?.result);
  const internalSummary = asRecord(primaryResult?.internalSummary);
  const intentAlignment = asRecord(primaryResult?.intentAlignment);

  const prospectFirmName = str(prospect?.firmName, 255);
  const primaryDomain = str(prospect?.primaryDomain, 255)?.toLowerCase();
  if (!prospectFirmName || !primaryDomain) {
    return NextResponse.json({ error: "diagnostic.prospect.firmName and primaryDomain are required." }, { status: 400 });
  }

  const row = {
    prospect_firm_name: prospectFirmName,
    primary_domain: primaryDomain,
    market: str(prospect?.market, 160),
    practice_focus: str(prospect?.practiceFocus, 240),
    target_keyword: str(body.targetKeyword, 240),
    alternate_domains: strList(prospect?.alternateDomains, 10),
    competitor_domains: strList(prospect?.competitors, 10),
    scan_mode: scanMode(scanSummary?.scanMode),
    pages_scanned: nonnegativeInt(scanSummary?.pagesScanned),
    total_pages_scanned: nonnegativeInt(scanSummary?.totalPagesScanned),
    overall_score: int01(primaryResult?.overallScore),
    ai_search_score: int01(primaryResult?.aiSearchScore),
    intent_score: int01(intentAlignment?.score),
    prospect_fit_score: int01(internalSummary?.prospectFitScore),
    website_maturity: str(internalSummary?.websiteMaturity, 20),
    urgency_level: str(internalSummary?.urgencyLevel, 20),
    diagnostic,
    scans,
    created_by_operator_firm_id: session.firm_id || null,
    created_by_lawyer_id: session.lawyer_id || null,
  };

  const { data, error } = await supabase
    .from("seo_audit_runs")
    .insert(row)
    .select("id, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, run: data }, { status: 201 });
}
