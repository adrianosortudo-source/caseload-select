/**
 * GET /api/portal/[firmId]/intake-file?path=<storage_path>
 *
 * Authorized signer for intake attachments. The intake-attachments bucket is
 * private (F9 fix); a lead's uploaded file (ID scan, incident photo, PDF) is
 * referenced in the brief by THIS route, not by a public URL. When the firm's
 * lawyer (or the operator) opens it, this route mints a short-lived signed URL
 * and 302-redirects to it.
 *
 * Auth: operator (cross-firm) OR a lawyer whose firm_id matches; client
 * sessions rejected. The cookie is path "/", so it rides on this request.
 *
 * Scope: the requested path MUST start with `{firmId}/` (the storage layout is
 * `{firmId}/{sessionId}/{ts}-{file}`), so a lawyer can only ever sign their own
 * firm's objects, and an operator only signs the firm named in the URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const BUCKET = "intake-attachments";
const SIGNED_URL_TTL = 300; // 5 minutes

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;

  const session = await getPortalSession();
  if (
    !session ||
    session.role === "client" ||
    (session.role !== "operator" && session.firm_id !== firmId)
  ) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const path = req.nextUrl.searchParams.get("path");
  if (!path || !path.startsWith(`${firmId}/`)) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}
