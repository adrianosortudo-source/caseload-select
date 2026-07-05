/**
 * GET /api/admin/seo-check/report-pdf?id=<uuid>
 *
 * Operator-only. Loads a saved scan from seo_check_runs and streams it as a
 * text-based PDF rendered server-side with @react-pdf/renderer. This replaces
 * the browser window.print() path for audits: the output has a real text layer
 * (selectable, searchable, greppable) and is byte-deterministic for the same
 * saved result, so an exported audit can be QA'd and diffed.
 *
 * Reads a persisted operator scan, whose result carries the internal
 * prospecting summary, so the PDF includes it. The route is operator-gated, so
 * that internal content never reaches a non-operator.
 */

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { AuditReportPdf, type AuditPdfResult } from "../../../tools/seo-check/report-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeFilename(domain: string): string {
  const base = domain.replace(/[^a-z0-9.-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "audit";
  return `seo-audit-${base}`;
}

export async function GET(req: NextRequest) {
  const session = await getOperatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid run id." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("seo_check_runs")
    .select("domain, result, created_at")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Saved audit not found." }, { status: 404 });
  }

  const result = (data.result ?? {}) as AuditPdfResult;
  // The stored result carries its own checkedAt; fall back to the row timestamp.
  if (!result.checkedAt && typeof data.created_at === "string") result.checkedAt = data.created_at;
  if (!result.domain && typeof data.domain === "string") result.domain = data.domain;

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(AuditReportPdf({ result }));
  } catch {
    return NextResponse.json({ error: "Could not render the audit PDF." }, { status: 500 });
  }

  const filename = `${safeFilename(result.domain || String(data.domain || "audit"))}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
