/**
 * GET    /api/portal/[firmId]/files/[fileId]    -> short-lived signed URL
 * DELETE /api/portal/[firmId]/files/[fileId]    -> soft-archive (storage kept)
 *
 * Auth: portal session cookie. Lawyers must match firmId; operators can
 * access any firm. Cross-firm access returns 404 (not 403) to avoid leaking
 * file existence across firm boundaries.
 *
 * Signed URLs are valid for 60 seconds and force a download attachment with
 * the original display_name. Every signed URL request logs a 'downloaded'
 * event; every archive logs an 'archived' event.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import {
  getFirmFile,
  getFirmFileSignedUrl,
  archiveFirmFile,
  type ActorContext,
} from "@/lib/firm-files";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; fileId: string }> },
) {
  const { firmId, fileId } = await params;
  const session = await getPortalSession();
  const isAuthorized = !!session && (session.role === "operator" || session.firm_id === firmId);
  if (!session || !isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const file = await getFirmFile(fileId);
  if (!file || file.firm_id !== firmId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (file.archived) {
    return NextResponse.json({ error: "File is archived" }, { status: 410 });
  }

  const actor: ActorContext = { role: session.role, lawyer_id: session.lawyer_id ?? null };
  const signed = await getFirmFileSignedUrl({ file, actor });
  if (!signed.ok) {
    return NextResponse.json({ error: signed.message }, { status: 500 });
  }

  return NextResponse.json({
    url: signed.url,
    expires_in_seconds: signed.expires_in_seconds,
    display_name: file.display_name,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; fileId: string }> },
) {
  const { firmId, fileId } = await params;
  const session = await getPortalSession();
  const isAuthorized = !!session && (session.role === "operator" || session.firm_id === firmId);
  if (!session || !isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const file = await getFirmFile(fileId);
  if (!file || file.firm_id !== firmId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const actor: ActorContext = { role: session.role, lawyer_id: session.lawyer_id ?? null };
  const result = await archiveFirmFile({ file, actor });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, archived: true });
}
