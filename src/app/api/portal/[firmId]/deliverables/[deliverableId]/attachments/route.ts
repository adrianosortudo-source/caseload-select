/**
 * POST /api/portal/[firmId]/deliverables/[deliverableId]/attachments
 *
 * Uploads one evidence file (screenshot, PDF) for a change-request note or a
 * reply on the record. Stores under deliverables/{firmId}/{deliverableId}/
 * feedback/ (no firm_files row: stays out of the Files hub, matching the
 * existing deliverables asset convention). Returns the attachment metadata so
 * the client can include it in a subsequent approve or comments POST.
 *
 * Operator or firm-lawyer session. 25 MB cap; image or PDF only.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { getDeliverableDetail, uploadDeliverableFeedbackAsset } from "@/lib/deliverables";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  // image/svg+xml intentionally excluded: SVG can carry script and these
  // attachments are served inline via signed URL (stored-XSS vector).
  "application/pdf",
]);

/**
 * Detect the actual MIME type from the first bytes of the buffer. The
 * client-supplied File.type header is attacker-controlled and cannot be
 * trusted alone.
 */
function sniffMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf";
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart body" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'field "file" is required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 },
    );
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: `file type not allowed: ${mime}` }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMime(buffer);
  if (!sniffed || !ALLOWED_MIME.has(sniffed)) {
    return NextResponse.json(
      { error: "file content does not match an allowed type (PNG, JPG, GIF, WEBP, or PDF)" },
      { status: 415 },
    );
  }

  const uploaded = await uploadDeliverableFeedbackAsset({
    firmId,
    deliverableId,
    buffer,
    contentType: sniffed,
    filename: file.name,
  });
  if (!uploaded.ok) return NextResponse.json({ error: uploaded.error }, { status: 500 });

  return NextResponse.json({
    ok: true,
    attachment: {
      storage_path: uploaded.storagePath,
      name: file.name,
      size: file.size,
      mime: sniffed,
    },
  });
}
