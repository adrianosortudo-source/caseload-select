/**
 * POST /api/admin/firms/[firmId]/files
 *
 * Programmatic upload into a firm's portal Files hub for headless automation
 * (cowork CLI, scheduled jobs) that cannot drive the browser file picker.
 *
 * Mirrors the UI upload (POST /api/portal/[firmId]/files) exactly: it calls the
 * same uploadFirmFile() path, so the firm_files row shape, storage bucket,
 * storage-path convention, private visibility, and section semantics are
 * identical. A file pushed here appears in /portal/[firmId]/files
 * indistinguishably from a UI upload, tagged "From operator".
 *
 * Auth (operator scope, DR-063 "the route is the gate"):
 *   - Authorization: Bearer <CRON_SECRET | PG_CRON_TOKEN>   (headless curl)
 *   - or an operator session cookie
 *   Client and lawyer sessions are rejected: cron auth ignores cookies, and
 *   getOperatorSession returns null for non-operator sessions.
 *
 * Body, either:
 *   - multipart/form-data:  file=<binary>, section=<enum>, note=<optional>
 *   - application/json:      { filename, contentType, base64, section, note? }
 *
 * section is one of: brand | strategy | reports | assets | admin
 * 100 MB cap, filename sanitised, mime allow-list enforced inside
 * uploadFirmFile. All Storage + firm_files writes go through supabaseAdmin
 * (service role), per the Database Access Invariant. No anon/authenticated
 * grants are widened.
 *
 * Returns the created firm_files record plus a 60-second signed URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  uploadFirmFile,
  getFirmFileSignedUrl,
  type ActorContext,
} from "@/lib/firm-files";
import { isValidSection, MAX_FILE_SIZE_BYTES, FILE_SECTIONS } from "@/lib/firm-files-pure";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;

  // Auth: a valid bearer cron token OR an operator session cookie.
  const cronAuthed = isCronAuthorized(req);
  const operatorSession = cronAuthed ? null : await getOperatorSession();
  if (!cronAuthed && !operatorSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse the body: multipart/form-data (file picker / curl -F) or JSON base64.
  const contentType = req.headers.get("content-type") ?? "";
  let section = "";
  let note: string | null = null;
  let filename = "";
  let mimeType = "";
  let blob: Blob | null = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const fileEntry = form.get("file");
      if (!(fileEntry instanceof Blob)) {
        return NextResponse.json({ error: "file field is required" }, { status: 400 });
      }
      blob = fileEntry;
      filename =
        fileEntry instanceof File && fileEntry.name
          ? fileEntry.name
          : (form.get("filename") as string | null) ?? "";
      mimeType = fileEntry.type ?? "";
      section = (form.get("section") as string | null) ?? "";
      note = ((form.get("note") as string | null) ?? "").trim() || null;
    } else {
      const json = (await req.json()) as {
        filename?: string;
        contentType?: string;
        base64?: string;
        section?: string;
        note?: string;
      };
      section = json.section ?? "";
      note = (json.note ?? "").trim() || null;
      filename = json.filename ?? "";
      mimeType = json.contentType ?? "";
      const base64 = json.base64 ?? "";
      if (!base64) {
        return NextResponse.json({ error: "base64 file content is required" }, { status: 400 });
      }
      const buffer = Buffer.from(base64, "base64");
      blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
    }
  } catch {
    return NextResponse.json({ error: "could not parse request body" }, { status: 400 });
  }

  if (!blob || blob.size === 0) {
    return NextResponse.json({ error: "file is empty" }, { status: 400 });
  }
  if (!isValidSection(section)) {
    return NextResponse.json(
      { error: `section must be one of: ${FILE_SECTIONS.join(", ")}` },
      { status: 400 },
    );
  }
  if (blob.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `file exceeds the ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB ceiling` },
      { status: 413 },
    );
  }

  // Operator-scoped upload through the same path the UI uses. Programmatic
  // uploads do not fire the firm notification email (these are automation
  // artifacts); the firm_files row and portal list appearance are identical
  // to a UI upload regardless.
  const actor: ActorContext = {
    role: "operator",
    lawyer_id: operatorSession?.lawyer_id ?? null,
  };

  const result = await uploadFirmFile({
    firmId,
    kind: "file",
    section,
    filename,
    blob,
    mimeType,
    description: note,
    actor,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: result.status },
    );
  }

  const signed = await getFirmFileSignedUrl({ file: result.file, actor });

  return NextResponse.json(
    {
      ok: true,
      file: {
        id: result.file.id,
        firm_id: result.file.firm_id,
        section: result.file.section,
        filename: result.file.display_name,
        content_type: result.file.mime_type,
        size_bytes: result.file.size_bytes,
        uploaded_by_role: result.file.uploaded_by_role,
        created_at: result.file.created_at,
        signed_url: signed.ok ? signed.url : null,
        signed_url_expires_in_seconds: signed.ok ? signed.expires_in_seconds : null,
      },
    },
    { status: 201 },
  );
}
