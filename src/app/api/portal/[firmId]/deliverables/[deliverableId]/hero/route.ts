/**
 * POST /api/portal/[firmId]/deliverables/[deliverableId]/hero
 *
 * Attach a hero image to a deliverable. Multipart upload; stores the asset
 * in the firm-files bucket under a deliverables/hero/ prefix, signs a long-
 * lived URL, and writes that URL onto content_deliverables.hero_image_url so
 * the DRG article frame's hero slot picks it up on next render.
 *
 * Auth: operator or matching firm-lawyer session. The deliverable's firm_id
 * is verified against the URL firmId (defense-in-depth, the cookie is path
 * "/" so we always reload + scope-check).
 *
 * For the 9 seeded DRG deliverables this endpoint is the path the operator
 * uses to attach the existing /public/images/journal-*.png hero from the DRG
 * website. Future drafts will use the same endpoint with a nano-banana
 * generated upload.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { getDeliverableDetail } from "@/lib/deliverables";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const BUCKET = "firm-files";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// 10 years. The hero URL is stored on the deliverable row and renders on
// every preview; a short TTL would expire under the operator. The bucket is
// private; the signed URL is the access gate.
const SIGNED_URL_TTL = 10 * 365 * 24 * 60 * 60;

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

function sniffMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart body" }, { status: 400 });
  }

  const file = formData.get("file");
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
    return NextResponse.json({ error: "file content is not a valid image" }, { status: 415 });
  }

  const ts = Date.now();
  const storagePath = `deliverables/hero/${firmId}/${deliverableId}/${ts}-${safeName(file.name)}`;

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: sniffed, upsert: false });
  if (uploadErr) {
    console.error("[deliverables/hero] upload failed:", uploadErr.message);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }

  // Sign a long-lived URL since the deliverable row carries this URL as
  // hero_image_url and renders on every preview load.
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL);
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: "could not sign url" }, { status: 500 });
  }

  const { error: updateErr } = await supabase
    .from("content_deliverables")
    .update({ hero_image_url: signed.signedUrl, updated_at: new Date().toISOString() })
    .eq("id", deliverableId);
  if (updateErr) {
    return NextResponse.json({ error: `deliverable update failed: ${updateErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    hero_image_url: signed.signedUrl,
    storage_path: storagePath,
  });
}
