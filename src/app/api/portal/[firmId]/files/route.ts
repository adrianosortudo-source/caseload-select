/**
 * GET  /api/portal/[firmId]/files
 * POST /api/portal/[firmId]/files
 *
 * GET: list deliverables for a firm. Active items by default; pass
 * `?archived=1` to include archived ones (operator audit view). Optional
 * `?section=brand|strategy|reports|assets|admin` filter.
 *
 * POST: add one deliverable. multipart/form-data:
 *   kind:        file (default) | link
 *   section:     brand | strategy | reports | assets | admin
 *   description: optional context string (max 4 KB)
 *   file:        the binary            (kind=file)
 *   external_url + title:              (kind=link)
 *
 * Auth: portal session cookie. Lawyers can only access their own firm;
 * operators can access any firm. Both roles can add and list. Client
 * sessions are excluded.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { listFirmFiles, uploadFirmFile, type ActorContext } from "@/lib/firm-files";
import { isValidSection, type FileSection } from "@/lib/firm-files-pure";
import { notifyOnFirmFileUpload } from "@/lib/file-notify";

const MAX_DESCRIPTION_LEN = 4096;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> }
) {
  const { firmId } = await params;
  const session = await getPortalSession();
  const isAuthorized = !!session && session.role !== "client" && (session.role === "operator" || session.firm_id === firmId);
  if (!session || !isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("archived") === "1";
  const sectionRaw = url.searchParams.get("section");
  const section =
    sectionRaw && isValidSection(sectionRaw) ? (sectionRaw as FileSection) : undefined;

  try {
    const files = await listFirmFiles(firmId, { includeArchived, section });
    return NextResponse.json({
      items: files.map((f) => ({
        id: f.id,
        kind: f.kind,
        section: f.section,
        display_name: f.display_name,
        size_bytes: f.size_bytes,
        mime_type: f.mime_type,
        external_url: f.external_url,
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
  const isAuthorized = !!session && session.role !== "client" && (session.role === "operator" || session.firm_id === firmId);
  if (!session || !isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data body" }, { status: 400 });
  }

  const kind = ((form.get("kind") as string | null) ?? "file").toLowerCase();
  const section = (form.get("section") as string | null) ?? "";
  const descriptionRaw = (form.get("description") as string | null) ?? "";
  const description = descriptionRaw.slice(0, MAX_DESCRIPTION_LEN).trim() || null;

  const actor: ActorContext = {
    role: session.role as "operator" | "lawyer",
    lawyer_id: session.lawyer_id ?? null,
  };

  let result;
  if (kind === "link") {
    const externalUrl = ((form.get("external_url") as string | null) ?? "").trim();
    const title = ((form.get("title") as string | null) ?? "").trim();
    result = await uploadFirmFile({
      firmId,
      kind: "link",
      section,
      externalUrl,
      displayName: title,
      description,
      actor,
    });
  } else {
    const fileEntry = form.get("file");
    if (!(fileEntry instanceof Blob) || fileEntry.size === 0) {
      return NextResponse.json({ error: "file field is required" }, { status: 400 });
    }
    // FormData File entries carry a `.name` attribute; Blob does not. Probe.
    const filename =
      fileEntry instanceof File && fileEntry.name
        ? fileEntry.name
        : (form.get("filename") as string | null) ?? "";
    result = await uploadFirmFile({
      firmId,
      kind: "file",
      section,
      filename,
      blob: fileEntry,
      mimeType: fileEntry.type ?? "",
      description,
      actor,
    });
  }

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
        kind: result.file.kind,
        section: result.file.section,
        display_name: result.file.display_name,
        size_bytes: result.file.size_bytes,
        mime_type: result.file.mime_type,
        external_url: result.file.external_url,
        description: result.file.description,
        uploaded_by_role: result.file.uploaded_by_role,
        created_at: result.file.created_at,
      },
    },
    { status: 201 },
  );
}
