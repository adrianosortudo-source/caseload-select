/**
 * GET /api/admin/content-periods/[periodId]/publication-manifest
 *
 * Read-only, operator-only release manifest for a content period.
 * Publishing and asset generation are not exposed anywhere in this route;
 * see PublicationManifest.policy in publication-manifest.ts for the
 * explicit, machine-readable statement of what this data does and does
 * not authorize.
 *
 * Auth: operator session (requireOperator) OR Bearer CRON_SECRET /
 * PG_CRON_TOKEN, matching the admin/webhook-outbox precedent, so the
 * manifest can also be pulled by an operator script without a browser
 * session.
 *
 * Query params:
 *   format   json (default) | markdown
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getOperatorSession } from "@/lib/portal-auth";
import { buildPublicationManifest, renderManifestMarkdown } from "@/lib/publication-manifest";

export async function GET(req: NextRequest, { params }: { params: Promise<{ periodId: string }> }) {
  const cronAuthed = isCronAuthorized(req);
  if (!cronAuthed) {
    const denied = await requireOperator();
    if (denied) return denied;
  }

  const { periodId } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "markdown" ? "markdown" : "json";

  const operatorSession = cronAuthed ? null : await getOperatorSession();
  const result = await buildPublicationManifest(periodId, operatorSession?.lawyer_id ?? null);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.error === "period not found" ? 404 : 500 });
  }

  if (format === "markdown") {
    return new NextResponse(renderManifestMarkdown(result.manifest), {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  }

  return NextResponse.json({ ok: true, manifest: result.manifest }, { status: 200 });
}
