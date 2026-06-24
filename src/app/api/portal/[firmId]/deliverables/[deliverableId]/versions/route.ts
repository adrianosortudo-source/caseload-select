/**
 * POST /api/portal/[firmId]/deliverables/[deliverableId]/versions
 *
 * Post a new version of a deliverable and return it to review.
 *
 *   text deliverable  -> JSON  { body_html, note? }   (body sanitised on save)
 *   image / pdf       -> multipart  file + note?      (asset stored, signed at read)
 *
 * Operator or firm-lawyer session. The version's content must match the
 * deliverable's content_kind.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import {
  getDeliverableDetail,
  addVersion,
  uploadDeliverableAsset,
} from "@/lib/deliverables";
import { cleanNote } from "@/lib/deliverables-pure";
import { sanitizeExplainerHtml } from "@/lib/explainer-html-sanitize";
import { postDeliverableLifecycleToChannel } from "@/lib/deliverable-channel-post";

async function announceNewVersion(
  firmId: string,
  deliverableId: string,
  title: string,
  actor: Parameters<typeof postDeliverableLifecycleToChannel>[0]["actor"],
): Promise<void> {
  await postDeliverableLifecycleToChannel({
    firmId,
    deliverableId,
    deliverableTitle: title,
    event: "new_version",
    actor,
  }).catch((e) => console.warn("[deliverables/versions] channel post failed:", e));
}

const MAX_ASSET_BYTES = 50 * 1024 * 1024; // 50 MB

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  // image/svg+xml intentionally excluded: SVG can carry script and deliverable
  // assets are rendered/served inline via signed URL (stored-XSS vector).
]);
const PDF_MIME = new Set(["application/pdf"]);

/**
 * Detect the actual MIME type from the first bytes of the buffer. The
 * client-supplied File.type header is attacker-controlled and cannot be
 * trusted alone. Returns null if the bytes don't match any supported format.
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

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const kind = detail.deliverable.content_kind;
  const contentType = req.headers.get("content-type") ?? "";

  // ── Asset path (image / pdf) ──
  if (contentType.startsWith("multipart/form-data")) {
    if (kind === "text") {
      return NextResponse.json(
        { error: "this is a text deliverable; post body_html as JSON" },
        { status: 400 },
      );
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
    if (file.size > MAX_ASSET_BYTES) {
      return NextResponse.json(
        { error: `file too large (max ${MAX_ASSET_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      );
    }
    const mime = file.type || "application/octet-stream";
    const allowed = kind === "image" ? IMAGE_MIME : PDF_MIME;
    if (!allowed.has(mime)) {
      return NextResponse.json(
        { error: `file type not allowed for a ${kind} deliverable: ${mime}` },
        { status: 415 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMime(buffer);
    if (!sniffed || !allowed.has(sniffed)) {
      return NextResponse.json(
        { error: `file content does not match an allowed type for a ${kind} deliverable` },
        { status: 415 },
      );
    }
    const uploaded = await uploadDeliverableAsset({
      firmId,
      deliverableId,
      buffer,
      contentType: sniffed,
      filename: file.name,
    });
    if (!uploaded.ok) return NextResponse.json({ error: uploaded.error }, { status: 500 });

    const note = cleanNote(form.get("note"));
    const silent = form.get("silent") === "true";
    const result = await addVersion({
      deliverableId,
      firmId,
      bodyHtml: null,
      storagePath: uploaded.storagePath,
      assetMime: sniffed,
      assetSizeBytes: file.size,
      assetName: file.name,
      note,
      actor: resolved.actor,
      silent,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    if (!silent) await announceNewVersion(firmId, deliverableId, detail.deliverable.title, resolved.actor);
    return NextResponse.json({ ok: true, version: result.version });
  }

  // ── Text path ──
  if (kind !== "text") {
    return NextResponse.json(
      { error: `this is a ${kind} deliverable; upload a file (multipart)` },
      { status: 400 },
    );
  }
  let body: { body_html?: unknown; note?: unknown; silent?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const sanitised = sanitizeExplainerHtml(
    typeof body.body_html === "string" ? body.body_html : "",
  );
  if (!sanitised) {
    return NextResponse.json({ error: "body_html is required" }, { status: 400 });
  }
  const silent = body.silent === true;
  const result = await addVersion({
    deliverableId,
    firmId,
    bodyHtml: sanitised,
    storagePath: null,
    assetMime: null,
    assetSizeBytes: null,
    assetName: null,
    note: cleanNote(body.note),
    actor: resolved.actor,
    silent,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  if (!silent) await announceNewVersion(firmId, deliverableId, detail.deliverable.title, resolved.actor);
  return NextResponse.json({ ok: true, version: result.version });
}
