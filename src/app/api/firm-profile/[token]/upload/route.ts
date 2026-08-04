/**
 * POST /api/firm-profile/[token]/upload
 *
 * Receives one client-list file from the Firm Profile form's two-path client
 * list intake (Section B). Stores it in the private firm-onboarding-docs
 * bucket and returns the storage path plus metadata so the form can append it
 * to client_list_files on the submission row. The token is the credential.
 *
 * The firm rarely has a clean spreadsheet, so this accepts whatever it
 * already has: spreadsheets, PDFs, Word documents, contact exports, and
 * photos or scans of a printed list. Some browsers send an empty or odd MIME
 * type for CSV and similar formats, so we fall back to the file extension.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";

const BUCKET = "firm-onboarding-docs";
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_MIME = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.apple.numbers",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "text/plain",
  "text/vcard",
  "text/x-vcard",
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/heif",
  "image/webp",
]);
const ALLOWED_EXT = new Set([
  "csv", "xlsx", "xls", "ods", "numbers",
  "pdf", "doc", "docx", "rtf", "txt", "vcf",
  "png", "jpg", "jpeg", "heic", "heif", "webp",
]);

function sanitizeFilename(name: string): string {
  const trimmed = name.slice(0, 120);
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 8 || token.length > 200) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 400 });
  }

  // Token is a shared-secret slug; rate-limit per IP to cap junk/cost writes
  // to the private bucket from anyone fuzzing token prefixes.
  const rl = await checkRateLimit("firmOnboardingUpload", ipFromRequest(req));
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many uploads from this network. Try again later." },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "no file field in form data" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `file too large; max ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 400 },
    );
  }

  const ext = extOf(file.name);
  const mimeOk = ALLOWED_MIME.has(file.type);
  const extOk = ALLOWED_EXT.has(ext);
  if (!mimeOk && !extOk) {
    return NextResponse.json(
      { ok: false, error: "unsupported file type. Send a spreadsheet, PDF, document, contact export, or photo of the list." },
      { status: 400 },
    );
  }

  const safeName = sanitizeFilename(file.name);
  const stamp = Date.now();
  const storagePath = `${encodeURIComponent(token)}/profile/${stamp}-${safeName}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadErr) {
    return NextResponse.json({ ok: false, error: `upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    storage_path: storagePath,
    original_name: file.name,
    size_bytes: file.size,
    mime_type: file.type || null,
  });
}
