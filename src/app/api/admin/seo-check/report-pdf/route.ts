/**
 * Operator-only, text-based audit PDF rendered server-side with
 * @react-pdf/renderer. Real text layer (selectable, searchable, greppable),
 * unlike a browser window.print() to "Microsoft Print to PDF".
 *
 *   GET  ?id=<uuid>  loads a saved scan from seo_check_runs (Saved audits list).
 *   POST { result }  renders the exact report the operator is viewing right now
 *                    (the report's own "Download PDF" button), no round-trip
 *                    through the database.
 *
 * Both are operator-gated, so the internal prospecting summary a result may
 * carry never reaches a non-operator.
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

async function renderPdfResponse(result: AuditPdfResult): Promise<NextResponse> {
  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(AuditReportPdf({ result }));
  } catch {
    return NextResponse.json({ error: "Could not render the audit PDF." }, { status: 500 });
  }
  const filename = `${safeFilename(result.domain || "audit")}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
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

  return renderPdfResponse(result);
}

export async function POST(req: NextRequest) {
  const session = await getOperatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const result = (body && typeof body === "object" && !Array.isArray(body)
    ? (body as { result?: unknown }).result
    : undefined);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return NextResponse.json({ error: "result is required." }, { status: 400 });
  }
  const typed = result as AuditPdfResult;
  if (!typed.domain || typeof typed.domain !== "string") {
    return NextResponse.json({ error: "result.domain is required." }, { status: 400 });
  }

  return renderPdfResponse(typed);
}
