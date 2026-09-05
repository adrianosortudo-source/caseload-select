import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/admin-auth";
import { buildAuthoritativeDrgWebsiteRelease } from "@/lib/drg-authoritative-website-release";

/**
 * POST issues one short-lived immutable DRG website release artifact.
 * It accepts no body: all identity, content, routes, evidence and hashes come
 * from the authoritative current period rows loaded by the server.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  const { periodId } = await params;
  const result = await buildAuthoritativeDrgWebsiteRelease(periodId);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.error === "period not found" ? 404 : 409 });
  return NextResponse.json({ ok: true, release: result.release }, { status: 200 });
}
