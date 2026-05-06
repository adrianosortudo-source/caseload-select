/**
 * GET /api/portal/[firmId]/files
 * POST /api/portal/[firmId]/files
 *
 * GET — list files for a firm. Returns active files by default; pass
 * `?archived=1` to include the archived ones (operator audit view).
 * Optional `?category=contract|report|...` filter.
 *
 * POST — upload one file. multipart/form-data:
 *   file:        the binary
 *   category:    contract | report | onboarding | diagnostic | correspondence | other
 *   description: optional context string (max 4 KB)
 *
 * Auth: portal session cookie. Lawyers can only access their own firm;
 * operators can access any firm. Both roles can upload and list.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { listFirmFiles, uploadFirmFile, type ActorContext } from "@/lib/firm-files";
import { isValidCategory, type FileCategory } from "@/lib/firm-files-pure";
import { notifyOnFirmFileUpload } from "@/lib/file-notify";

const MAX_DESCRIPTION_LEN = 4096;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> }
) {
  const { firmId } = await params;
  const session = await getPortalSession();
  const isAuthorized = !!session && (session.role === "operator" || session.firm_id === firmId);
  if (!session || !isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("archived") === "1";
  const categoryRaw = url.searchParams.get("category");
  const category =
    categoryRaw && isValidCategory(categoryRaw) ? (categoryRaw as FileCategory) : undefined;

  try {
    const files = await listFirmFiles(firmId, { includeArchived, category });
    return NextResponse.json({
      items: files.map((f) => ({
        id: f.id,
        category: f.category,
        display_name: f.display_name,
        size_bytes: f.size_bytes,
        mime_type: f.mime_type,
        description: f.description,
        uploaded_by_role: f.uploaded_by_role,
        archived: f.archived,
        archived_at: f.archived_at,
        created_at: f.created_at,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list failed" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> }
) {
  const { firmId } = await params;
  const session = await getPortalSession();
  const isAuthorized = !!session && (session.role === "operator" || session.firm_id === firmId);
  if (!session || !isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data body" }, { status: 400 });
  }

  const fileEntry = form.get("file");
  if (!(fileEntry instanceof Blob) || fileEntry.size === 0) {
    return NextResponse.json({ error: "file field is required" }, { status: 400 });
  }
  // FormData File entries carry a `.name` attribute; Blob does not. Probe.
  const filename =
    fileEntry instanceof File && fileEntry.name
      ? fileEntry.name
      : (form.get("filename") as string | null) ?? "";
  const category = (form.get("category") as string | null) ?? "";
  const descriptionRaw = (form.get("description") as string | null) ?? "";
  const description = descriptionRaw.slice(0, MAX_DESCRIPTION_LEN).trim();

  const actor: ActorContext = {
    role: session.role,
    lawyer_id: session.lawyer_id ?? null,
  };

  const result = await uploadFirmFile({
    firmId,
    filename,
    category,
    description: description.length > 0 ? description : null,
    blob: fileEntry,
    mimeType: fileEntry.type ?? "",
    actor,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: result.status },
    );
  }

  // Fan-out notification (best effort, non-blocking).
  void notifyOnFirmFileUpload({
    firmId,
    file: result.file,
    actor,
  }).catch((err) => console.error("[firm-files] notify failed:", err));

  return NextResponse.json(
    {
      file: {
        id: result.file.id,
        category: result.file.category,
        display_name: result.file.display_name,
        size_bytes: result.file.size_bytes,
        mime_type: result.file.mime_type,
        description: result.file.description,
        uploaded_by_role: result.file.uploaded_by_role,
        created_at: result.file.created_at,
      },
    },
    { status: 201 },
  );
}
